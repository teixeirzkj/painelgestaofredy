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
import { billMonthOf, cardBillSchedule, cardPlan, BILL_MONTH_RE } from "@/lib/card-bills";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { entryStatus } from "@/lib/finance";

export const CARD_BILL_CATEGORY = "FATURA_CARTAO";
export { cardBillSchedule };

type CardAccount = { id: string; name: string; closingDay: number | null; dueDay: number | null };
/** Opções da compra no cartão: fatura da 1ª parcela lançada e, para compra antiga, a parcela em que ela está. */
export type CardChargeOpts = { firstMonth?: string | null; startInstallment?: number | null };

/** Parcelas da compra e a fatura de cada uma (valida as opções). */
export function planCardCharge(account: CardAccount, s: { date: string; amountCents: number; cardInstallments: number }, opts: CardChargeOpts = {}) {
  if (!account.closingDay || !account.dueDay) throw new AppError(`Informe o dia de fechamento e o dia de vencimento do cartão "${account.name}" em Contas e saldos.`);
  const installments = Math.min(Math.max(s.cardInstallments || 1, 1), 24);
  const startInstallment = opts.startInstallment ?? 1;
  if (!Number.isInteger(startInstallment) || startInstallment < 1 || startInstallment > installments)
    throw new AppError("A parcela inicial não pode ser maior que o número de parcelas.");
  if (opts.firstMonth && !BILL_MONTH_RE.test(opts.firstMonth)) throw new AppError("Fatura inválida: escolha o mês da fatura.");
  const firstMonth = opts.firstMonth || billMonthOf(s.date, account.closingDay);
  return cardPlan({ amountCents: s.amountCents, installments, startInstallment, firstMonth, closingDay: account.closingDay, dueDay: account.dueDay });
}

/** Fatura em que caiu uma parcela da compra; `line` é a linha gravada nas notas da fatura (lista "Compras nesta fatura"). */
type CardBillRef = { payableId: string; cents: number; line?: string };

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Tira das notas da fatura a linha desta compra (a lista de compras e a contagem vêm dessas linhas).
 * Baixas antigas não guardavam a linha: aí procura pela data, descrição e valor da parcela.
 */
export function removePurchaseLine(notes: string | null, ref: { line?: string; cents: number }, fallback?: { date: string; description: string }) {
  const lines = (notes ?? "").split("\n");
  let idx = ref.line ? lines.lastIndexOf(ref.line) : -1;
  if (idx < 0 && fallback) {
    const head = `${formatDate(fallback.date)} · ${fallback.description} · ${formatBRL(ref.cents)}`;
    const re = new RegExp(`^${escapeRe(head)}( \\(\\d+/\\d+\\))?$`);
    for (let i = lines.length - 1; i >= 0; i--)
      if (re.test(lines[i])) {
        idx = i;
        break;
      }
  }
  if (idx < 0) return notes;
  lines.splice(idx, 1);
  return lines.filter(Boolean).join("\n") || null;
}

const isPaidBill = (b: { status: string; amountCents: number; settledCents: number }) => b.status === "PAGO" || (b.amountCents > 0 && b.settledCents >= b.amountCents);

/**
 * Primeira fatura já paga em que a compra cairia (ou null). A baixa feita pela tela recusa;
 * a baixa automática (venda) usa esta checagem antes, para deixar a conta em aberto em vez de falhar.
 */
export async function findPaidCardBill(tx: Tx, companyId: string, account: CardAccount, plan: { month: string; label: string }[]) {
  for (const b of plan) {
    const bill = await tx.payable.findUnique({ where: { companyId_sourceKey: { companyId, sourceKey: `cartao:${account.id}:${b.month}` } } });
    if (bill && bill.status !== "CANCELADO" && isPaidBill(bill)) return { month: b.month, label: b.label, payableId: bill.id };
  }
  return null;
}

