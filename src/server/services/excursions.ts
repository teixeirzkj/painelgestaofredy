/**
 * Excursões e grupos (operação própria).
 * - Cada reserva de passageiros é uma VENDA vinculada à excursão (produto "Excursão", modelo Revenda):
 *   gera parcelas, comissão e contrato pelo fluxo normal de vendas.
 * - Os custos da operação (ônibus, hotel, guia...) são contas a pagar vinculadas à excursão.
 * - Resultado = lucro das vendas − custos da excursão. Previsto × realizado vem das baixas.
 */
import { prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { excursionCostSchema, excursionSchema } from "./schemas";
import { sum } from "@/lib/money";
import { ratioBps } from "@/lib/money";
import { z } from "zod";

function assertView(ctx: Ctx) {
  if (!can(ctx, "sales.create") && !can(ctx, "sales.view_all")) assertCan(ctx, "sales.view_all");
}

export async function listExcursions(ctx: Ctx) {
  assertView(ctx);
  const rows = await prisma.excursion.findMany({
    where: { companyId: ctx.companyId },
    include: {
      sales: { where: { status: { not: "CANCELADA" } }, select: { passengerCount: true, grossCents: true, grossProfitCents: true } },
      payables: { where: { status: { not: "CANCELADO" } }, select: { amountCents: true } },
    },
    orderBy: { startDate: "desc" },
  });
  const showMargin = can(ctx, "sales.view_margin");
  return rows.map((r) => {
    const booked = sum(r.sales.map((s) => s.passengerCount));
    const costs = sum(r.payables.map((p) => p.amountCents));
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      destination: r.destination,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      seats: r.seats,
      booked,
      grossCents: sum(r.sales.map((s) => s.grossCents)),
      resultCents: showMargin ? sum(r.sales.map((s) => s.grossProfitCents)) - costs : null,
    };
  });
}

export async function getExcursion(ctx: Ctx, id: string) {
  assertView(ctx);
  const exc = await prisma.excursion.findFirst({
    where: { id, companyId: ctx.companyId },
    include: {
      sales: {
        orderBy: { saleDate: "asc" },
        include: {
          client: { select: { id: true, name: true, whatsapp: true, phone: true } },
          seller: { select: { name: true } },
          passengers: { orderBy: { name: "asc" } },
          receivables: { where: { status: { not: "CANCELADO" } }, select: { amountCents: true, settledCents: true } },
        },
      },
      payables: { orderBy: { dueDate: "asc" }, include: { supplier: { select: { id: true, name: true } } } },
    },
  });
  if (!exc) throw new AppError("Excursão não encontrada.", "NOT_FOUND");
  const showMargin = can(ctx, "sales.view_margin");
  const canSeeAll = can(ctx, "sales.view_all");
  const active = exc.sales.filter((s) => s.status !== "CANCELADA");
  const visible = canSeeAll ? active : active.filter((s) => s.sellerId === ctx.userId);
  const booked = sum(active.map((s) => s.passengerCount));
  const costs = exc.payables.filter((p) => p.status !== "CANCELADO");
  const costCents = sum(costs.map((p) => p.amountCents));
  const salesProfit = sum(active.map((s) => s.grossProfitCents));
  const grossCents = sum(active.map((s) => s.grossCents));
  const toReceive = sum(active.flatMap((s) => s.receivables.map((r) => r.amountCents)));
  const received = sum(active.flatMap((s) => s.receivables.map((r) => r.settledCents)));
  const paid = sum(costs.map((p) => p.settledCents));
  const passengers = visible.flatMap((s) =>
    (s.passengers.length ? s.passengers : [{ id: `sale-${s.id}`, name: `${s.client.name} (passageiros não informados)`, document: null, birthDate: null, room: null, seat: null }]).map((p) => ({
      ...p,
      saleId: s.id,
      saleCode: s.code,
      clientName: s.client.name,
      contact: s.client.whatsapp ?? s.client.phone,
      placeholder: String(p.id).startsWith("sale-"),
    })),
  );
  const result = salesProfit - costCents;
  return {
    ...exc,
    sales: visible,
    payables: showMargin || can(ctx, "finance.view") ? exc.payables : [],
    passengers,
    stats: {
      booked,
      available: exc.seats - booked,
      occupancyBps: ratioBps(booked, exc.seats),
      grossCents,
      costCents: showMargin ? costCents : null,
      resultCents: showMargin ? result : null,
      marginBps: showMargin ? ratioBps(result, grossCents) : null,
      resultPerPassengerCents: showMargin && booked ? Math.round(result / booked) : null,
      // previsto x realizado
      toReceiveCents: toReceive,
      receivedCents: received,
      toPayCents: showMargin ? costCents : null,
      paidCents: showMargin ? paid : null,
      realizedCents: showMargin ? received - paid : null,
    },
    canManage: can(ctx, "sales.edit_all"),
    showMargin,
  };
}

