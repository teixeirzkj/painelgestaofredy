/**
 * Central da Viagem: voos de cada venda e a visão do dia (quem está viajando, voos de hoje e amanhã,
 * clientes por destino, conexões curtas e embarques sem voo cadastrado).
 *
 * Os horários são os programados (cadastrados na venda ou trazidos do Monde). O acompanhamento ao vivo
 * (atraso, cancelamento, portão) depende de um provedor de dados de voo, ainda não contratado: nada aqui
 * simula status em tempo real.
 */
import { z } from "zod";
import { prisma, type Tx } from "../db";
import { can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { addDays } from "@/lib/dates";
import { saleScope } from "./sales";

const iata = (what: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, `${what}: use o código do aeroporto com 3 letras (ex.: GRU).`);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Informe data e hora.");

export const flightSchema = z
  .object({
    airline: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,3}$/, "Companhia: use o código com 2 letras (ex.: LA, G3, AD, TP)."),
    flightNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^\d{1,4}[A-Z]?$/, "Número do voo: só os números (ex.: 8084)."),
    origin: iata("Origem"),
    destination: iata("Destino"),
    departureAt: localDateTime,
    arrivalAt: localDateTime.optional().nullable().or(z.literal("")).transform((v) => v || null),
  })
  .refine((f) => f.origin !== f.destination, { message: "Origem e destino iguais.", path: ["destination"] });

/** Venda que o usuário pode alterar: dentro do alcance, do próprio vendedor ou de quem edita todas. */
async function editableSale(ctx: Ctx, saleId: string) {
  const s = await prisma.sale.findFirst({ where: { AND: [{ id: saleId, companyId: ctx.companyId }, saleScope(ctx)] }, select: { id: true, code: true, sellerId: true, status: true } });
  if (!s) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  if (s.sellerId !== ctx.userId && !can(ctx, "sales.edit_all")) throw new AppError("Só o vendedor da venda ou quem edita todas as vendas pode mudar os voos.", "FORBIDDEN");
  if (s.status === "CANCELADA") throw new AppError("Venda cancelada.");
  return s;
}

export async function listSaleFlights(ctx: Ctx, saleId: string) {
  return prisma.flightSegment.findMany({ where: { companyId: ctx.companyId, saleId, sale: saleScope(ctx) }, orderBy: { departureAt: "asc" } });
}

export async function saveFlight(ctx: Ctx, saleId: string, id: string | null, raw: unknown) {
  const s = await editableSale(ctx, saleId);
  // horários locais de cada aeroporto: a chegada pode "parecer" antes da partida em voos para o oeste
  const d = flightSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const f = await tx.flightSegment.findFirst({ where: { id, saleId, companyId: ctx.companyId } });
      if (!f) throw new AppError("Voo não encontrado.", "NOT_FOUND");
      await tx.flightSegment.update({ where: { id }, data: d });
      await audit(tx, ctx, "voo.alterado", "Sale", saleId, { voo: `${d.airline}${d.flightNumber}`, partida: d.departureAt });
      return { id };
    }
    const count = await tx.flightSegment.count({ where: { saleId } });
    if (count >= 30) throw new AppError("No máximo 30 voos por venda.");
    const f = await tx.flightSegment.create({ data: { ...d, companyId: ctx.companyId, saleId } });
    await audit(tx, ctx, "voo.incluido", "Sale", saleId, { venda: s.code, voo: `${d.airline}${d.flightNumber}`, partida: d.departureAt });
    return { id: f.id };
  });
}

export async function deleteFlight(ctx: Ctx, saleId: string, id: string) {
  await editableSale(ctx, saleId);
  await prisma.$transaction(async (tx) => {
    const f = await tx.flightSegment.findFirst({ where: { id, saleId, companyId: ctx.companyId } });
    if (!f) throw new AppError("Voo não encontrado.", "NOT_FOUND");
    await tx.flightSegment.delete({ where: { id } });
    await audit(tx, ctx, "voo.excluido", "Sale", saleId, { voo: `${f.airline}${f.flightNumber}`, partida: f.departureAt });
  });
}

type MondeSegment = { airline_code?: string; flight_number?: string; origin?: string; destination?: string; departure_date?: string; arrival_date?: string };

