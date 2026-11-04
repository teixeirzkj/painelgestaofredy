/**
 * Faturas de operadoras e consolidadoras.
 *
 * Uma fatura NÃO cria despesa nova: ela consolida contas a pagar que já existem (custos gerados
 * pelas vendas ou lançamentos manuais do mesmo fornecedor). Assim não há dupla contagem entre a
 * conta a pagar individual e a fatura. Fluxo:
 *   1. Receber fatura (número, emissão, vencimento, valor cobrado pelo fornecedor)
 *   2. Vincular lançamentos em aberto do fornecedor (o vencimento passa a ser o da fatura)
 *   3. Conferir: valor da fatura × soma do sistema; divergências ficam destacadas
 *      (a diferença a maior pode ser registrada como ajuste vinculado à fatura)
 *   4. Quitar: uma única operação baixa todos os lançamentos da fatura na mesma transação
 */
import { prisma, type Tx } from "../db";
import { assertCan, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { invoicePaymentSchema, invoiceSchema } from "./schemas";
import { settleEntryTx } from "./finance";
import { displayStatus } from "@/lib/finance";
import { sum } from "@/lib/money";
import { textContains } from "./query";

const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function totalsOf(payables: { amountCents: number; settledCents: number; status: string }[], declaredCents: number) {
  const active = payables.filter((p) => p.status !== "CANCELADO");
  const systemCents = sum(active.map((p) => p.amountCents));
  const paidCents = sum(active.map((p) => p.settledCents));
  return { systemCents, paidCents, openCents: systemCents - paidCents, divergenceCents: declaredCents - systemCents, count: active.length };
}

export async function refreshInvoiceStatus(tx: Tx, invoiceId: string) {
  const inv = await tx.supplierInvoice.findUnique({ where: { id: invoiceId }, include: { payables: true } });
  if (!inv || inv.status === "CANCELADA") return;
  const active = inv.payables.filter((p) => p.status !== "CANCELADO");
  const allPaid = active.length > 0 && active.every((p) => p.status === "PAGO");
  const next = allPaid ? "PAGA" : inv.status === "PAGA" ? "CONFERIDA" : inv.status;
  if (next !== inv.status) await tx.supplierInvoice.update({ where: { id: inv.id }, data: { status: next } });
}

export type InvoiceFilters = { q?: string; status?: string; supplierId?: string };

export async function listInvoices(ctx: Ctx, f: InvoiceFilters = {}) {
  assertCan(ctx, "finance.view");
  const rows = await prisma.supplierInvoice.findMany({
    where: {
      companyId: ctx.companyId,
      ...(f.status ? { status: f.status } : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.q ? { OR: [{ number: textContains(f.q) }, { supplier: { name: textContains(f.q) } }] } : {}),
    },
    orderBy: [{ dueDate: "asc" }],
    include: { supplier: { select: { id: true, name: true } }, payables: { select: { amountCents: true, settledCents: true, status: true } } },
    take: 200,
  });
  const t = today(ctx);
  const items = rows.map((r) => ({
    ...r,
    ...totalsOf(r.payables, r.declaredCents),
    overdue: (r.status === "ABERTA" || r.status === "CONFERIDA") && r.dueDate < t,
  }));
  const open = items.filter((i) => i.status === "ABERTA" || i.status === "CONFERIDA");
  return {
    items,
    summary: {
      openCount: open.length,
      openCents: sum(open.map((i) => i.declaredCents - i.paidCents)),
      divergentCount: open.filter((i) => i.divergenceCents !== 0).length,
      overdueCount: open.filter((i) => i.overdue).length,
    },
  };
}

export async function getInvoice(ctx: Ctx, id: string) {
  assertCan(ctx, "finance.view");
  const inv = await prisma.supplierInvoice.findFirst({
    where: { id, companyId: ctx.companyId },
    include: {
      supplier: { select: { id: true, name: true } },
      payables: { orderBy: { dueDate: "asc" }, include: { sale: { select: { id: true, code: true, saleDate: true, client: { select: { name: true } } } } } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!inv) throw new AppError("Fatura não encontrada.", "NOT_FOUND");
  const t = today(ctx);
  const candidates =
    inv.status === "ABERTA"
      ? await prisma.payable.findMany({
          where: { companyId: ctx.companyId, supplierId: inv.supplierId, invoiceId: null, status: { in: ["PENDENTE", "PARCIAL"] } },
          include: { sale: { select: { id: true, code: true, client: { select: { name: true } } } } },
          orderBy: { dueDate: "asc" },
          take: 300,
        })
      : [];
  return {
    ...inv,
    ...totalsOf(inv.payables, inv.declaredCents),
    payables: inv.payables.map((p) => ({ ...p, balanceCents: p.status === "CANCELADO" ? 0 : p.amountCents - p.settledCents, displayStatus: displayStatus(p.status, p.dueDate, t) })),
    candidates: candidates.map((p) => ({ ...p, balanceCents: p.amountCents - p.settledCents })),
  };
}

export async function createInvoice(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = invoiceSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const sup = await tx.supplier.findFirst({ where: { id: d.supplierId, companyId: ctx.companyId } });
    if (!sup) throw new AppError("Fornecedor inválido.");
    const dup = await tx.supplierInvoice.findFirst({ where: { companyId: ctx.companyId, supplierId: d.supplierId, number: d.number } });
    if (dup) throw new AppError(`A fatura ${d.number} deste fornecedor já foi registrada.`, "CONFLICT");
    const inv = await tx.supplierInvoice.create({ data: { ...d, companyId: ctx.companyId, status: "ABERTA" } });
    await audit(tx, ctx, "fatura.recebida", "SupplierInvoice", inv.id, { number: d.number, declaredCents: d.declaredCents });
    return inv.id;
  });
}

async function editableInvoice(tx: Tx, ctx: Ctx, id: string) {
  const inv = await tx.supplierInvoice.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!inv) throw new AppError("Fatura não encontrada.", "NOT_FOUND");
  if (inv.status !== "ABERTA") throw new AppError("Só é possível alterar itens de faturas em conferência. Reabra a fatura antes.");
  return inv;
}

export async function addPayablesToInvoice(ctx: Ctx, id: string, payableIds: string[]) {
  assertCan(ctx, "finance.manage");
  if (!payableIds.length) throw new AppError("Selecione ao menos um lançamento.");
  return prisma.$transaction(async (tx) => {
    const inv = await editableInvoice(tx, ctx, id);
    const rows = await tx.payable.findMany({ where: { id: { in: payableIds }, companyId: ctx.companyId } });
    if (rows.length !== payableIds.length) throw new AppError("Lançamento inválido.");
    for (const p of rows) {
      if (p.supplierId !== inv.supplierId) throw new AppError(`"${p.description}" é de outro fornecedor.`);
      if (p.invoiceId) throw new AppError(`"${p.description}" já está em outra fatura.`, "CONFLICT");
      if (p.status === "CANCELADO" || p.status === "PAGO") throw new AppError(`"${p.description}" não está em aberto.`);
    }
    await tx.payable.updateMany({ where: { id: { in: payableIds }, companyId: ctx.companyId }, data: { invoiceId: id, dueDate: inv.dueDate } });
    await audit(tx, ctx, "fatura.itens_vinculados", "SupplierInvoice", id, { payableIds });
  });
}

export async function removePayableFromInvoice(ctx: Ctx, id: string, payableId: string) {
  assertCan(ctx, "finance.manage");
  return prisma.$transaction(async (tx) => {
    await editableInvoice(tx, ctx, id);
    const p = await tx.payable.findFirst({ where: { id: payableId, companyId: ctx.companyId, invoiceId: id } });
    if (!p) throw new AppError("Lançamento não está nesta fatura.", "NOT_FOUND");
    if (p.settledCents > 0) throw new AppError("Lançamento com baixa não pode sair da fatura. Estorne a baixa antes.");
    if (p.origin === "AJUSTE_FATURA") await tx.payable.update({ where: { id: p.id }, data: { status: "CANCELADO", cancelledAt: new Date(), invoiceId: null } });
    else await tx.payable.update({ where: { id: p.id }, data: { invoiceId: null } });
    await audit(tx, ctx, "fatura.item_removido", "SupplierInvoice", id, { payableId });
  });
}

/** A diferença a maior cobrada pelo fornecedor vira um ajuste (conta a pagar) dentro da própria fatura. */
export async function registerInvoiceDifference(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "finance.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Informe o motivo da diferença.");
  return prisma.$transaction(async (tx) => {
    const inv = await editableInvoice(tx, ctx, id);
    const payables = await tx.payable.findMany({ where: { invoiceId: id, companyId: ctx.companyId } });
    const { divergenceCents } = totalsOf(payables, inv.declaredCents);
    if (divergenceCents === 0) throw new AppError("A fatura não tem divergência.");
    if (divergenceCents < 0)
      throw new AppError(
        `A fatura cobra ${money(-divergenceCents)} a menos que o sistema. Revise o custo das vendas vinculadas ou remova itens que não foram faturados.`,
      );
    const n = payables.filter((p) => p.origin === "AJUSTE_FATURA").length + 1;
    const created = await tx.payable.create({
      data: {
        companyId: ctx.companyId,
        sourceKey: `fatura:${id}:ajuste:${n}`,
        origin: "AJUSTE_FATURA",
        supplierId: inv.supplierId,
        invoiceId: id,
        description: `Ajuste da fatura ${inv.number}: ${reason.trim()}`.slice(0, 200),
        category: "FORNECEDORES",
        amountCents: divergenceCents,
        dueDate: inv.dueDate,
        status: "PENDENTE",
      },
    });
    await audit(tx, ctx, "fatura.diferenca_registrada", "SupplierInvoice", id, { amountCents: divergenceCents, payableId: created.id, reason });
  });
}

