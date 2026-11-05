/**
 * Operação financeira: créditos de clientes, solicitações de edição, conferência de vendas, comissões,
 * repasses entre agências, calendário financeiro, pendências e conciliação por decêndio.
 */
import { z } from "zod";
import { prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { saleScope } from "./sales";
import { clientScope } from "./registry";
import { addDays, addMonths, endOfMonth, isIsoDate } from "@/lib/dates";
import { sum } from "@/lib/money";
import { nationalHolidays } from "@/lib/constants";

const confirmed = { in: ["CONFIRMADA", "CONCLUIDA"] };
const optDate = z.string().optional().nullable().transform((v) => v || null).refine((v) => v === null || isIsoDate(v), "Data inválida.");

// ------------------------------ Créditos de clientes ------------------------------

const creditSchema = z.object({
  clientId: z.string().min(1, "Selecione o cliente."),
  amountCents: z.number().int().min(1, "Informe o valor."),
  reason: z.string().trim().min(3, "Informe o motivo.").max(300),
  supplierName: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  expiresAt: optDate,
  originSaleId: z.string().max(40).optional().nullable().transform((v) => v || null),
});

export async function listCredits(ctx: Ctx, f: { tab?: string; filter?: string }) {
  const t = today(ctx);
  const rows = await prisma.clientCredit.findMany({
    where: { companyId: ctx.companyId, client: clientScope(ctx), status: f.tab === "consumidos" ? "CONSUMIDO" : "ABERTO" },
    include: { client: { select: { id: true, name: true, whatsapp: true } } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
  });
  const soon = addDays(t, 30);
  const state = (c: { expiresAt: string | null }) => (!c.expiresAt ? "VALIDO" : c.expiresAt < t ? "VENCIDO" : c.expiresAt <= soon ? "VENCE_30" : "VALIDO");
  const all = rows.map((r) => ({ ...r, state: state(r) }));
  const open = f.tab === "consumidos" ? [] : all;
  const filtered = f.filter === "validos" ? all.filter((c) => c.state !== "VENCIDO") : f.filter === "30dias" ? all.filter((c) => c.state === "VENCE_30") : f.filter === "vencidos" ? all.filter((c) => c.state === "VENCIDO") : all;
  const saleIds = [...new Set(all.flatMap((c) => [c.originSaleId, c.usedSaleId]).filter(Boolean))] as string[];
  const sales = new Map((await prisma.sale.findMany({ where: { id: { in: saleIds }, companyId: ctx.companyId }, select: { id: true, code: true } })).map((s) => [s.id, s.code]));
  return {
    items: filtered.map((c) => ({ ...c, originCode: c.originSaleId ? sales.get(c.originSaleId) : null, usedCode: c.usedSaleId ? sales.get(c.usedSaleId) : null })),
    stats: {
      totalCents: sum(open.map((c) => c.amountCents)),
      openCount: open.length,
      validCents: sum(open.filter((c) => c.state !== "VENCIDO").map((c) => c.amountCents)),
      validCount: open.filter((c) => c.state !== "VENCIDO").length,
      expiredCents: sum(open.filter((c) => c.state === "VENCIDO").map((c) => c.amountCents)),
      expiredCount: open.filter((c) => c.state === "VENCIDO").length,
      soonCount: open.filter((c) => c.state === "VENCE_30").length,
    },
  };
}

export async function createCredit(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "sales.create");
  const d = creditSchema.parse(raw);
  const client = await prisma.client.findFirst({ where: { AND: [{ id: d.clientId }, clientScope(ctx)] } });
  if (!client) throw new AppError("Cliente inválido.");
  if (d.originSaleId && !(await prisma.sale.findFirst({ where: { id: d.originSaleId, ...saleScope(ctx) } }))) throw new AppError("Venda de origem inválida.");
  return prisma.$transaction(async (tx) => {
    const c = await tx.clientCredit.create({ data: { ...d, companyId: ctx.companyId, status: "ABERTO", createdById: ctx.userId } });
    await audit(tx, ctx, "credito.lancado", "ClientCredit", c.id, { amountCents: d.amountCents, clientId: d.clientId });
    return c.id;
  });
}

/** Marca o crédito como usado por uma venda do mesmo cliente. */
export async function consumeCredit(ctx: Ctx, id: string, saleId: string) {
  assertCan(ctx, "sales.create");
  return prisma.$transaction(async (tx) => {
    const c = await tx.clientCredit.findFirst({ where: { id, companyId: ctx.companyId, status: "ABERTO" } });
    if (!c) throw new AppError("Crédito não encontrado ou já utilizado.", "NOT_FOUND");
    const s = await tx.sale.findFirst({ where: { id: saleId, ...saleScope(ctx), clientId: c.clientId, status: { not: "CANCELADA" } } });
    if (!s) throw new AppError("A venda precisa ser do mesmo cliente e estar ativa.");
    await tx.clientCredit.update({ where: { id }, data: { status: "CONSUMIDO", usedSaleId: saleId, consumedAt: new Date() } });
    await audit(tx, ctx, "credito.consumido", "ClientCredit", id, { saleId });
  });
}

export async function cancelCredit(ctx: Ctx, id: string) {
  assertCan(ctx, "finance.manage");
  const c = await prisma.clientCredit.findFirst({ where: { id, companyId: ctx.companyId, status: "ABERTO" } });
  if (!c) throw new AppError("Crédito não encontrado.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.clientCredit.update({ where: { id }, data: { status: "CANCELADO" } });
    await audit(tx, ctx, "credito.cancelado", "ClientCredit", id);
  });
}

