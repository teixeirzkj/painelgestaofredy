import { prisma, type Tx, Prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import {
  accountSchema,
  entryEditSchema,
  manualPayableSchema,
  manualReceivableSchema,
  settlementSchema,
  transferSchema,
} from "./schemas";
import { displayStatus, entryStatus, settlementPrincipal } from "@/lib/finance";
import { addDays, addMonths, startOfMonth, startOfWeek } from "@/lib/dates";
import { splitInstallments, sum } from "@/lib/money";
import { newKey } from "@/lib/utils";
import { emitEvent } from "./automations";
import { refreshCommissionStatus, saleScope } from "./sales";
import { refreshInvoiceStatus } from "./invoices";
import { textContains, entryDelegate } from "./query";
import { ATTACHMENT_KINDS, PAYABLE_CATEGORIES, RECEIVABLE_CATEGORIES } from "@/lib/constants";

export type EntryKind = "receivable" | "payable";

const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------------------------------------------------------------------------
// Listagem
// ---------------------------------------------------------------------------

export type EntryFilters = {
  q?: string;
  status?: string; // PENDENTE | PARCIAL | PAGO | VENCIDO | CANCELADO | ABERTO
  from?: string;
  to?: string;
  category?: string;
  costCenterId?: string;
  supplierId?: string;
  invoice?: "sem" | "com"; // contas a pagar fora/dentro de faturas de fornecedor
  sort?: string; // venc_asc | venc_desc | valor_desc | valor_asc
  page?: number;
};

async function assertCostCenter(tx: Tx, ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  const cc = await tx.costCenter.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!cc) throw new AppError("Centro de custo inválido.");
}

function entryOrder(sort?: string): { dueDate?: "asc" | "desc"; amountCents?: "asc" | "desc"; createdAt?: "asc" }[] {
  if (sort === "venc_desc") return [{ dueDate: "desc" }, { createdAt: "asc" }];
  if (sort === "valor_desc") return [{ amountCents: "desc" }, { dueDate: "asc" }];
  if (sort === "valor_asc") return [{ amountCents: "asc" }, { dueDate: "asc" }];
  return [{ dueDate: "asc" }, { createdAt: "asc" }];
}

function statusWhere(status: string | undefined, t: string) {
  switch (status) {
    case "VENCIDO":
      return { status: { in: ["PENDENTE", "PARCIAL"] }, dueDate: { lt: t } };
    case "ABERTO":
      return { status: { in: ["PENDENTE", "PARCIAL"] } };
    case "PENDENTE":
    case "PARCIAL":
      return { status, dueDate: { gte: t } };
    case "PAGO":
    case "CANCELADO":
      return { status };
    default:
      return { status: { not: "CANCELADO" } };
  }
}