export async function checkInvoice(ctx: Ctx, id: string) {
  assertCan(ctx, "finance.manage");
  return prisma.$transaction(async (tx) => {
    const inv = await editableInvoice(tx, ctx, id);
    const payables = await tx.payable.findMany({ where: { invoiceId: id, companyId: ctx.companyId } });
    const t = totalsOf(payables, inv.declaredCents);
    if (t.count === 0) throw new AppError("Vincule os lançamentos cobrados nesta fatura antes de conferir.");
    if (t.divergenceCents !== 0) throw new AppError(`Há divergência de ${money(t.divergenceCents)} entre a fatura e o sistema.`, "CONFLICT");
    await tx.supplierInvoice.update({ where: { id }, data: { status: "CONFERIDA", checkedAt: new Date() } });
    await refreshInvoiceStatus(tx, id);
    await audit(tx, ctx, "fatura.conferida", "SupplierInvoice", id);
  });
}

export async function reopenInvoice(ctx: Ctx, id: string) {
  assertCan(ctx, "finance.manage");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!inv) throw new AppError("Fatura não encontrada.", "NOT_FOUND");
    if (inv.status !== "CONFERIDA") throw new AppError("Só faturas conferidas (sem pagamento total) podem ser reabertas.");
    await tx.supplierInvoice.update({ where: { id }, data: { status: "ABERTA", checkedAt: null } });
    await audit(tx, ctx, "fatura.reaberta", "SupplierInvoice", id);
  });
}