export async function creditSalesOptions(ctx: Ctx, clientId: string) {
  return prisma.sale.findMany({ where: { ...saleScope(ctx), clientId, status: { not: "CANCELADA" } }, select: { id: true, code: true, destination: true, saleDate: true }, orderBy: { saleDate: "desc" }, take: 30 });
}

// ------------------------------ Conferência de vendas e solicitações de edição ------------------------------

export async function listForReview(ctx: Ctx, f: { from: string; to: string; supplierId?: string; status?: string }) {
  assertCan(ctx, "finance.view");
  const sales = await prisma.sale.findMany({
    where: {
      companyId: ctx.companyId,
      status: { in: ["CONFIRMADA", "CONCLUIDA", "CANCELADA"] },
      saleDate: { gte: f.from, lte: f.to },
      ...(f.supplierId ? { items: { some: { OR: [{ supplierId: f.supplierId }, { operatorId: f.supplierId }] } } } : {}),
      ...(f.status === "pendentes" ? { reviewedAt: null } : f.status === "conferidas" ? { reviewedAt: { not: null } } : {}),
    },
    include: {
      client: { select: { name: true } },
      seller: { select: { name: true } },
      items: { select: { supplierCommissionCents: true, overCents: true, commercialModel: true, supplier: { select: { name: true } }, operator: { select: { name: true } } } },
      receivables: { where: { origin: { in: ["COMISSAO_FORNECEDOR"] }, status: { not: "CANCELADO" } }, select: { amountCents: true } },
    },
    orderBy: { saleDate: "asc" },
  });
  const rows = sales.map((s) => ({
    id: s.id,
    code: s.code,
    saleDate: s.saleDate,
    status: s.status,
    client: s.client.name,
    seller: s.seller.name,
    suppliers: [...new Set(s.items.map((i) => (i.operator ?? i.supplier)?.name).filter(Boolean))].join(", "),
    grossCents: s.grossCents,
    commissionCents: sum(s.items.map((i) => i.supplierCommissionCents)),
    overCents: sum(s.items.map((i) => i.overCents)),
    toReceiveCents: sum(s.receivables.map((r) => r.amountCents)),
    reviewedAt: s.reviewedAt,
  }));
  return {
    rows,
    stats: {
      count: rows.length,
      reviewed: rows.filter((r) => r.reviewedAt).length,
      pending: rows.filter((r) => !r.reviewedAt).length,
      commissionCents: sum(rows.map((r) => r.commissionCents)),
      overCents: sum(rows.map((r) => r.overCents)),
      toReceiveCents: sum(rows.map((r) => r.toReceiveCents)),
    },
  };
}