export async function listReceivables(ctx: Ctx, f: EntryFilters) {
  assertCan(ctx, "finance.view");
  const t = today(ctx);
  const sw = statusWhere(f.status, t);
  const where: Prisma.ReceivableWhereInput = {
    companyId: ctx.companyId,
    ...sw,
    ...(f.category ? { category: f.category } : {}),
    ...(f.costCenterId ? { costCenterId: f.costCenterId } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.from || f.to ? { dueDate: { ...(sw.dueDate ?? {}), ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.q
      ? { OR: [{ description: textContains(f.q) }, { client: { name: textContains(f.q) } }, { sale: { code: textContains(f.q) } }] }
      : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [items, total, agg] = await Promise.all([
    prisma.receivable.findMany({
      where,
      orderBy: entryOrder(f.sort),
      skip: (page - 1) * 25,
      take: 25,
      include: {
        client: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        sale: { select: { id: true, code: true } },
        costCenter: { select: { id: true, name: true } },
        settlements: { where: { reversedAt: null }, orderBy: { date: "desc" }, take: 1, select: { date: true, method: true } },
        _count: { select: { attachments: true } },
      },
    }),
    prisma.receivable.count({ where }),
    prisma.receivable.aggregate({ where, _sum: { amountCents: true, settledCents: true, receivedCents: true } }),
  ]);
  return {
    items: items.map((r) => ({ ...r, balanceCents: r.status === "CANCELADO" ? 0 : r.amountCents - r.settledCents, displayStatus: displayStatus(r.status, r.dueDate, t) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 25)),
    totals: {
      amountCents: agg._sum.amountCents ?? 0,
      settledCents: agg._sum.settledCents ?? 0,
      receivedCents: agg._sum.receivedCents ?? 0,
    },
  };
}

export async function listPayables(ctx: Ctx, f: EntryFilters) {
  assertCan(ctx, "finance.view");
  const t = today(ctx);
  const sw = statusWhere(f.status, t);
  const where: Prisma.PayableWhereInput = {
    companyId: ctx.companyId,
    ...(f.invoice === "sem" ? { invoiceId: null } : f.invoice === "com" ? { invoiceId: { not: null } } : {}),
    ...sw,
    ...(f.category ? { category: f.category } : {}),
    ...(f.costCenterId ? { costCenterId: f.costCenterId } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.from || f.to ? { dueDate: { ...(sw.dueDate ?? {}), ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.q
      ? { OR: [{ description: textContains(f.q) }, { supplier: { name: textContains(f.q) } }, { client: { name: textContains(f.q) } }, { sale: { code: textContains(f.q) } }] }
      : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [items, total, agg] = await Promise.all([
    prisma.payable.findMany({
      where,
      orderBy: entryOrder(f.sort),
      skip: (page - 1) * 25,
      take: 25,
      include: {
        supplier: { select: { id: true, name: true } },
        client: { select: { id: true, name: true } },
        sale: { select: { id: true, code: true } },
        costCenter: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true, status: true } },
        settlements: { where: { reversedAt: null }, orderBy: { date: "desc" }, take: 1, select: { date: true, method: true } },
        _count: { select: { attachments: true } },
      },
    }),
    prisma.payable.count({ where }),
    prisma.payable.aggregate({ where, _sum: { amountCents: true, settledCents: true, paidCents: true } }),
  ]);
  return {
    items: items.map((r) => ({ ...r, balanceCents: r.status === "CANCELADO" ? 0 : r.amountCents - r.settledCents, displayStatus: displayStatus(r.status, r.dueDate, t) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 25)),
    totals: { amountCents: agg._sum.amountCents ?? 0, settledCents: agg._sum.settledCents ?? 0, paidCents: agg._sum.paidCents ?? 0 },
  };
}

export async function getEntry(ctx: Ctx, kind: EntryKind, id: string) {
  assertCan(ctx, "finance.view");
  const include = {
    sale: { select: { id: true, code: true } },
    supplier: { select: { id: true, name: true } },
    settlements: { orderBy: { date: "desc" as const }, include: { account: { select: { name: true } }, attachments: true } },
    attachments: true,
    costCenter: { select: { id: true, name: true } },
  };
  const entry =
    kind === "receivable"
      ? await prisma.receivable.findFirst({ where: { id, companyId: ctx.companyId }, include: { ...include, client: { select: { id: true, name: true } } } })
      : await prisma.payable.findFirst({
          where: { id, companyId: ctx.companyId },
          include: { ...include, client: { select: { id: true, name: true } }, invoice: { select: { id: true, number: true, status: true } } },
        });
  if (!entry) throw new AppError("Lançamento não encontrado.", "NOT_FOUND");
  return { ...entry, balanceCents: entry.amountCents - entry.settledCents, displayStatus: displayStatus(entry.status, entry.dueDate, today(ctx)) };
}

// ---------------------------------------------------------------------------
// Lançamentos manuais
// ---------------------------------------------------------------------------

export async function createManualReceivable(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = manualReceivableSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (d.clientId && !(await tx.client.findFirst({ where: { id: d.clientId, companyId: ctx.companyId } }))) throw new AppError("Cliente inválido.");
    if (d.saleId && !(await tx.sale.findFirst({ where: { id: d.saleId, companyId: ctx.companyId } }))) throw new AppError("Venda inválida.");
    await assertCostCenter(tx, ctx, d.costCenterId);
    const parts = splitInstallments(d.amountCents, d.installments);
    const ids: string[] = [];
    for (const [i, amount] of parts.entries()) {
      const r = await tx.receivable.create({
        data: {
          companyId: ctx.companyId,
          origin: "MANUAL",
          clientId: d.clientId,
          saleId: d.saleId,
          description: d.installments > 1 ? `${d.description} (${i + 1}/${d.installments})` : d.description,
          category: d.category,
          costCenterId: d.costCenterId,
          amountCents: amount,
          dueDate: addMonths(d.firstDueDate, i),
          method: d.method ?? null,
          installmentNumber: d.installments > 1 ? i + 1 : null,
          installmentCount: d.installments > 1 ? d.installments : null,
          status: "PENDENTE",
          notes: d.notes,
        },
      });
      ids.push(r.id);
    }
    await audit(tx, ctx, "receber.criado", "Receivable", ids[0], { ids, amountCents: d.amountCents });
    return ids;
  });
}

export async function createManualPayable(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = manualPayableSchema.parse(raw);
  if (d.installments > 1 && d.recurringMonths > 1) throw new AppError("Escolha parcelamento OU recorrência, não ambos.");
  return prisma.$transaction(async (tx) => {
    if (d.supplierId && !(await tx.supplier.findFirst({ where: { id: d.supplierId, companyId: ctx.companyId } }))) throw new AppError("Fornecedor inválido.");
    if (d.saleId && !(await tx.sale.findFirst({ where: { id: d.saleId, companyId: ctx.companyId } }))) throw new AppError("Venda inválida.");
    await assertCostCenter(tx, ctx, d.costCenterId);
    const recurring = d.recurringMonths > 1;
    const parts = recurring ? Array(d.recurringMonths).fill(d.amountCents) : splitInstallments(d.amountCents, d.installments);
    const group = recurring ? newKey() : null;
    const ids: string[] = [];
    for (const [i, amount] of parts.entries()) {
      const p = await tx.payable.create({
        data: {
          companyId: ctx.companyId,
          origin: recurring ? "RECORRENTE" : "MANUAL",
          supplierId: d.supplierId,
          saleId: d.saleId,
          description: parts.length > 1 ? `${d.description} (${i + 1}/${parts.length})` : d.description,
          category: d.category,
          costCenterId: d.costCenterId,
          amountCents: amount,
          dueDate: addMonths(d.firstDueDate, i),
          method: d.method ?? null,
          installmentNumber: parts.length > 1 ? i + 1 : null,
          installmentCount: parts.length > 1 ? parts.length : null,
          recurrenceGroup: group,
          status: "PENDENTE",
          notes: d.notes,
        },
      });
      ids.push(p.id);
    }
    await audit(tx, ctx, "pagar.criado", "Payable", ids[0], { ids, amountCents: d.amountCents, recurring });
    return ids;
  });
}

/** Edição de lançamento. Lançamentos gerados por venda têm valor controlado pela venda. */
export async function updateEntry(ctx: Ctx, kind: EntryKind, id: string, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = entryEditSchema.parse(raw);
  const validCats = kind === "receivable" ? RECEIVABLE_CATEGORIES.values : PAYABLE_CATEGORIES.values;
  if (!(validCats as readonly string[]).includes(d.category)) throw new AppError("Categoria inválida.");
  return prisma.$transaction(async (tx) => {
    const model = entryDelegate(tx, kind);
    const [e] = await model.findMany({ where: { id, companyId: ctx.companyId } });
    if (!e) throw new AppError("Lançamento não encontrado.", "NOT_FOUND");
    if (e.status === "CANCELADO") throw new AppError("Lançamento cancelado não pode ser alterado.");
    if (e.sourceKey && d.amountCents !== e.amountCents)
      throw new AppError("Este lançamento foi gerado por uma venda. Altere o valor pela própria venda.");
    if (d.amountCents < e.settledCents) throw new AppError(`O valor não pode ser menor que o já baixado (${money(e.settledCents)}).`);
    await assertCostCenter(tx, ctx, d.costCenterId);
    if (e.invoiceId && d.dueDate !== e.dueDate)
      throw new AppError("Este lançamento está em uma fatura de fornecedor: o vencimento é o da fatura.");
    await model.update({ where: { id }, data: { ...d, method: d.method ?? null, status: entryStatus(d.amountCents, e.settledCents, false) } });
    await audit(tx, ctx, `${kind === "receivable" ? "receber" : "pagar"}.alterado`, kind === "receivable" ? "Receivable" : "Payable", id, {
      antes: { amountCents: e.amountCents },
      depois: d,
    });
  });
}

/** Cancela um lançamento sem baixas. Lançamentos de venda devem ser ajustados pela venda. */
export async function cancelEntry(ctx: Ctx, kind: EntryKind, id: string) {
  assertCan(ctx, "finance.manage");
  return prisma.$transaction(async (tx) => {
    const model = entryDelegate(tx, kind);
    const [e] = await model.findMany({ where: { id, companyId: ctx.companyId } });
    if (!e) throw new AppError("Lançamento não encontrado.", "NOT_FOUND");
    if (e.status === "CANCELADO") return;
    if (e.settledCents > 0) throw new AppError("Há baixas registradas. Estorne as baixas antes de cancelar.");
    if (e.sourceKey && !e.sourceKey.startsWith("ajuste:")) throw new AppError("Lançamento gerado por venda: ajuste ou cancele pela venda.");
    if (e.invoiceId) throw new AppError("Remova o lançamento da fatura do fornecedor antes de cancelá-lo.");
    await model.update({ where: { id }, data: { status: "CANCELADO", cancelledAt: new Date() } });
    await audit(tx, ctx, `${kind === "receivable" ? "receber" : "pagar"}.cancelado`, kind === "receivable" ? "Receivable" : "Payable", id);
  });
}

// ---------------------------------------------------------------------------
// Baixas (total ou parcial) e estornos
// ---------------------------------------------------------------------------

async function recomputeEntry(tx: Tx, kind: EntryKind, id: string) {
  const settlements = await tx.settlement.findMany({ where: { [kind === "receivable" ? "receivableId" : "payableId"]: id, reversedAt: null } });
  const settledCents = sum(settlements.map((s) => settlementPrincipal(s.amountCents, s.interestCents, s.discountCents)));
  const moved = sum(settlements.map((s) => s.amountCents));
  const model = entryDelegate(tx, kind);
  const [e] = await model.findMany({ where: { id } });
  const status = entryStatus(e.amountCents, settledCents, e.status === "CANCELADO");
  await model.update({
    where: { id },
    data: { settledCents, status, ...(kind === "receivable" ? { receivedCents: moved } : { paidCents: moved }) },
  });
  return { settledCents, status };
}

export async function settleEntry(ctx: Ctx, kind: EntryKind, id: string, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = settlementSchema.parse(raw);
  return prisma.$transaction((tx) => settleEntryTx(tx, ctx, kind, id, d, { viaInvoice: false }));
}

/** Baixa dentro de uma transação existente (usada também na quitação de faturas de fornecedor). */
export async function settleEntryTx(
  tx: Tx,
  ctx: Ctx,
  kind: EntryKind,
  id: string,
  d: { date: string; amountCents: number; interestCents: number; discountCents: number; accountId: string; method?: string | null; notes?: string | null },
  opts: { viaInvoice: boolean },
) {
  const principal = settlementPrincipal(d.amountCents, d.interestCents, d.discountCents);
  if (principal <= 0) throw new AppError("Valor da baixa inválido: o abatimento do saldo deve ser positivo.");
  {
    const model = entryDelegate(tx, kind);
    const [e] = await model.findMany({ where: { id, companyId: ctx.companyId } });
    if (!e) throw new AppError("Lançamento não encontrado.", "NOT_FOUND");
    if (e.status === "CANCELADO") throw new AppError("Lançamento cancelado.");
    if (!opts.viaInvoice && "invoiceId" in e && e.invoiceId)
      throw new AppError("Este lançamento está consolidado em uma fatura de fornecedor. Registre o pagamento pela fatura.");
    const balance = e.amountCents - e.settledCents;
    if (balance <= 0) throw new AppError("Lançamento já está quitado.");
    if (principal > balance)
      throw new AppError(`O valor abatido (${money(principal)}) é maior que o saldo em aberto (${money(balance)}).`);
    const account = await tx.financialAccount.findFirst({ where: { id: d.accountId, companyId: ctx.companyId, active: true } });
    if (!account) throw new AppError("Conta financeira inválida.");

    const s = await tx.settlement.create({
      data: {
        companyId: ctx.companyId,
        kind: kind === "receivable" ? "RECEBIMENTO" : "PAGAMENTO",
        ...(kind === "receivable" ? { receivableId: id } : { payableId: id }),
        accountId: account.id,
        date: d.date,
        amountCents: d.amountCents,
        interestCents: d.interestCents,
        discountCents: d.discountCents,
        method: d.method ?? null,
        notes: d.notes,
        createdById: ctx.userId,
      },
    });
    const after = await recomputeEntry(tx, kind, id);
    await afterSettlementChange(tx, ctx, kind, id, s.id, "baixa");
    await audit(tx, ctx, kind === "receivable" ? "receber.baixa" : "pagar.baixa", kind === "receivable" ? "Receivable" : "Payable", id, {
      settlementId: s.id,
      amountCents: d.amountCents,
      principalCents: principal,
      status: after.status,
    });
    return { settlementId: s.id, status: after.status };
  }
}

export async function reverseSettlement(ctx: Ctx, settlementId: string, reason: string) {
  assertCan(ctx, "finance.manage");
  if (!reason || reason.trim().length < 3) throw new AppError("Informe o motivo do estorno.");
  return prisma.$transaction(async (tx) => {
    const s = await tx.settlement.findFirst({ where: { id: settlementId, companyId: ctx.companyId } });
    if (!s) throw new AppError("Baixa não encontrada.", "NOT_FOUND");
    if (s.reversedAt) throw new AppError("Esta baixa já foi estornada.");
    await tx.settlement.update({ where: { id: s.id }, data: { reversedAt: new Date(), reversalReason: reason.trim() } });
    await tx.bankStatementLine.updateMany({ where: { settlementId: s.id }, data: { status: "PENDENTE", settlementId: null } });
    const kind: EntryKind = s.receivableId ? "receivable" : "payable";
    const entryId = (s.receivableId ?? s.payableId)!;
    await recomputeEntry(tx, kind, entryId);
    await afterSettlementChange(tx, ctx, kind, entryId, s.id, "estorno");
    await audit(tx, ctx, "baixa.estornada", "Settlement", s.id, { reason, amountCents: s.amountCents });
  });
}

async function afterSettlementChange(tx: Tx, ctx: Ctx, kind: EntryKind, entryId: string, settlementId: string, op: "baixa" | "estorno") {
  if (kind === "payable") {
    const p = await tx.payable.findUnique({ where: { id: entryId }, select: { commissionId: true, invoiceId: true } });
    if (p?.commissionId) await refreshCommissionStatus(tx, p.commissionId);
    if (p?.invoiceId) await refreshInvoiceStatus(tx, p.invoiceId);
    return;
  }
  if (op !== "baixa") return;
  const r = await tx.receivable.findUnique({ where: { id: entryId }, include: { sale: { select: { id: true, code: true } }, client: true } });
  if (!r?.sale) return;
  await emitEvent(tx, ctx.companyId, "pagamento_identificado.evento", {
    type: "pagamento.identificado",
    entityType: "Settlement",
    entityId: settlementId,
    idempotencyKey: `pagamento.identificado:${settlementId}`,
    payload: {
      saleId: r.sale.id,
      saleCode: r.sale.code,
      receivableId: r.id,
      status: r.status,
      balanceCents: r.amountCents - r.settledCents,
      client: r.client ? { id: r.client.id, name: r.client.name, fredyContactId: r.client.fredyContactId } : null,
      messagingAllowed: !!r.client?.consentMessaging,
    },
  });
}

// ---------------------------------------------------------------------------
// Contas financeiras e transferências
// ---------------------------------------------------------------------------

export async function listAccounts(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  assertCan(ctx, "finance.view");
  const accounts = await prisma.financialAccount.findMany({
    where: { companyId: ctx.companyId, ...(opts.includeInactive ? {} : { active: true }) },
    orderBy: { name: "asc" },
  });
  const balances = await accountBalances(ctx.companyId, null);
  return accounts.map((a) => ({ ...a, balanceCents: a.initialBalanceCents + (balances.get(a.id) ?? 0) }));
}

/** Movimentação realizada por conta até uma data (inclusive). null = sem limite. */
async function accountBalances(companyId: string, upTo: string | null) {
  const dateFilter = upTo ? { date: { lte: upTo } } : {};
  const [settlements, transfers] = await Promise.all([
    prisma.settlement.groupBy({
      by: ["accountId", "kind"],
      where: { companyId, reversedAt: null, ...dateFilter },
      _sum: { amountCents: true },
    }),
    prisma.transfer.findMany({ where: { companyId, reversedAt: null, ...dateFilter }, select: { fromAccountId: true, toAccountId: true, amountCents: true } }),
  ]);
  const m = new Map<string, number>();
  const add = (id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const s of settlements) add(s.accountId, (s.kind === "RECEBIMENTO" ? 1 : -1) * (s._sum.amountCents ?? 0));
  for (const t of transfers) {
    add(t.fromAccountId, -t.amountCents);
    add(t.toAccountId, t.amountCents);
  }
  return m;
}

export async function saveAccount(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = accountSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const a = await tx.financialAccount.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!a) throw new AppError("Conta não encontrada.", "NOT_FOUND");
      const hasMovement = (await tx.settlement.count({ where: { accountId: id } })) + (await tx.transfer.count({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] } }));
      if (hasMovement && d.initialBalanceCents !== a.initialBalanceCents)
        throw new AppError("A conta já possui movimentações; o saldo inicial não pode ser alterado.");
      await tx.financialAccount.update({ where: { id }, data: d });
      await audit(tx, ctx, "conta.alterada", "FinancialAccount", id, d);
      return id;
    }
    const a = await tx.financialAccount.create({ data: { ...d, companyId: ctx.companyId } });
    await audit(tx, ctx, "conta.criada", "FinancialAccount", a.id, d);
    return a.id;
  });
}

