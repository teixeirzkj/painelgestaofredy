/** Equipe: metas, ranking, tarefas, painel do vendedor, aniversariantes, calendário pessoal, embarques e destinos. */
import { z } from "zod";
import { prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { saleScope } from "./sales";
import { clientScope } from "./registry";
import { addDays, endOfMonth, isIsoDate } from "@/lib/dates";
import { ratioBps, sum } from "@/lib/money";
import { TASK_PRIORITY, TASK_STATUS, TASK_TYPES } from "@/lib/constants";

const confirmed = { in: ["CONFIRMADA", "CONCLUIDA"] };
const range = (month: string) => ({ from: `${month}-01`, to: endOfMonth(`${month}-01`) });

// ------------------------------ Metas ------------------------------

const goalSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  scope: z.enum(["LOJA", "VENDEDOR", "FORNECEDOR"]),
  targetId: z.string().max(40).default(""),
  metric: z.enum(["FATURAMENTO", "RECEITA"]).default("FATURAMENTO"),
  amountCents: z.number().int().min(0).max(2_000_000_000),
  superAmountCents: z.number().int().min(0).max(2_000_000_000).default(0),
});

export async function saveGoal(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "users.manage");
  const d = goalSchema.parse(raw);
  if (d.scope === "LOJA") d.targetId = "";
  else if (!d.targetId) throw new AppError("Selecione o vendedor ou fornecedor.");
  if (d.scope === "VENDEDOR" && !(await prisma.user.findFirst({ where: { id: d.targetId, companyId: ctx.companyId } }))) throw new AppError("Vendedor inválido.");
  if (d.scope === "FORNECEDOR" && !(await prisma.supplier.findFirst({ where: { id: d.targetId, companyId: ctx.companyId } }))) throw new AppError("Fornecedor inválido.");
  if (!d.superAmountCents) d.superAmountCents = Math.round(d.amountCents * 1.5);
  await prisma.$transaction(async (tx) => {
    if (d.amountCents === 0) await tx.goal.deleteMany({ where: { companyId: ctx.companyId, month: d.month, scope: d.scope, targetId: d.targetId } });
    else
      await tx.goal.upsert({
        where: { companyId_month_scope_targetId: { companyId: ctx.companyId, month: d.month, scope: d.scope, targetId: d.targetId } },
        create: { ...d, companyId: ctx.companyId },
        update: { metric: d.metric, amountCents: d.amountCents, superAmountCents: d.superAmountCents },
      });
    await audit(tx, ctx, "meta.salva", "Goal", null, d);
  });
}

/** Realizado do mês por vendedor e fornecedor (faturamento e receita da agência). */
async function monthRealized(ctx: Ctx, month: string) {
  const { from, to } = range(month);
  const sales = await prisma.sale.findMany({
    where: { companyId: ctx.companyId, status: confirmed, saleDate: { gte: from, lte: to } },
    select: { sellerId: true, grossCents: true, agencyRevenueCents: true, grossProfitCents: true, sellerCommissionCents: true, items: { select: { supplierId: true, operatorId: true, priceCents: true, ravCents: true, duCents: true } } },
  });
  const bySeller = new Map<string, { gross: number; revenue: number; profit: number; commission: number; count: number }>();
  const bySupplier = new Map<string, number>();
  for (const s of sales) {
    const cur = bySeller.get(s.sellerId) ?? { gross: 0, revenue: 0, profit: 0, commission: 0, count: 0 };
    cur.gross += s.grossCents;
    cur.revenue += s.agencyRevenueCents;
    cur.profit += s.grossProfitCents;
    cur.commission += s.sellerCommissionCents;
    cur.count++;
    bySeller.set(s.sellerId, cur);
    for (const i of s.items) {
      const k = i.operatorId ?? i.supplierId;
      if (k) bySupplier.set(k, (bySupplier.get(k) ?? 0) + i.priceCents + i.ravCents + i.duCents);
    }
  }
  return {
    gross: sum(sales.map((s) => s.grossCents)),
    revenue: sum(sales.map((s) => s.agencyRevenueCents)),
    bySeller,
    bySupplier,
  };
}