export async function setSaleReviewed(ctx: Ctx, saleId: string, reviewed: boolean) {
  assertCan(ctx, "finance.manage");
  const s = await prisma.sale.findFirst({ where: { id: saleId, companyId: ctx.companyId } });
  if (!s) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  if (s.status === "ORCAMENTO") throw new AppError("Rascunhos não são conferidos.");
  await prisma.$transaction(async (tx) => {
    await tx.sale.update({ where: { id: saleId }, data: reviewed ? { reviewedAt: new Date(), reviewedById: ctx.userId } : { reviewedAt: null, reviewedById: null } });
    await audit(tx, ctx, reviewed ? "venda.conferida" : "venda.conferencia_desfeita", "Sale", saleId);
  });
}

export async function requestSaleEdit(ctx: Ctx, saleId: string, reason: string) {
  if (!reason || reason.trim().length < 5) throw new AppError("Descreva o que precisa ser alterado.");
  const s = await prisma.sale.findFirst({ where: { id: saleId, ...saleScope(ctx) } });
  if (!s) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  if (!s.reviewedAt) throw new AppError("A venda ainda não foi conferida: edite diretamente.");
  if (await prisma.editRequest.findFirst({ where: { saleId, status: { in: ["PENDENTE", "APROVADA"] } } })) throw new AppError("Já existe uma solicitação em aberto para esta venda.");
  await prisma.$transaction(async (tx) => {
    const r = await tx.editRequest.create({ data: { companyId: ctx.companyId, saleId, requestedById: ctx.userId, reason: reason.trim(), status: "PENDENTE" } });
    await audit(tx, ctx, "venda.edicao_solicitada", "Sale", saleId, { requestId: r.id });
  });
}

export async function reviewEditRequest(ctx: Ctx, id: string, approve: boolean, note?: string) {
  assertCan(ctx, "finance.manage");
  const r = await prisma.editRequest.findFirst({ where: { id, companyId: ctx.companyId, status: "PENDENTE" } });
  if (!r) throw new AppError("Solicitação não encontrada.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.editRequest.update({ where: { id }, data: { status: approve ? "APROVADA" : "REJEITADA", reviewedById: ctx.userId, reviewNote: note?.trim() || null, reviewedAt: new Date() } });
    await audit(tx, ctx, approve ? "venda.edicao_aprovada" : "venda.edicao_rejeitada", "Sale", r.saleId, { requestId: id });
  });
}

