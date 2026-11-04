/**
 * Viagens: agrupam vendas do mesmo cliente feitas em momentos diferentes
 * (ex.: aéreo hoje, hotel na semana seguinte, seguro depois).
 * As datas e a situação são derivadas das vendas vinculadas; a comissão continua por venda.
 */
import { prisma, Prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { tripSchema } from "./schemas";
import { saleScope, saleFinancialStatus } from "./sales";
import { textContains } from "./query";
import { sum } from "@/lib/money";

export function tripScope(ctx: Ctx): Prisma.TripWhereInput {
  if (can(ctx, "sales.view_all")) return { companyId: ctx.companyId };
  return { companyId: ctx.companyId, OR: [{ sales: { some: { sellerId: ctx.userId } } }, { client: { ownerId: ctx.userId } }] };
}

type SaleLite = { status: string; tripStart: string | null; tripEnd: string | null };

export function tripDates(sales: SaleLite[]) {
  const active = sales.filter((s) => s.status !== "CANCELADA");
  const starts = active.map((s) => s.tripStart).filter(Boolean) as string[];
  const ends = active.map((s) => s.tripEnd ?? s.tripStart).filter(Boolean) as string[];
  return { start: starts.length ? starts.sort()[0] : null, end: ends.length ? ends.sort().at(-1)! : null };
}

export function tripStatus(cancelled: boolean, sales: SaleLite[], t: string) {
  if (cancelled) return "CANCELADA";
  const { start, end } = tripDates(sales);
  if (!start) return "SEM_DATAS";
  if (t < start) return "A_INICIAR";
  if (end && t > end) return "FINALIZADA";
  return "EM_VIAGEM";
}

export async function listTrips(ctx: Ctx, f: { q?: string; status?: string } = {}) {
  const t = today(ctx);
  const rows = await prisma.trip.findMany({
    where: {
      ...tripScope(ctx),
      ...(f.q
        ? { OR: [{ code: textContains(f.q) }, { title: textContains(f.q) }, { destination: textContains(f.q) }, { client: { name: textContains(f.q) } }] }
        : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      sales: { select: { id: true, status: true, tripStart: true, tripEnd: true, grossCents: true, passengerCount: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const items = rows.map((r) => {
    const { start, end } = tripDates(r.sales);
    const active = r.sales.filter((s) => s.status !== "CANCELADA");
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      destination: r.destination,
      client: r.client,
      start,
      end,
      status: tripStatus(!!r.cancelledAt, r.sales, t),
      salesCount: active.length,
      grossCents: sum(active.map((s) => s.grossCents)),
      passengers: Math.max(0, ...active.map((s) => s.passengerCount)),
    };
  });
  const filtered = f.status ? items.filter((i) => i.status === f.status) : items;
  return filtered.sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999") * (a.status === "FINALIZADA" ? -1 : 1));
}

export async function getTrip(ctx: Ctx, id: string) {
  const trip = await prisma.trip.findFirst({
    where: { id, ...tripScope(ctx) },
    include: {
      client: { select: { id: true, name: true, document: true, whatsapp: true, phone: true, email: true } },
      attachments: { orderBy: { createdAt: "desc" } },
      sales: {
        where: saleScope(ctx),
        orderBy: { saleDate: "asc" },
        include: {
          seller: { select: { name: true } },
          items: { include: { supplier: { select: { id: true, name: true } }, operator: { select: { id: true, name: true } }, reservation: true }, orderBy: { sortOrder: "asc" } },
          passengers: true,
          receivables: { where: { origin: "VENDA" }, select: { amountCents: true, settledCents: true, status: true, dueDate: true } },
          contracts: { select: { id: true, status: true } },
          attachments: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!trip) throw new AppError("Viagem não encontrada.", "NOT_FOUND");
  const t = today(ctx);
  const active = trip.sales.filter((s) => s.status !== "CANCELADA");
  const showMargin = can(ctx, "sales.view_margin");
  // passageiros sem repetição (mesma pessoa em várias vendas)
  const seen = new Map<string, (typeof trip.sales)[number]["passengers"][number]>();
  for (const s of active) for (const p of s.passengers) seen.set((p.document || p.name).toLowerCase(), p);
  const received = sum(active.flatMap((s) => s.receivables.filter((r) => r.status !== "CANCELADO").map((r) => r.settledCents)));
  const toReceive = sum(active.flatMap((s) => s.receivables.filter((r) => r.status !== "CANCELADO").map((r) => r.amountCents)));
  return {
    ...trip,
    ...tripDates(trip.sales),
    status: tripStatus(!!trip.cancelledAt, trip.sales, t),
    passengers: [...seen.values()],
    sales: trip.sales.map((s) => ({ ...s, financialStatus: saleFinancialStatus(s.status, s.receivables, t), grossProfitCents: showMargin ? s.grossProfitCents : null })),
    totals: {
      grossCents: sum(active.map((s) => s.grossCents)),
      grossProfitCents: showMargin ? sum(active.map((s) => s.grossProfitCents)) : null,
      receivedCents: received,
      openCents: toReceive - received,
    },
    documents: [...trip.attachments.map((a) => ({ ...a, origin: "Viagem" })), ...trip.sales.flatMap((s) => s.attachments.map((a) => ({ ...a, origin: s.code })))],
    showMargin,
  };
}

async function nextNumber(companyId: string) {
  const last = await prisma.trip.findFirst({ where: { companyId }, orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

export async function createTrip(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "sales.create");
  const d = tripSchema.parse(raw);
  const client = await prisma.client.findFirst({
    where: { id: d.clientId, companyId: ctx.companyId, archivedAt: null, ...(can(ctx, "clients.view_all") ? {} : { OR: [{ ownerId: ctx.userId }, { ownerId: null }] }) },
  });
  if (!client) throw new AppError("Cliente não encontrado.");
  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(ctx.companyId);
    const code = `VG-${today(ctx).slice(0, 4)}-${String(number).padStart(4, "0")}`;
    const trip = await tx.trip.create({ data: { ...d, companyId: ctx.companyId, number, code } });
    if (!client.ownerId) await tx.client.update({ where: { id: client.id }, data: { ownerId: ctx.userId } });
    await audit(tx, ctx, "viagem.criada", "Trip", trip.id, { code, clientId: d.clientId });
    return { id: trip.id, code };
  });
}

export async function updateTrip(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "sales.create");
  const d = tripSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({ where: { id, ...tripScope(ctx) }, include: { sales: { select: { id: true } } } });
    if (!trip) throw new AppError("Viagem não encontrada.", "NOT_FOUND");
    if (d.clientId !== trip.clientId && trip.sales.length) throw new AppError("Não é possível trocar o cliente de uma viagem com vendas vinculadas.");
    await tx.trip.update({ where: { id }, data: { title: d.title, destination: d.destination, notes: d.notes, clientId: d.clientId } });
    await audit(tx, ctx, "viagem.alterada", "Trip", id, d);
  });
}

export async function setTripCancelled(ctx: Ctx, id: string, cancelled: boolean) {
  assertCan(ctx, "sales.cancel");
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!trip) throw new AppError("Viagem não encontrada.", "NOT_FOUND");
    await tx.trip.update({ where: { id }, data: { cancelledAt: cancelled ? new Date() : null } });
    await audit(tx, ctx, cancelled ? "viagem.cancelada" : "viagem.reativada", "Trip", id);
  });
}

/** Vincula/desvincula uma venda existente. A venda precisa ser do mesmo cliente e editável pelo usuário. */
export async function linkSaleToTrip(ctx: Ctx, tripId: string | null, saleId: string) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, ...saleScope(ctx) } });
    if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
    if (sale.sellerId !== ctx.userId && !can(ctx, "sales.edit_all")) throw new AppError("Você só pode alterar as próprias vendas.", "FORBIDDEN");
    if (tripId) {
      const trip = await tx.trip.findFirst({ where: { id: tripId, companyId: ctx.companyId, cancelledAt: null } });
      if (!trip) throw new AppError("Viagem não encontrada.", "NOT_FOUND");
      if (trip.clientId !== sale.clientId) throw new AppError("A venda é de outro cliente.");
    }
    await tx.sale.update({ where: { id: saleId }, data: { tripId } });
    await audit(tx, ctx, tripId ? "viagem.venda_vinculada" : "viagem.venda_desvinculada", "Sale", saleId, { tripId: tripId ?? sale.tripId });
  });
}

/** Viagens do cliente (para vincular no formulário de venda) e vendas dele ainda sem viagem. */
export async function tripOptionsForClient(ctx: Ctx, clientId: string) {
  const [trips, looseSales] = await Promise.all([
    prisma.trip.findMany({ where: { companyId: ctx.companyId, clientId, cancelledAt: null }, select: { id: true, code: true, title: true }, orderBy: { createdAt: "desc" } }),
    prisma.sale.findMany({
      where: { ...saleScope(ctx), clientId, tripId: null, status: { not: "CANCELADA" } },
      select: { id: true, code: true, destination: true, saleDate: true, grossCents: true },
      orderBy: { saleDate: "desc" },
      take: 50,
    }),
  ]);
  return { trips, looseSales };
}