/** Quita a fatura: baixa o saldo de cada lançamento vinculado, numa única transação. */
export async function payInvoice(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = invoicePaymentSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!inv) throw new AppError("Fatura não encontrada.", "NOT_FOUND");
    if (inv.status === "PAGA") throw new AppError("Esta fatura já está paga.", "CONFLICT");
    if (inv.status !== "CONFERIDA") throw new AppError("Confira a fatura antes de registrar o pagamento.");
    const open = await tx.payable.findMany({ where: { invoiceId: id, companyId: ctx.companyId, status: { in: ["PENDENTE", "PARCIAL"] } } });
    if (!open.length) throw new AppError("Não há saldo em aberto nesta fatura.");
    let total = 0;
    for (const p of open) {
      const balance = p.amountCents - p.settledCents;
      total += balance;
      await settleEntryTx(
        tx,
        ctx,
        "payable",
        p.id,
        { date: d.date, amountCents: balance, interestCents: 0, discountCents: 0, accountId: d.accountId, method: d.method ?? null, notes: d.notes ?? `Pagamento da fatura ${inv.number}` },
        { viaInvoice: true },
      );
    }
    await refreshInvoiceStatus(tx, id);
    await audit(tx, ctx, "fatura.paga", "SupplierInvoice", id, { amountCents: total, accountId: d.accountId, date: d.date });
    return { amountCents: total };
  });
}

export async function cancelInvoice(ctx: Ctx, id: string) {
  assertCan(ctx, "finance.manage");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.findFirst({ where: { id, companyId: ctx.companyId }, include: { payables: true } });
    if (!inv) throw new AppError("Fatura não encontrada.", "NOT_FOUND");
    if (inv.status === "CANCELADA") return;
    if (inv.payables.some((p) => p.settledCents > 0)) throw new AppError("A fatura tem pagamentos registrados. Estorne-os antes de cancelar.");
    await tx.payable.updateMany({ where: { invoiceId: id, origin: "AJUSTE_FATURA" }, data: { status: "CANCELADO", cancelledAt: new Date() } });
    await tx.payable.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await tx.supplierInvoice.update({ where: { id }, data: { status: "CANCELADA" } });
    await audit(tx, ctx, "fatura.cancelada", "SupplierInvoice", id);
  });
}
