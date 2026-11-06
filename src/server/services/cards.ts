/**
 * Cartão de crédito da agência: fornecedor que só aceita cartão é pago com o cartão da agência
 * (o cliente pagou a agência no PIX). O pagamento quita a conta do fornecedor e o valor entra
 * na fatura do cartão (uma conta a pagar por mês, com o vencimento do cartão). A fatura é o que
 * sai do caixa; ela fica fora do DRE porque a despesa já está no custo do fornecedor.
 */
import { prisma, type Tx } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { splitInstallments } from "@/lib/money";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { entryStatus } from "@/lib/finance";

export const CARD_BILL_CATEGORY = "FATURA_CARTAO";
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function ym(y: number, m0: number) {
  const d = new Date(Date.UTC(y, m0, 1));
  return { y: d.getUTCFullYear(), m0: d.getUTCMonth() };
}
function dayIn(y: number, m0: number, day: number) {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * Em qual fatura cai cada parcela de uma compra feita em `date`.
 * Compra depois do dia de fechamento vai para a fatura do mês seguinte. Se o vencimento é
 * menor ou igual ao fechamento, a fatura vence no mês seguinte ao fechamento.
 */
export function cardBillSchedule(date: string, closingDay: number, dueDay: number, installments: number) {
  const [y, m, d] = date.split("-").map(Number);
  const first = ym(y, m - 1 + (d > closingDay ? 1 : 0));
  return Array.from({ length: installments }, (_, i) => {
    const close = ym(first.y, first.m0 + i);
    const due = ym(close.y, close.m0 + (dueDay <= closingDay ? 1 : 0));
    return { month: `${close.y}-${String(close.m0 + 1).padStart(2, "0")}`, label: `${MONTHS[close.m0]}/${close.y}`, closingDate: dayIn(close.y, close.m0, closingDay), dueDate: dayIn(due.y, due.m0, dueDay) };
  });
}

async function ensureCardCategory(tx: Tx, companyId: string) {
  await tx.expenseCategory.upsert({
    where: { companyId_code: { companyId, code: CARD_BILL_CATEGORY } },
    create: { companyId, code: CARD_BILL_CATEGORY, name: "Fatura do cartão da agência", group: "Outros", system: true, inDre: false, sortOrder: 999 },
    update: { inDre: false, active: true },
  });
}

async function refreshBill(tx: Tx, id: string) {
  const p = await tx.payable.findUniqueOrThrow({ where: { id } });
  const status = p.amountCents <= 0 ? "CANCELADO" : entryStatus(p.amountCents, p.settledCents, false);
  await tx.payable.update({ where: { id }, data: { status, cancelledAt: status === "CANCELADO" ? new Date() : null } });
}

/** Chamado na baixa de uma conta a pagar feita com a conta "Cartão de crédito da agência". */
export async function applyCardCharge(
  tx: Tx,
  ctx: Ctx,
  account: { id: string; name: string; closingDay: number | null; dueDay: number | null },
  s: { id: string; date: string; amountCents: number; cardInstallments: number },
  description: string,
) {
  if (!account.closingDay || !account.dueDay) throw new AppError(`Informe o dia de fechamento e o dia de vencimento do cartão "${account.name}" em Contas e saldos.`);
  await ensureCardCategory(tx, ctx.companyId);
  const parts = splitInstallments(s.amountCents, s.cardInstallments);
  const schedule = cardBillSchedule(s.date, account.closingDay, account.dueDay, s.cardInstallments);
  const bills: { payableId: string; cents: number }[] = [];
  for (const [i, b] of schedule.entries()) {
    const sourceKey = `cartao:${account.id}:${b.month}`;
    const line = `${formatDate(s.date)} · ${description} · ${formatBRL(parts[i])}${s.cardInstallments > 1 ? ` (${i + 1}/${s.cardInstallments})` : ""}`;
    const existing = await tx.payable.findUnique({ where: { companyId_sourceKey: { companyId: ctx.companyId, sourceKey } } });
    const bill = existing
      ? await tx.payable.update({ where: { id: existing.id }, data: { amountCents: { increment: parts[i] }, notes: [existing.notes, line].filter(Boolean).join("\n").slice(-4000), dueDate: b.dueDate } })
      : await tx.payable.create({
          data: {
            companyId: ctx.companyId,
            sourceKey,
            origin: "CARTAO",
            description: `Fatura ${account.name} · ${b.label}`,
            category: CARD_BILL_CATEGORY,
            amountCents: parts[i],
            dueDate: b.dueDate,
            method: "BOLETO",
            status: "PENDENTE",
            notes: line,
          },
        });
    await refreshBill(tx, bill.id);
    bills.push({ payableId: bill.id, cents: parts[i] });
  }
  await tx.settlement.update({ where: { id: s.id }, data: { cardBillsJson: JSON.stringify(bills) } });
  await audit(tx, ctx, "cartao.compra", "Settlement", s.id, { accountId: account.id, amountCents: s.amountCents, parcelas: s.cardInstallments });
}

/** Estorno de um pagamento feito com o cartão: tira o valor das faturas (que não podem estar pagas além do novo total). */
export async function reverseCardCharge(tx: Tx, s: { cardBillsJson: string | null }) {
  if (!s.cardBillsJson) return;
  const bills = JSON.parse(s.cardBillsJson) as { payableId: string; cents: number }[];
  for (const b of bills) {
    const p = await tx.payable.findUnique({ where: { id: b.payableId } });
    if (!p) continue;
    if (p.settledCents > p.amountCents - b.cents)
      throw new AppError(`A fatura "${p.description}" já foi paga. Estorne o pagamento da fatura antes de estornar esta compra no cartão.`);
    await tx.payable.update({ where: { id: p.id }, data: { amountCents: { decrement: b.cents } } });
    await refreshBill(tx, p.id);
  }
}

/** Cartões da agência com as faturas em aberto e as próximas. */
export async function listCards(ctx: Ctx) {
  assertCan(ctx, "finance.view");
  const cards = await prisma.financialAccount.findMany({ where: { companyId: ctx.companyId, type: "CARTAO_CREDITO" }, orderBy: { name: "asc" } });
  if (!cards.length) return [];
  const bills = await prisma.payable.findMany({
    where: { companyId: ctx.companyId, origin: "CARTAO", status: { not: "CANCELADO" }, OR: cards.map((c) => ({ sourceKey: { startsWith: `cartao:${c.id}:` } })) },
    orderBy: { dueDate: "asc" },
    select: { id: true, sourceKey: true, description: true, amountCents: true, settledCents: true, dueDate: true, status: true, notes: true },
  });
  return cards.map((c) => {
    const mine = bills.filter((b) => b.sourceKey!.startsWith(`cartao:${c.id}:`));
    return {
      id: c.id,
      name: c.name,
      active: c.active,
      closingDay: c.closingDay,
      dueDay: c.dueDay,
      openCents: mine.reduce((t, b) => t + b.amountCents - b.settledCents, 0),
      bills: mine.map((b) => ({ ...b, month: b.sourceKey!.split(":")[2], openCents: b.amountCents - b.settledCents, purchases: (b.notes ?? "").split("\n").filter(Boolean) })),
    };
  });
}