export async function setAccountActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "finance.manage");
  const a = await prisma.financialAccount.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!a) throw new AppError("Conta não encontrada.", "NOT_FOUND");
  await prisma.financialAccount.update({ where: { id }, data: { active } });
}

/** Transferência entre contas: movimenta saldos sem gerar receita nem despesa. */
export async function createTransfer(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = transferSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const count = await tx.financialAccount.count({ where: { id: { in: [d.fromAccountId, d.toAccountId] }, companyId: ctx.companyId } });
    if (count !== 2) throw new AppError("Contas inválidas.");
    const t = await tx.transfer.create({ data: { ...d, companyId: ctx.companyId } });
    await audit(tx, ctx, "transferencia.criada", "Transfer", t.id, d);
    return t.id;
  });
}

export async function reverseTransfer(ctx: Ctx, id: string) {
  assertCan(ctx, "finance.manage");
  const t = await prisma.transfer.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!t) throw new AppError("Transferência não encontrada.", "NOT_FOUND");
  if (t.reversedAt) throw new AppError("Transferência já estornada.");
  await prisma.$transaction(async (tx) => {
    await tx.transfer.update({ where: { id }, data: { reversedAt: new Date() } });
    await audit(tx, ctx, "transferencia.estornada", "Transfer", id);
  });
}