async function nextNumber(companyId: string) {
  const last = await prisma.excursion.findFirst({ where: { companyId }, orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

export async function saveExcursion(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "sales.edit_all");
  const d = excursionSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const exc = await tx.excursion.findFirst({ where: { id, companyId: ctx.companyId }, include: { sales: { where: { status: { not: "CANCELADA" } } } } });
      if (!exc) throw new AppError("Excursão não encontrada.", "NOT_FOUND");
      const booked = sum(exc.sales.map((s) => s.passengerCount));
      if (d.seats < booked) throw new AppError(`Já há ${booked} passageiro(s) reservados; as vagas não podem ser menores que isso.`);
      if (d.status === "CANCELADA" && exc.sales.length) throw new AppError("Cancele ou transfira as reservas antes de cancelar a excursão.");
      await tx.excursion.update({ where: { id }, data: d });
      await audit(tx, ctx, "excursao.alterada", "Excursion", id, d);
      return { id };
    }
    const number = await nextNumber(ctx.companyId);
    const exc = await tx.excursion.create({ data: { ...d, companyId: ctx.companyId, number, code: `EX-${d.startDate.slice(0, 4)}-${String(number).padStart(4, "0")}` } });
    await audit(tx, ctx, "excursao.criada", "Excursion", exc.id, d);
    return { id: exc.id };
  });
}

/** Custo da operação: conta a pagar vinculada à excursão (aparece no financeiro e no resultado). */
export async function addExcursionCost(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "sales.edit_all");
  const d = excursionCostSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const exc = await tx.excursion.findFirst({ where: { id, companyId: ctx.companyId } });
    if (!exc) throw new AppError("Excursão não encontrada.", "NOT_FOUND");
    if (d.supplierId && !(await tx.supplier.findFirst({ where: { id: d.supplierId, companyId: ctx.companyId } }))) throw new AppError("Fornecedor inválido.");
    const p = await tx.payable.create({
      data: {
        companyId: ctx.companyId,
        origin: "EXCURSAO",
        excursionId: id,
        supplierId: d.supplierId,
        description: `${exc.code} · ${d.description}`,
        category: "OPERACAO_PROPRIA",
        amountCents: d.amountCents,
        dueDate: d.dueDate,
        status: "PENDENTE",
      },
    });
    await audit(tx, ctx, "excursao.custo_lancado", "Excursion", id, { payableId: p.id, amountCents: d.amountCents });
    return p.id;
  });
}

const roomSchema = z.object({ room: z.string().trim().max(40).optional().nullable(), seat: z.string().trim().max(20).optional().nullable() });

export async function updatePassengerRoom(ctx: Ctx, passengerId: string, raw: unknown) {
  const d = roomSchema.parse(raw);
  const p = await prisma.passenger.findFirst({ where: { id: passengerId, companyId: ctx.companyId }, include: { sale: true } });
  if (!p || !p.sale.excursionId) throw new AppError("Passageiro não encontrado.", "NOT_FOUND");
  if (p.sale.sellerId !== ctx.userId && !can(ctx, "sales.edit_all")) throw new AppError("Sem permissão para alterar este passageiro.", "FORBIDDEN");
  await prisma.passenger.update({ where: { id: passengerId }, data: { room: d.room || null, seat: d.seat || null } });
}

export async function excursionOptions(ctx: Ctx) {
  const t = today(ctx);
  return prisma.excursion.findMany({
    where: { companyId: ctx.companyId, status: { in: ["PLANEJADA", "VENDAS_ABERTAS"] }, endDate: { gte: t } },
    select: { id: true, code: true, name: true, destination: true, startDate: true, endDate: true, pricePerSeatCents: true, seats: true },
    orderBy: { startDate: "asc" },
  });
}