export async function listEditRequests(ctx: Ctx, status?: string) {
  const mine = !can(ctx, "finance.manage");
  const rows = await prisma.editRequest.findMany({
    where: { companyId: ctx.companyId, ...(status ? { status } : {}), ...(mine ? { requestedById: ctx.userId } : {}) },
    include: { sale: { select: { id: true, code: true, grossCents: true, client: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const users = new Map((await prisma.user.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, requestedBy: users.get(r.requestedById) ?? "—", reviewedBy: r.reviewedById ? users.get(r.reviewedById) ?? "—" : null }));
}

// ------------------------------ Comissões ------------------------------

export async function commissionsByMonth(ctx: Ctx, from: string, to: string, onlyReviewed: boolean) {
  assertCan(ctx, "finance.view");
  const sales = await prisma.sale.findMany({
    where: { companyId: ctx.companyId, status: confirmed, saleDate: { gte: from, lte: to }, ...(onlyReviewed ? { reviewedAt: { not: null } } : {}) },
    include: { seller: { select: { id: true, name: true } }, items: { select: { supplierCommissionCents: true, overCents: true } }, commission: { include: { payable: { select: { id: true, paidCents: true, status: true } } } } },
  });
  const m = new Map<string, { sellerId: string; seller: string; count: number; gross: number; supplierCommission: number; over: number; revenue: number; sellerCommission: number; paid: number; payableIds: string[] }>();
  for (const s of sales) {
    const cur = m.get(s.sellerId) ?? { sellerId: s.sellerId, seller: s.seller.name, count: 0, gross: 0, supplierCommission: 0, over: 0, revenue: 0, sellerCommission: 0, paid: 0, payableIds: [] };
    cur.count++;
    cur.gross += s.grossCents;
    cur.supplierCommission += sum(s.items.map((i) => i.supplierCommissionCents));
    cur.over += sum(s.items.map((i) => i.overCents));
    cur.revenue += s.agencyRevenueCents;
    cur.sellerCommission += s.sellerCommissionCents;
    cur.paid += s.commission?.payable?.paidCents ?? 0;
    if (s.commission?.payable && s.commission.payable.status !== "PAGO") cur.payableIds.push(s.commission.payable.id);
    m.set(s.sellerId, cur);
  }
  const rows = [...m.values()].sort((a, b) => b.sellerCommission - a.sellerCommission);
  return {
    rows,
    totals: {
      supplierCommission: sum(rows.map((r) => r.supplierCommission)),
      over: sum(rows.map((r) => r.over)),
      revenue: sum(rows.map((r) => r.revenue)),
      sellerCommission: sum(rows.map((r) => r.sellerCommission)),
      reviewed: sales.filter((s) => s.reviewedAt).length,
      count: sales.length,
    },
  };
}

// ------------------------------ Repasses entre agências ------------------------------

const transferSchema = z.object({
  counterparty: z.string().trim().min(2, "Informe a agência.").max(120),
  direction: z.enum(["A_REPASSAR", "A_RECEBER"]),
  amountCents: z.number().int().min(1, "Informe o valor."),
  reference: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  dueDate: z.string().refine(isIsoDate, "Data inválida."),
  notes: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
});

/** Cria o repasse e o lançamento correspondente (conta a pagar ou a receber). */
export async function createAgencyTransfer(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = transferSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const t = await tx.agencyTransfer.create({ data: { ...d, companyId: ctx.companyId } });
    const common = { companyId: ctx.companyId, sourceKey: `repasse:${t.id}`, origin: "REPASSE", description: `Repasse ${d.direction === "A_REPASSAR" ? "para" : "de"} ${d.counterparty}${d.reference ? ` · ${d.reference}` : ""}`, amountCents: d.amountCents, dueDate: d.dueDate, status: "PENDENTE", notes: d.notes };
    const entry = d.direction === "A_REPASSAR" ? await tx.payable.create({ data: { ...common, category: "FORNECEDORES" } }) : await tx.receivable.create({ data: { ...common, category: "OUTRAS_RECEITAS" } });
    await tx.agencyTransfer.update({ where: { id: t.id }, data: { entryId: entry.id } });
    await audit(tx, ctx, "repasse.criado", "AgencyTransfer", t.id, d);
    return t.id;
  });
}

export async function listAgencyTransfers(ctx: Ctx, from: string, to: string, status?: string) {
  assertCan(ctx, "finance.view");
  const rows = await prisma.agencyTransfer.findMany({ where: { companyId: ctx.companyId, dueDate: { gte: from, lte: to } }, orderBy: { dueDate: "asc" } });
  const pays = await prisma.payable.findMany({ where: { companyId: ctx.companyId, sourceKey: { in: rows.map((r) => `repasse:${r.id}`) } }, select: { sourceKey: true, status: true, id: true } });
  const recs = await prisma.receivable.findMany({ where: { companyId: ctx.companyId, sourceKey: { in: rows.map((r) => `repasse:${r.id}`) } }, select: { sourceKey: true, status: true, id: true } });
  const st = new Map([...pays, ...recs].map((e) => [e.sourceKey, e]));
  const items = rows
    .map((r) => {
      const e = st.get(`repasse:${r.id}`);
      return { ...r, entryStatus: e?.status ?? "PENDENTE", entryKind: r.direction === "A_REPASSAR" ? "pagar" : "receber", entryId: e?.id ?? null };
    })
    .filter((r) => !status || (status === "pagos" ? r.entryStatus === "PAGO" : r.entryStatus !== "PAGO" && r.entryStatus !== "CANCELADO"));
  const toPay = sum(items.filter((i) => i.direction === "A_REPASSAR" && i.entryStatus !== "CANCELADO").map((i) => i.amountCents));
  const toReceive = sum(items.filter((i) => i.direction === "A_RECEBER" && i.entryStatus !== "CANCELADO").map((i) => i.amountCents));
  const matrix = new Map<string, { counterparty: string; pay: number; receive: number }>();
  for (const i of items) {
    const m = matrix.get(i.counterparty) ?? { counterparty: i.counterparty, pay: 0, receive: 0 };
    if (i.direction === "A_REPASSAR") m.pay += i.amountCents;
    else m.receive += i.amountCents;
    matrix.set(i.counterparty, m);
  }
  return { items, toPay, toReceive, net: toReceive - toPay, matrix: [...matrix.values()] };
}

// ------------------------------ Calendário financeiro ------------------------------

export async function financialCalendar(ctx: Ctx, month: string, onlyPending: boolean) {
  assertCan(ctx, "finance.view");
  const from = `${month}-01`;
  const to = endOfMonth(from);
  const t = today(ctx);
  const open = { in: ["PENDENTE", "PARCIAL"] };
  const [recs, pays, sets] = await Promise.all([
    prisma.receivable.findMany({ where: { companyId: ctx.companyId, status: onlyPending ? open : { not: "CANCELADO" }, dueDate: { gte: from, lte: to } }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true, status: true } }),
    prisma.payable.findMany({ where: { companyId: ctx.companyId, status: onlyPending ? open : { not: "CANCELADO" }, dueDate: { gte: from, lte: to } }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true, status: true } }),
    onlyPending ? Promise.resolve([]) : prisma.settlement.findMany({ where: { companyId: ctx.companyId, reversedAt: null, date: { gte: from, lte: to } }, select: { date: true, kind: true, amountCents: true, receivableId: true, payableId: true } }),
  ]);
  type Ev = { id: string; date: string; kind: "in" | "out"; description: string; amountCents: number; paid: boolean; overdue: boolean; href: string };
  const paidDate = new Map<string, string>();
  for (const s of sets) {
    const k = s.receivableId ?? s.payableId;
    if (k && (!paidDate.has(k) || s.date > paidDate.get(k)!)) paidDate.set(k, s.date);
  }
  const map = (e: (typeof recs)[number], kind: "in" | "out"): Ev => {
    const paid = e.status === "PAGO";
    return {
      id: e.id,
      date: paid && paidDate.get(e.id) && paidDate.get(e.id)! >= from && paidDate.get(e.id)! <= to ? paidDate.get(e.id)! : e.dueDate,
      kind,
      description: e.description,
      amountCents: paid ? e.amountCents : e.amountCents - e.settledCents,
      paid,
      overdue: !paid && e.dueDate < t,
      href: `/financeiro/${kind === "in" ? "receber" : "pagar"}?abrir=${e.id}&periodo=todos`,
    };
  };
  const events = [...recs.map((r) => map(r, "in")), ...pays.map((p) => map(p, "out"))];
  return {
    events,
    holidays: nationalHolidays(Number(month.slice(0, 4))),
    stats: {
      toPay: sum(pays.map((p) => p.amountCents - p.settledCents)),
      paid: sum(pays.map((p) => p.settledCents)),
      toReceive: sum(recs.map((r) => r.amountCents - r.settledCents)),
      received: sum(recs.map((r) => r.settledCents)),
      overdue: events.filter((e) => e.overdue).length,
    },
  };
}