export async function listTransfers(ctx: Ctx) {
  assertCan(ctx, "finance.view");
  return prisma.transfer.findMany({
    where: { companyId: ctx.companyId },
    include: { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
}

// ---------------------------------------------------------------------------
// Fluxo de caixa
// ---------------------------------------------------------------------------

export type CashflowGranularity = "dia" | "semana" | "mes";

export type CashflowRow = {
  key: string;
  start: string;
  plannedIn: number; // entradas previstas (saldo em aberto com vencimento no período)
  plannedOut: number;
  realizedIn: number; // entradas efetivamente movimentadas
  realizedOut: number;
  realizedBalance: number; // saldo realizado acumulado ao fim do período
  projectedBalance: number; // saldo projetado acumulado (realizado + previsto em aberto)
};

function bucketOf(date: string, g: CashflowGranularity) {
  if (g === "dia") return date;
  if (g === "semana") return startOfWeek(date);
  return startOfMonth(date);
}

/**
 * Fluxo de caixa. Valores PREVISTOS consideram apenas o saldo ainda em aberto de cada
 * lançamento (nunca o valor original), para não somar duas vezes o que já foi realizado.
 * Transferências entre contas só afetam o fluxo quando filtrado por conta.
 */
export async function cashflow(
  ctx: Ctx,
  opts: { from: string; to: string; granularity: CashflowGranularity; accountId?: string; category?: string },
) {
  assertCan(ctx, "finance.view");
  const { from, to, granularity: g, accountId, category } = opts;
  const t = today(ctx);

  const accounts = await prisma.financialAccount.findMany({ where: { companyId: ctx.companyId, ...(accountId ? { id: accountId } : {}) } });
  if (accountId && accounts.length === 0) throw new AppError("Conta inválida.");
  const accIds = accounts.map((a) => a.id);
  const initial = sum(accounts.map((a) => a.initialBalanceCents));
  const before = await accountBalances(ctx.companyId, addDays(from, -1));
  let openingBalance = initial + sum(accIds.map((id) => before.get(id) ?? 0));
  if (!accountId) {
    // transferências internas se anulam quando consideramos todas as contas
  }

  const settlementWhere: Prisma.SettlementWhereInput = {
    companyId: ctx.companyId,
    reversedAt: null,
    date: { gte: from, lte: to },
    ...(accountId ? { accountId } : {}),
    ...(category ? { OR: [{ receivable: { category } }, { payable: { category } }] } : {}),
  };
  const [settlements, openRec, openPay, transfers] = await Promise.all([
    prisma.settlement.findMany({ where: settlementWhere, select: { date: true, kind: true, amountCents: true } }),
    accountId
      ? Promise.resolve([])
      : prisma.receivable.findMany({
          where: { companyId: ctx.companyId, status: { in: ["PENDENTE", "PARCIAL"] }, dueDate: { lte: to }, ...(category ? { category } : {}) },
          select: { dueDate: true, amountCents: true, settledCents: true },
        }),
    accountId
      ? Promise.resolve([])
      : prisma.payable.findMany({
          where: { companyId: ctx.companyId, status: { in: ["PENDENTE", "PARCIAL"] }, dueDate: { lte: to }, ...(category ? { category } : {}) },
          select: { dueDate: true, amountCents: true, settledCents: true },
        }),
    accountId && !category
      ? prisma.transfer.findMany({
          where: { companyId: ctx.companyId, reversedAt: null, date: { gte: from, lte: to }, OR: [{ fromAccountId: accountId }, { toAccountId: accountId }] },
        })
      : Promise.resolve([]),
  ]);
  if (category) openingBalance = 0; // por categoria, mostramos apenas o movimento

  const rows = new Map<string, CashflowRow>();
  let cur = bucketOf(from, g);
  while (cur <= to) {
    rows.set(cur, { key: cur, start: cur, plannedIn: 0, plannedOut: 0, realizedIn: 0, realizedOut: 0, realizedBalance: 0, projectedBalance: 0 });
    cur = g === "dia" ? addDays(cur, 1) : g === "semana" ? addDays(cur, 7) : addMonths(cur, 1);
  }
  const firstKey = bucketOf(from, g);
  // Atrasados (vencidos antes do período e ainda em aberto) entram no primeiro período como previstos,
  // e previsões vencidas no passado são reprojetadas para "hoje" se hoje estiver no período.
  const plannedKey = (due: string) => {
    if (due < from) return firstKey;
    if (due < t && t >= from && t <= to) return bucketOf(t, g);
    return bucketOf(due, g);
  };
  for (const r of openRec) rows.get(plannedKey(r.dueDate))!.plannedIn += r.amountCents - r.settledCents;
  for (const p of openPay) rows.get(plannedKey(p.dueDate))!.plannedOut += p.amountCents - p.settledCents;
  for (const s of settlements) {
    const row = rows.get(bucketOf(s.date, g))!;
    if (s.kind === "RECEBIMENTO") row.realizedIn += s.amountCents;
    else row.realizedOut += s.amountCents;
  }
  for (const tr of transfers) {
    const row = rows.get(bucketOf(tr.date, g))!;
    if (tr.toAccountId === accountId) row.realizedIn += tr.amountCents;
    else row.realizedOut += tr.amountCents;
  }

  let realized = openingBalance;
  let projected = openingBalance;
  const list = [...rows.values()];
  for (const row of list) {
    realized += row.realizedIn - row.realizedOut;
    projected += row.realizedIn - row.realizedOut + row.plannedIn - row.plannedOut;
    row.realizedBalance = realized;
    row.projectedBalance = projected;
  }
  return {
    openingBalance,
    rows: list,
    totals: {
      plannedIn: sum(list.map((r) => r.plannedIn)),
      plannedOut: sum(list.map((r) => r.plannedOut)),
      realizedIn: sum(list.map((r) => r.realizedIn)),
      realizedOut: sum(list.map((r) => r.realizedOut)),
    },
    realizedBalance: realized,
    projectedBalance: projected,
    byAccount: !!accountId,
    canManage: can(ctx, "finance.manage"),
  };
}

// ---------------------------------------------------------------------------
// Anexos (comprovantes)
// ---------------------------------------------------------------------------

export const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type AttachmentTarget = { kind: EntryKind | "sale" | "trip" | "invoice"; id: string };

/** Valida o acesso ao destino do anexo (lançamento, venda, viagem ou fatura) dentro da empresa. */
export async function assertAttachmentTarget(ctx: Ctx, target: AttachmentTarget, write: boolean) {
  if (target.kind === "receivable" || target.kind === "payable") {
    assertCan(ctx, write ? "finance.manage" : "finance.view");
    const [e] = await entryDelegate(prisma as unknown as Tx, target.kind).findMany({ where: { id: target.id, companyId: ctx.companyId } });
    if (!e) throw new AppError("Lançamento não encontrado.", "NOT_FOUND");
  } else if (target.kind === "invoice") {
    assertCan(ctx, write ? "finance.manage" : "finance.view");
    if (!(await prisma.supplierInvoice.findFirst({ where: { id: target.id, companyId: ctx.companyId } }))) throw new AppError("Fatura não encontrada.", "NOT_FOUND");
  } else if (target.kind === "sale") {
    const sale = await prisma.sale.findFirst({ where: { id: target.id, ...saleScope(ctx) } });
    if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  } else {
    const trip = await prisma.trip.findFirst({ where: { id: target.id, companyId: ctx.companyId, ...(can(ctx, "sales.view_all") ? {} : { sales: { some: { sellerId: ctx.userId } } }) } });
    if (!trip) throw new AppError("Viagem não encontrada.", "NOT_FOUND");
  }
}

const targetField = { receivable: "receivableId", payable: "payableId", sale: "saleId", trip: "tripId", invoice: "invoiceId" } as const;

export async function registerAttachment(
  ctx: Ctx,
  target: AttachmentTarget,
  file: { fileName: string; mimeType: string; sizeBytes: number; storageKey: string; kind?: string },
) {
  if (!ALLOWED_MIME.includes(file.mimeType)) throw new AppError("Formato não permitido. Envie PDF, PNG, JPG ou WEBP.");
  if (file.sizeBytes > MAX_ATTACHMENT_BYTES) throw new AppError("Arquivo maior que 5 MB.");
  await assertAttachmentTarget(ctx, target, true);
  const kind = file.kind && ATTACHMENT_KINDS.values.includes(file.kind as never) ? file.kind : target.kind === "invoice" ? "FATURA" : target.kind === "sale" || target.kind === "trip" ? "DOCUMENTO" : "COMPROVANTE";
  return prisma.$transaction(async (tx) => {
    const a = await tx.attachment.create({
      data: {
        companyId: ctx.companyId,
        [targetField[target.kind]]: target.id,
        kind,
        fileName: file.fileName.slice(0, 200),
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storageKey: file.storageKey,
        uploadedById: ctx.userId,
      },
    });
    await audit(tx, ctx, "anexo.enviado", "Attachment", a.id, { target, kind });
    return a.id;
  });
}

export async function getAttachment(ctx: Ctx, id: string) {
  const a = await prisma.attachment.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!a) throw new AppError("Anexo não encontrado.", "NOT_FOUND");
  const target: AttachmentTarget | null = a.saleId
    ? { kind: "sale", id: a.saleId }
    : a.tripId
      ? { kind: "trip", id: a.tripId }
      : a.invoiceId
        ? { kind: "invoice", id: a.invoiceId }
        : null;
  if (target) await assertAttachmentTarget(ctx, target, false);
  else assertCan(ctx, "finance.view");
  return a;
}

export async function financeOptions(ctx: Ctx) {
  const [accounts, clients, suppliers, costCenters] = await Promise.all([
    prisma.financialAccount.findMany({ where: { companyId: ctx.companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: { companyId: ctx.companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    prisma.supplier.findMany({ where: { companyId: ctx.companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.costCenter.findMany({ where: { companyId: ctx.companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { accounts, clients, suppliers, costCenters };
}

/** Indicadores do topo do módulo financeiro (posição atual, sem filtro de período). */
export async function financeOverview(ctx: Ctx) {
  assertCan(ctx, "finance.view");
  const t = today(ctx);
  const c = ctx.companyId;
  const open = { in: ["PENDENTE", "PARCIAL"] };
  const [rec, recOver, pay, payOver, payWeek, accounts] = await Promise.all([
    prisma.receivable.aggregate({ where: { companyId: c, status: open }, _sum: { amountCents: true, settledCents: true }, _count: { _all: true } }),
    prisma.receivable.aggregate({ where: { companyId: c, status: open, dueDate: { lt: t } }, _sum: { amountCents: true, settledCents: true }, _count: { _all: true } }),
    prisma.payable.aggregate({ where: { companyId: c, status: open }, _sum: { amountCents: true, settledCents: true }, _count: { _all: true } }),
    prisma.payable.aggregate({ where: { companyId: c, status: open, dueDate: { lt: t } }, _sum: { amountCents: true, settledCents: true }, _count: { _all: true } }),
    prisma.payable.aggregate({ where: { companyId: c, status: open, dueDate: { gte: t, lte: addDays(t, 7) } }, _sum: { amountCents: true, settledCents: true } }),
    listAccounts(ctx),
  ]);
  const bal = (a: { _sum: { amountCents: number | null; settledCents: number | null } }) => (a._sum.amountCents ?? 0) - (a._sum.settledCents ?? 0);
  return {
    receivableCents: bal(rec),
    receivableCount: rec._count._all,
    overdueReceivableCents: bal(recOver),
    overdueReceivableCount: recOver._count._all,
    payableCents: bal(pay),
    payableCount: pay._count._all,
    overduePayableCents: bal(payOver),
    payableWeekCents: bal(payWeek),
    balanceCents: sum(accounts.map((a) => a.balanceCents)),
  };
}