export function paidBillMessage(label: string, cardName: string) {
  return `A fatura de ${label} do cartão "${cardName}" já está paga. Escolha a fatura seguinte ou estorne o pagamento dessa fatura primeiro.`;
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
  account: CardAccount,
  s: { id: string; date: string; amountCents: number; cardInstallments: number },
  description: string,
  opts: CardChargeOpts = {},
) {
  const plan = planCardCharge(account, s, opts);
  const paid = await findPaidCardBill(tx, ctx.companyId, account, plan);
  if (paid) throw new AppError(paidBillMessage(paid.label, account.name));
  await ensureCardCategory(tx, ctx.companyId);
  const bills: CardBillRef[] = [];
  for (const b of plan) {
    const sourceKey = `cartao:${account.id}:${b.month}`;
    const line = `${formatDate(s.date)} · ${description} · ${formatBRL(b.cents)}${b.of > 1 ? ` (${b.n}/${b.of})` : ""}`;
    const existing = await tx.payable.findUnique({ where: { companyId_sourceKey: { companyId: ctx.companyId, sourceKey } } });
    const bill = existing
      ? await tx.payable.update({ where: { id: existing.id }, data: { amountCents: { increment: b.cents }, notes: [existing.notes, line].filter(Boolean).join("\n").slice(-4000), dueDate: b.dueDate } })
      : await tx.payable.create({
          data: {
            companyId: ctx.companyId,
            sourceKey,
            origin: "CARTAO",
            description: `Fatura ${account.name} · ${b.label}`,
            category: CARD_BILL_CATEGORY,
            amountCents: b.cents,
            dueDate: b.dueDate,
            method: "BOLETO",
            status: "PENDENTE",
            notes: line,
          },
        });
    await refreshBill(tx, bill.id);
    bills.push({ payableId: bill.id, cents: b.cents, line });
  }
  const startInstallment = plan[0]?.n ?? 1;
  await tx.settlement.update({
    where: { id: s.id },
    data: { cardBillsJson: JSON.stringify(bills), cardStartInstallment: startInstallment, cardFirstBillMonth: opts.firstMonth || null },
  });
  await audit(tx, ctx, "cartao.compra", "Settlement", s.id, {
    accountId: account.id,
    amountCents: s.amountCents,
    parcelas: s.cardInstallments,
    parcelaInicial: startInstallment,
    primeiraFatura: plan[0]?.month,
    lancadoNasFaturasCents: bills.reduce((t, b) => t + b.cents, 0),
  });
  return { bills, plan };
}

/** Em quais faturas do cartão caiu cada baixa (para mostrar no histórico da conta). */
export async function getCardBillsFor(db: Tx, companyId: string, settlements: { id: string; cardBillsJson: string | null }[]) {
  const parsed = settlements.map((s) => ({ id: s.id, bills: s.cardBillsJson ? (JSON.parse(s.cardBillsJson) as { payableId: string; cents: number }[]) : [] }));
  const ids = [...new Set(parsed.flatMap((p) => p.bills.map((b) => b.payableId)))];
  const rows = ids.length
    ? await db.payable.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, description: true, dueDate: true, status: true } })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Record<string, { payableId: string; description: string; dueDate: string; status: string; cents: number }[]> = {};
  for (const p of parsed) {
    if (!p.bills.length) continue;
    out[p.id] = p.bills.map((b) => {
      const r = byId.get(b.payableId);
      return { payableId: b.payableId, description: r?.description ?? "Fatura do cartão", dueDate: r?.dueDate ?? "", status: r?.status ?? "CANCELADO", cents: b.cents };
    });
  }
  return out;
}

/** Fatura já paga que impede estornar esta compra no cartão (ou null). Não altera nada. */
export async function paidBillBlockingReversal(tx: Tx, s: { cardBillsJson: string | null }) {
  if (!s.cardBillsJson) return null;
  const bills = JSON.parse(s.cardBillsJson) as { payableId: string; cents: number }[];
  for (const b of bills) {
    const p = await tx.payable.findUnique({ where: { id: b.payableId } });
    if (p && p.settledCents > p.amountCents - b.cents) return p.description;
  }
  return null;
}

/** Estorno de um pagamento feito com o cartão: tira o valor das faturas (que não podem estar pagas além do novo total). */
export async function reverseCardCharge(tx: Tx, s: { id?: string; cardBillsJson: string | null }) {
  if (!s.cardBillsJson) return;
  const bills = JSON.parse(s.cardBillsJson) as CardBillRef[];
  // Para baixas antigas (sem a linha guardada): data e descrição usadas na linha da fatura
  let fallback: { date: string; description: string } | undefined;
  if (s.id && bills.some((b) => !b.line)) {
    const row = await tx.settlement.findUnique({ where: { id: s.id }, select: { date: true, payable: { select: { description: true } }, receivable: { select: { description: true } } } });
    const description = row?.payable?.description ?? row?.receivable?.description;
    if (row && description) fallback = { date: row.date, description: description.slice(0, 120) };
  }
  for (const b of bills) {
    const p = await tx.payable.findUnique({ where: { id: b.payableId } });
    if (!p) continue;
    if (p.settledCents > p.amountCents - b.cents)
      throw new AppError(`A fatura "${p.description}" já foi paga. Estorne o pagamento da fatura antes de estornar esta compra no cartão.`);
    await tx.payable.update({ where: { id: p.id }, data: { amountCents: { decrement: b.cents }, notes: removePurchaseLine(p.notes, b, fallback) } });
    await refreshBill(tx, p.id);
  }
}

/**
 * Cartões ativos da agência para escolher na venda ("como o fornecedor é pago"). Não exige acesso
 * ao financeiro: só nome e dias de fechamento/vencimento, sem saldos nem faturas.
 */
export async function cardOptions(ctx: Ctx) {
  const cards = await prisma.financialAccount.findMany({
    where: { companyId: ctx.companyId, type: "CARTAO_CREDITO", active: true },
    select: { id: true, name: true, closingDay: true, dueDay: true },
    orderBy: { name: "asc" },
  });
  return cards.map((c) => ({ ...c, ready: !!c.closingDay && !!c.dueDay }));
}
export type AgencyCardOption = Awaited<ReturnType<typeof cardOptions>>[number];

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