// ------------------------------ Pendências financeiras ------------------------------

export async function financialPendings(ctx: Ctx) {
  assertCan(ctx, "finance.view");
  const t = today(ctx);
  const c = ctx.companyId;
  const open = { in: ["PENDENTE", "PARCIAL"] };
  const [payOver, recOver, invOver, toReview, commNoInvoice, credits, transfers, recurring] = await Promise.all([
    prisma.payable.findMany({ where: { companyId: c, status: open, dueDate: { lt: t }, invoiceId: null }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true }, orderBy: { dueDate: "asc" } }),
    prisma.receivable.findMany({ where: { companyId: c, status: open, dueDate: { lt: t }, origin: { not: "COMISSAO_FORNECEDOR" } }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true }, orderBy: { dueDate: "asc" } }),
    prisma.receivable.findMany({ where: { companyId: c, status: open, dueDate: { lt: t }, origin: "COMISSAO_FORNECEDOR" }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true }, orderBy: { dueDate: "asc" } }),
    prisma.sale.findMany({ where: { companyId: c, status: { in: ["CONFIRMADA", "CONCLUIDA", "CANCELADA"] }, reviewedAt: null, saleDate: { gte: addDays(t, -180) } }, select: { id: true, code: true, saleDate: true, grossCents: true, client: { select: { name: true } } }, orderBy: { saleDate: "asc" } }),
    prisma.payable.findMany({ where: { companyId: c, status: open, origin: "CUSTO_VENDA", invoiceId: null, supplier: { billingCycle: { not: "AVULSO" } } }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true }, orderBy: { dueDate: "asc" } }),
    prisma.clientCredit.findMany({ where: { companyId: c, status: "ABERTO" }, select: { id: true, reason: true, expiresAt: true, amountCents: true, client: { select: { name: true } } } }),
    prisma.receivable.findMany({ where: { companyId: c, status: open, origin: "REPASSE" }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true } }),
    prisma.payable.groupBy({ by: ["recurrenceGroup"], where: { companyId: c, recurrenceGroup: { not: null }, status: { not: "CANCELADO" } }, _max: { dueDate: true }, _sum: { amountCents: true } }),
  ]);
  const nextMonthEnd = endOfMonth(addMonths(t, 1));
  const endingGroups = recurring.filter((g) => g._max.dueDate && g._max.dueDate < nextMonthEnd);
  const lastOfGroups = endingGroups.length
    ? await prisma.payable.findMany({ where: { companyId: c, recurrenceGroup: { in: endingGroups.map((g) => g.recurrenceGroup!) } }, orderBy: { dueDate: "desc" }, select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true, recurrenceGroup: true } })
    : [];
  const fixed = endingGroups.map((g) => lastOfGroups.find((p) => p.recurrenceGroup === g.recurrenceGroup)!).filter(Boolean);
  const bal = (rows: { amountCents: number; settledCents: number }[]) => sum(rows.map((r) => r.amountCents - r.settledCents));
  const entry = (kind: "receber" | "pagar") => (r: { id: string; description: string; dueDate: string; amountCents: number; settledCents: number }) => ({ id: r.id, title: r.description, date: r.dueDate, amountCents: r.amountCents - r.settledCents, href: `/financeiro/${kind}?abrir=${r.id}&periodo=todos` });
  return [
    { key: "pagar", title: "Contas a pagar vencidas", description: "Pendentes com vencimento anterior a hoje.", count: payOver.length, amountCents: bal(payOver), items: payOver.map(entry("pagar")) },
    { key: "faturas", title: "Comissões e repasses de fornecedores vencidos", description: "Valores a receber de operadoras (comissão, over, RAV/DU) com vencimento anterior a hoje.", count: invOver.length, amountCents: bal(invOver), items: invOver.map(entry("receber")) },
    { key: "receber", title: "Contas a receber vencidas", description: "Parcelas de clientes e outros recebimentos com vencimento anterior a hoje.", count: recOver.length, amountCents: bal(recOver), items: recOver.map(entry("receber")) },
    { key: "fixas", title: "Contas fixas terminando", description: "Séries recorrentes sem lançamento depois do próximo mês. Renove em Contas a pagar.", count: fixed.length, amountCents: sum(fixed.map((f) => f.amountCents)), items: fixed.map(entry("pagar")) },
    { key: "conferencia", title: "Vendas aguardando conferência", description: "Vendas dos últimos 180 dias (canceladas inclusive) ainda não conferidas pelo financeiro.", count: toReview.length, amountCents: sum(toReview.map((s) => s.grossCents)), items: toReview.map((s) => ({ id: s.id, title: `${s.code} · ${s.client.name}`, date: s.saleDate, amountCents: s.grossCents, href: `/financeiro/conferencia?venda=${s.id}` })) },
    { key: "sem-fatura", title: "Custos fora da fatura do fornecedor", description: "Custos de fornecedores com faturamento periódico que ainda não entraram em nenhuma fatura.", count: commNoInvoice.length, amountCents: bal(commNoInvoice), items: commNoInvoice.map(entry("pagar")) },
    { key: "creditos", title: "Saldo de clientes (créditos em aberto)", description: "Créditos de clientes ainda não utilizados.", count: credits.length, amountCents: sum(credits.map((c) => c.amountCents)), items: credits.map((c) => ({ id: c.id, title: `${c.client.name} · ${c.reason}`, date: c.expiresAt ?? "", amountCents: c.amountCents, href: "/creditos" })) },
    { key: "repasses", title: "Repasses a receber pendentes", description: "Valores que outras agências precisam repassar.", count: transfers.length, amountCents: bal(transfers), items: transfers.map(entry("receber")) },
  ];
}