/** Trechos do bilhete aéreo do Monde (companhia, voo, origem, destino e horários). Ignora o que vier incompleto. */
export async function saveMondeFlights(tx: Tx, companyId: string, saleId: string, segments: MondeSegment[]) {
  const toLocal = (v?: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : null);
  const seen = new Set<string>();
  const data = [];
  for (const g of segments.slice(0, 30)) {
    const parsed = flightSchema.safeParse({
      airline: g.airline_code ?? "",
      flightNumber: String(g.flight_number ?? "").replace(/^[A-Z]{2}\s*/i, ""),
      origin: g.origin ?? "",
      destination: g.destination ?? "",
      departureAt: toLocal(g.departure_date) ?? "",
      arrivalAt: toLocal(g.arrival_date),
    });
    if (!parsed.success) continue;
    const key = `${parsed.data.airline}${parsed.data.flightNumber}${parsed.data.departureAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({ ...parsed.data, companyId, saleId, source: "MONDE" });
  }
  if (data.length) await tx.flightSegment.createMany({ data });
  return data.length;
}

const minutes = (a: string, b: string) => (Date.parse(b + ":00Z") - Date.parse(a + ":00Z")) / 60_000;
export const SHORT_CONNECTION_MIN = 90;

/** Visão do dia da Central da Viagem (só vendas confirmadas ou concluídas, no alcance do usuário). */
export async function travelCenter(ctx: Ctx) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { timezone: true } });
  const t = today(company);
  const tomorrow = addDays(t, 1);
  const week = addDays(t, 7);
  const active = { companyId: ctx.companyId, status: { in: ["CONFIRMADA", "CONCLUIDA"] } };
  const saleSelect = { id: true, code: true, destination: true, tripStart: true, tripEnd: true, passengerCount: true, client: { select: { id: true, name: true, whatsapp: true, phone: true } }, seller: { select: { name: true } } } as const;

  // quem está viajando hoje: começou e ainda não voltou
  const traveling = await prisma.sale.findMany({
    where: { AND: [active, saleScope(ctx), { tripStart: { lte: t } }, { OR: [{ tripEnd: { gte: t } }, { tripEnd: null, tripStart: t }] }] },
    select: saleSelect,
    orderBy: { tripStart: "asc" },
    take: 500,
  });

  // voos de hoje até 7 dias
  const flights = await prisma.flightSegment.findMany({
    where: { companyId: ctx.companyId, departureAt: { gte: t, lt: addDays(week, 1) }, sale: { AND: [active, saleScope(ctx)] } },
    include: { sale: { select: saleSelect } },
    orderBy: { departureAt: "asc" },
    take: 1000,
  });
  const day = (f: { departureAt: string }) => f.departureAt.slice(0, 10);

  // conexões curtas: trecho seguinte sai do aeroporto onde o anterior chega, com pouco tempo entre eles
  const saleIds = [...new Set(flights.map((f) => f.saleId))];
  const allOfThose = saleIds.length ? await prisma.flightSegment.findMany({ where: { saleId: { in: saleIds } }, orderBy: { departureAt: "asc" } }) : [];
  const connections: { saleId: string; airport: string; minutes: number; from: string; to: string; at: string }[] = [];
  for (const id of saleIds) {
    const segs = allOfThose.filter((f) => f.saleId === id);
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1];
      const b = segs[i];
      if (!a.arrivalAt || a.destination !== b.origin) continue;
      const gap = minutes(a.arrivalAt, b.departureAt);
      if (gap >= 0 && gap < SHORT_CONNECTION_MIN && b.departureAt < addDays(week, 1)) connections.push({ saleId: id, airport: a.destination, minutes: Math.round(gap), from: `${a.airline} ${a.flightNumber}`, to: `${b.airline} ${b.flightNumber}`, at: b.departureAt });
    }
  }
  const saleById = new Map(flights.map((f) => [f.saleId, f.sale]));

  // embarques nos próximos 15 dias com produto aéreo e sem voo cadastrado
  const missing = await prisma.sale.findMany({
    where: { AND: [active, saleScope(ctx), { tripStart: { gte: t, lte: addDays(t, 15) } }, { items: { some: { productType: "AEREO" } } }, { flights: { none: {} } }] },
    select: saleSelect,
    orderBy: { tripStart: "asc" },
    take: 200,
  });

  // clientes por destino (quem está viajando agora)
  const byDestination = new Map<string, { destination: string; passengers: number; sales: typeof traveling }>();
  for (const s of traveling) {
    const key = (s.destination ?? "Sem destino informado").trim();
    const g = byDestination.get(key.toLowerCase()) ?? { destination: key, passengers: 0, sales: [] };
    g.passengers += s.passengerCount;
    g.sales.push(s);
    byDestination.set(key.toLowerCase(), g);
  }

  return {
    today: t,
    traveling,
    travelingPassengers: traveling.reduce((a, s) => a + s.passengerCount, 0),
    flightsToday: flights.filter((f) => day(f) === t),
    flightsTomorrow: flights.filter((f) => day(f) === tomorrow),
    flightsWeek: flights.filter((f) => day(f) > tomorrow),
    connections: connections.map((c) => ({ ...c, sale: saleById.get(c.saleId)! })),
    missing,
    destinations: [...byDestination.values()].sort((a, b) => b.passengers - a.passengers),
  };
}