export async function getGoals(ctx: Ctx, month: string) {
  const [goals, sellers, suppliers, real] = await Promise.all([
    prisma.goal.findMany({ where: { companyId: ctx.companyId, month } }),
    prisma.user.findMany({ where: { companyId: ctx.companyId, active: true, role: { in: ["VENDEDOR", "GESTOR", "ADMIN"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { companyId: ctx.companyId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    monthRealized(ctx, month),
  ]);
  const store = goals.find((g) => g.scope === "LOJA") ?? null;
  const value = (metric: string, g: number, r: number) => (metric === "RECEITA" ? r : g);
  return {
    store: store ? { ...store, realized: value(store.metric, real.gross, real.revenue) } : null,
    realizedGross: real.gross,
    sellers: sellers.map((s) => {
      const g = goals.find((x) => x.scope === "VENDEDOR" && x.targetId === s.id) ?? null;
      const r = real.bySeller.get(s.id);
      return { ...s, goal: g, realized: g ? value(g.metric, r?.gross ?? 0, r?.revenue ?? 0) : r?.gross ?? 0, count: r?.count ?? 0 };
    }),
    suppliers: goals
      .filter((g) => g.scope === "FORNECEDOR")
      .map((g) => ({ goal: g, name: suppliers.find((s) => s.id === g.targetId)?.name ?? "Fornecedor", realized: real.bySupplier.get(g.targetId) ?? 0 })),
    supplierOptions: suppliers,
  };
}

export async function getRanking(ctx: Ctx, month: string) {
  const [real, users, goals] = await Promise.all([
    monthRealized(ctx, month),
    prisma.user.findMany({ where: { companyId: ctx.companyId, role: { in: ["VENDEDOR", "GESTOR", "ADMIN"] } }, select: { id: true, name: true, active: true } }),
    prisma.goal.findMany({ where: { companyId: ctx.companyId, month, scope: "VENDEDOR" } }),
  ]);
  const showMargin = can(ctx, "sales.view_margin");
  const rows = users
    .map((u) => {
      const r = real.bySeller.get(u.id) ?? { gross: 0, revenue: 0, profit: 0, commission: 0, count: 0 };
      const g = goals.find((x) => x.targetId === u.id);
      return { id: u.id, name: u.name, ...r, profit: showMargin ? r.profit : null, revenue: showMargin ? r.revenue : null, ticket: r.count ? Math.round(r.gross / r.count) : 0, goalBps: g ? ratioBps(r.gross, g.amountCents) : null };
    })
    .filter((r) => r.count > 0 || users.find((u) => u.id === r.id)?.active)
    .sort((a, b) => b.gross - a.gross);
  const active = rows.filter((r) => r.count > 0);
  return {
    rows,
    total: real.gross,
    average: active.length ? Math.round(real.gross / active.length) : 0,
    best: active[0] ?? null,
    activeSellers: active.length,
  };
}

// ------------------------------ Tarefas ------------------------------

const taskSchema = z.object({
  title: z.string().trim().min(2, "Informe o título.").max(150),
  description: z.string().trim().max(2000).optional().nullable().transform((v) => v || null),
  type: z.enum(TASK_TYPES.values).default("FOLLOW_UP"),
  priority: z.enum(TASK_PRIORITY.values).default("MEDIA"),
  status: z.enum(TASK_STATUS.values).default("PENDENTE"),
  dueDate: z.string().optional().nullable().transform((v) => v || null).refine((v) => v === null || isIsoDate(v), "Data inválida."),
  assigneeId: z.string().max(40).optional().nullable().transform((v) => v || null),
  clientId: z.string().max(40).optional().nullable().transform((v) => v || null),
});

function taskScope(ctx: Ctx) {
  return can(ctx, "sales.view_all") ? { companyId: ctx.companyId } : { companyId: ctx.companyId, OR: [{ assigneeId: ctx.userId }, { createdById: ctx.userId }] };
}

export async function listTasks(ctx: Ctx, f: { status?: string; priority?: string; assigneeId?: string; month?: string }) {
  const t = today(ctx);
  const rows = await prisma.task.findMany({
    where: {
      ...taskScope(ctx),
      ...(f.status ? { status: f.status } : { status: { in: ["PENDENTE", "EM_ANDAMENTO"] } }),
      ...(f.priority ? { priority: f.priority } : {}),
      ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
    },
    include: { client: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  const all = await prisma.task.findMany({ where: taskScope(ctx), select: { status: true, dueDate: true, completedAt: true } });
  const monthStart = new Date(`${t.slice(0, 7)}-01T00:00:00`);
  const users = await prisma.user.findMany({ where: { companyId: ctx.companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: rows.map((r) => ({ ...r, assigneeName: r.assigneeId ? names.get(r.assigneeId) ?? "—" : "Sem responsável", overdue: !!r.dueDate && r.dueDate < t && (r.status === "PENDENTE" || r.status === "EM_ANDAMENTO") })),
    stats: {
      pending: all.filter((x) => x.status === "PENDENTE").length,
      inProgress: all.filter((x) => x.status === "EM_ANDAMENTO").length,
      overdue: all.filter((x) => (x.status === "PENDENTE" || x.status === "EM_ANDAMENTO") && x.dueDate && x.dueDate < t).length,
      doneThisMonth: all.filter((x) => x.status === "CONCLUIDA" && x.completedAt && x.completedAt >= monthStart).length,
    },
    users,
  };
}

export async function saveTask(ctx: Ctx, id: string | null, raw: unknown) {
  const d = taskSchema.parse(raw);
  if (d.assigneeId && !(await prisma.user.findFirst({ where: { id: d.assigneeId, companyId: ctx.companyId } }))) throw new AppError("Responsável inválido.");
  if (d.clientId && !(await prisma.client.findFirst({ where: { AND: [{ id: d.clientId }, clientScope(ctx)] } }))) throw new AppError("Cliente inválido.");
  return prisma.$transaction(async (tx) => {
    const completedAt = d.status === "CONCLUIDA" ? new Date() : null;
    if (id) {
      const t = await tx.task.findFirst({ where: { id, ...taskScope(ctx) } });
      if (!t) throw new AppError("Tarefa não encontrada.", "NOT_FOUND");
      await tx.task.update({ where: { id }, data: { ...d, completedAt: d.status === "CONCLUIDA" ? t.completedAt ?? completedAt : null } });
    } else id = (await tx.task.create({ data: { ...d, companyId: ctx.companyId, createdById: ctx.userId, assigneeId: d.assigneeId ?? ctx.userId, completedAt } })).id;
    await audit(tx, ctx, "tarefa.salva", "Task", id, { title: d.title, status: d.status });
    return id;
  });
}

export async function setTaskStatus(ctx: Ctx, id: string, status: string) {
  if (!(TASK_STATUS.values as readonly string[]).includes(status)) throw new AppError("Status inválido.");
  const t = await prisma.task.findFirst({ where: { id, ...taskScope(ctx) } });
  if (!t) throw new AppError("Tarefa não encontrada.", "NOT_FOUND");
  await prisma.task.update({ where: { id }, data: { status, completedAt: status === "CONCLUIDA" ? new Date() : null } });
}

// ------------------------------ Aniversariantes ------------------------------

export async function birthdays(ctx: Ctx, month: string, who: "todos" | "clientes" | "equipe" = "todos") {
  const mm = month.slice(5, 7);
  const [clients, users] = await Promise.all([
    who !== "equipe"
      ? prisma.client.findMany({ where: { AND: [clientScope(ctx), { archivedAt: null, birthDate: { not: null } }] }, select: { id: true, name: true, birthDate: true, whatsapp: true, phone: true, email: true, consentMessaging: true } })
      : Promise.resolve([]),
    who !== "clientes" ? prisma.user.findMany({ where: { companyId: ctx.companyId, active: true, birthDate: { not: null } }, select: { id: true, name: true, birthDate: true, phone: true, email: true } }) : Promise.resolve([]),
  ]);
  const t = today(ctx);
  const year = Number(month.slice(0, 4));
  const rows = [
    ...clients.filter((c) => c.birthDate!.slice(5, 7) === mm).map((c) => ({ kind: "Cliente" as const, id: c.id, name: c.name, birthDate: c.birthDate!, contact: c.whatsapp ?? c.phone ?? c.email, consent: c.consentMessaging, href: `/clientes/${c.id}` })),
    ...users.filter((u) => u.birthDate!.slice(5, 7) === mm).map((u) => ({ kind: "Equipe" as const, id: u.id, name: u.name, birthDate: u.birthDate!, contact: u.phone ?? u.email, consent: true, href: null })),
  ]
    .map((r) => ({ ...r, day: r.birthDate.slice(8, 10), age: year - Number(r.birthDate.slice(0, 4)), isToday: `${t.slice(5)}` === r.birthDate.slice(5) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return rows;
}

// ------------------------------ Embarques ------------------------------

export async function upcomingDepartures(ctx: Ctx, days: number) {
  const t = today(ctx);
  const sales = await prisma.sale.findMany({
    where: { ...saleScope(ctx), status: confirmed, tripStart: { gte: t, lte: addDays(t, days) } },
    include: {
      client: { select: { id: true, name: true, whatsapp: true, phone: true, passportExpiry: true } },
      seller: { select: { name: true } },
      passengers: { select: { id: true } },
      items: { select: { productType: true, locator: true, reservation: { select: { status: true } } } },
      contracts: { select: { status: true } },
      receivables: { where: { origin: "VENDA", status: { in: ["PENDENTE", "PARCIAL"] } }, select: { amountCents: true, settledCents: true } },
    },
    orderBy: { tripStart: "asc" },
  });
  return sales.map((s) => {
    const pending: string[] = [];
    if (s.passengers.length < s.passengerCount) pending.push("passageiros");
    if (!s.locator && !s.items.some((i) => i.locator)) pending.push("localizador");
    if (s.items.some((i) => i.reservation?.status === "PENDENTE")) pending.push("reserva não confirmada");
    const open = sum(s.receivables.map((r) => r.amountCents - r.settledCents));
    if (open > 0) pending.push("saldo em aberto");
    if (s.contracts[0] && s.contracts[0].status !== "ASSINADO") pending.push("contrato");
    if (s.client.passportExpiry && s.client.passportExpiry < addDays(s.tripStart!, 180) && s.items.some((i) => ["AEREO", "PACOTE", "CRUZEIRO"].includes(i.productType))) pending.push("passaporte");
    return { id: s.id, code: s.code, client: s.client, seller: s.seller.name, destination: s.destination, tripStart: s.tripStart!, tripEnd: s.tripEnd, passengerCount: s.passengerCount, daysLeft: Math.round((Date.parse(s.tripStart!) - Date.parse(t)) / 86400000), openCents: open, pending };
  });
}

// ------------------------------ Painel do vendedor ------------------------------

export async function sellerDashboard(ctx: Ctx, sellerId: string, month: string) {
  if (sellerId !== ctx.userId && !can(ctx, "sales.view_all")) throw new AppError("Sem permissão.", "FORBIDDEN");
  const { from, to } = range(month);
  const t = today(ctx);
  const [seller, sales, goal, ranking, tasks, contracts, credits, recent, departures, bdays] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { id: sellerId, companyId: ctx.companyId }, select: { id: true, name: true } }),
    prisma.sale.findMany({ where: { companyId: ctx.companyId, sellerId, status: confirmed, saleDate: { gte: from, lte: to } }, include: { items: true } }),
    prisma.goal.findFirst({ where: { companyId: ctx.companyId, month, scope: "VENDEDOR", targetId: sellerId } }),
    getRanking(ctx, month),
    prisma.task.findMany({ where: { companyId: ctx.companyId, assigneeId: sellerId, status: { in: ["PENDENTE", "EM_ANDAMENTO"] } }, orderBy: { dueDate: "asc" }, take: 8 }),
    prisma.contract.findMany({ where: { companyId: ctx.companyId, status: { in: ["NAO_GERADO", "EM_PREPARACAO", "AGUARDANDO_ENVIO", "ENVIADO"] }, sale: { sellerId, status: confirmed } }, include: { sale: { select: { code: true, client: { select: { name: true } } } } }, take: 8 }),
    prisma.clientCredit.findMany({ where: { companyId: ctx.companyId, status: "ABERTO", client: { ownerId: sellerId } }, include: { client: { select: { name: true } } }, take: 8 }),
    prisma.sale.findMany({ where: { companyId: ctx.companyId, sellerId, status: { not: "CANCELADA" } }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, code: true, saleDate: true, destination: true, grossCents: true, status: true, client: { select: { name: true } } } }),
    prisma.sale.findMany({ where: { companyId: ctx.companyId, sellerId, status: confirmed, tripStart: { gte: t, lte: addDays(t, 7) } }, orderBy: { tripStart: "asc" }, select: { id: true, code: true, destination: true, tripStart: true, client: { select: { name: true } } } }),
    birthdays({ ...ctx, userId: sellerId, permissions: ctx.permissions }, month, "clientes"),
  ]);
  const gross = sum(sales.map((s) => s.grossCents));
  const items = sales.flatMap((s) => s.items);
  const position = ranking.rows.findIndex((r) => r.id === sellerId) + 1;
  return {
    seller,
    gross,
    count: sales.length,
    commissionCents: sum(sales.map((s) => s.sellerCommissionCents)),
    revenue: {
      commission: sum(items.filter((i) => i.commercialModel === "COMISSAO").map((i) => i.supplierCommissionCents)) + sum(items.filter((i) => i.commercialModel !== "COMISSAO").map((i) => i.priceCents - i.costCents)),
      over: sum(items.map((i) => i.overCents)),
      fees: sum(items.map((i) => i.ravCents + i.duCents)) + sum(sales.map((s) => s.feesCents)),
    },
    goal,
    missingCents: goal ? Math.max(0, goal.amountCents - gross) : null,
    ranking: { position: position || null, of: ranking.rows.filter((r) => r.count > 0).length },
    todo: {
      tasks,
      contracts,
      credits,
      birthdays: bdays.filter((b) => b.day >= t.slice(8, 10) || month !== t.slice(0, 7)),
    },
    recent,
    departures,
  };
}

// ------------------------------ Calendário pessoal ------------------------------

export async function personalCalendar(ctx: Ctx, month: string) {
  const { from, to } = range(month);
  const [tasks, trips, bdays, credits] = await Promise.all([
    prisma.task.findMany({ where: { ...taskScope(ctx), dueDate: { gte: from, lte: to }, status: { not: "CANCELADA" } }, select: { id: true, title: true, dueDate: true, status: true } }),
    prisma.sale.findMany({ where: { ...saleScope(ctx), status: confirmed, tripStart: { gte: from, lte: to } }, select: { id: true, code: true, destination: true, tripStart: true, client: { select: { name: true } } } }),
    birthdays(ctx, month, "todos"),
    prisma.clientCredit.findMany({ where: { companyId: ctx.companyId, status: "ABERTO", expiresAt: { gte: from, lte: to } }, select: { id: true, expiresAt: true, amountCents: true, client: { select: { name: true } } } }),
  ]);
  type Ev = { date: string; kind: "Tarefa" | "Embarque" | "Aniversário" | "Crédito"; title: string; href: string | null; done?: boolean };
  const events: Ev[] = [
    ...tasks.map((t) => ({ date: t.dueDate!, kind: "Tarefa" as const, title: t.title, href: "/equipe/tarefas", done: t.status === "CONCLUIDA" })),
    ...trips.map((s) => ({ date: s.tripStart!, kind: "Embarque" as const, title: `${s.client.name} · ${s.destination ?? s.code}`, href: `/vendas/${s.id}` })),
    ...bdays.map((b) => ({ date: `${month}-${b.day}`, kind: "Aniversário" as const, title: `${b.name} (${b.kind.toLowerCase()})`, href: b.href })),
    ...credits.map((c) => ({ date: c.expiresAt!, kind: "Crédito" as const, title: `Crédito de ${c.client.name} vence`, href: "/creditos" })),
  ];
  return events;
}

// ------------------------------ Destinos e hotéis ------------------------------

export async function destinationsAnalysis(ctx: Ctx, from: string, to: string) {
  const sales = await prisma.sale.findMany({
    where: { ...saleScope(ctx), status: confirmed, saleDate: { gte: from, lte: to } },
    select: { id: true, destination: true, grossCents: true, passengerCount: true, items: { select: { productType: true, description: true, priceCents: true, supplier: { select: { name: true } } } } },
  });
  const dest = new Map<string, { name: string; count: number; gross: number; pax: number }>();
  const hotels = new Map<string, { name: string; destination: string; count: number; gross: number }>();
  for (const s of sales) {
    const key = (s.destination ?? "Não informado").trim();
    const d = dest.get(key.toLowerCase()) ?? { name: key, count: 0, gross: 0, pax: 0 };
    d.count++;
    d.gross += s.grossCents;
    d.pax += s.passengerCount;
    dest.set(key.toLowerCase(), d);
    for (const i of s.items.filter((x) => x.productType === "HOTEL")) {
      const name = (i.description || i.supplier?.name || "Hospedagem sem nome").trim();
      const h = hotels.get(name.toLowerCase()) ?? { name, destination: key, count: 0, gross: 0 };
      h.count++;
      h.gross += i.priceCents;
      hotels.set(name.toLowerCase(), h);
    }
  }
  return {
    sales: sales.length,
    gross: sum(sales.map((s) => s.grossCents)),
    destinations: [...dest.values()].sort((a, b) => b.gross - a.gross),
    hotels: [...hotels.values()].sort((a, b) => b.gross - a.gross),
  };
}