// ------------------------------ Conciliação por decêndio ------------------------------

/** Decêndios: 1º = dias 1–10 (vence dia 23), 2º = 11–20 (vence dia 03 do mês seguinte), 3º = 21–fim (vence dia 13 do mês seguinte). */
export function decendios(month: string) {
  const from = `${month}-01`;
  const end = endOfMonth(from);
  const next = addMonths(from, 1).slice(0, 7);
  return [
    { n: 1, from, to: `${month}-10`, closes: `${month}-11`, due: `${month}-23` },
    { n: 2, from: `${month}-11`, to: `${month}-20`, closes: `${month}-21`, due: `${next}-03` },
    { n: 3, from: `${month}-21`, to: end, closes: `${next}-01`, due: `${next}-13` },
  ];
}

export async function decendialReconciliation(ctx: Ctx, supplierId: string | undefined, month: string) {
  assertCan(ctx, "finance.view");
  const suppliers = await prisma.supplier.findMany({ where: { companyId: ctx.companyId, billingCycle: "DECENDIAL", archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const sup = suppliers.find((s) => s.id === supplierId) ?? suppliers[0] ?? null;
  const t = today(ctx);
  if (!sup) return { suppliers, supplier: null, periods: [], invoices: [] };
  const periods = await Promise.all(
    decendios(month).map(async (d) => {
      const items = await prisma.saleItem.findMany({
        where: { companyId: ctx.companyId, OR: [{ supplierId: sup.id }, { operatorId: sup.id }], sale: { status: confirmed, saleDate: { gte: d.from, lte: d.to } } },
        select: { priceCents: true, costCents: true, supplierCommissionCents: true, overCents: true, ravCents: true, duCents: true, saleId: true },
      });
      const state = t < d.from ? "FUTURO" : t <= d.to ? "EM_ANDAMENTO" : t < d.due ? "FECHADO" : "VENCIDO";
      return {
        ...d,
        state,
        progressPct: state === "EM_ANDAMENTO" ? Math.round(((Date.parse(t) - Date.parse(d.from)) / 86400000 + 1) / ((Date.parse(d.to) - Date.parse(d.from)) / 86400000 + 1) * 100) : state === "FUTURO" ? 0 : 100,
        sales: new Set(items.map((i) => i.saleId)).size,
        soldCents: sum(items.map((i) => i.priceCents + i.ravCents + i.duCents)),
        costCents: sum(items.map((i) => i.costCents)),
        commissionCents: sum(items.map((i) => i.supplierCommissionCents)),
        overCents: sum(items.map((i) => i.overCents)),
      };
    }),
  );
  const invoices = await prisma.supplierInvoice.findMany({ where: { companyId: ctx.companyId, supplierId: sup.id, dueDate: { gte: `${month}-01`, lte: endOfMonth(addMonths(`${month}-01`, 1)) } }, include: { payables: { select: { amountCents: true, settledCents: true, status: true } } }, orderBy: { dueDate: "asc" } });
  return {
    suppliers,
    supplier: sup,
    periods,
    invoices: invoices.map((i) => {
      const act = i.payables.filter((p) => p.status !== "CANCELADO");
      return { ...i, systemCents: sum(act.map((p) => p.amountCents)), openCents: sum(act.map((p) => p.amountCents - p.settledCents)) };
    }),
  };
}
