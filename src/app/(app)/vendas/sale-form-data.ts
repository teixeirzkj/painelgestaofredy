import "server-only";
import { prisma } from "@/server/db";
import { can, today, type Ctx } from "@/server/context";
import { getSaleForEdit } from "@/server/services/sales";
import { clientScope, supplierOptions } from "@/server/services/registry";
import { sellerOptions } from "@/server/services/settings";
import { activeRules } from "@/server/services/catalog";
import { excursionOptions } from "@/server/services/excursions";
import type { CommercialModel } from "@/lib/constants";
import type { SaleFormInitial } from "./sale-form";

async function common(ctx: Ctx) {
  const [suppliers, sellers, rules, excursions] = await Promise.all([supplierOptions(ctx), sellerOptions(ctx), activeRules(ctx), excursionOptions(ctx)]);
  return { suppliers, sellers, rules, excursions, canPickSeller: can(ctx, "sales.edit_all"), showMargin: can(ctx, "sales.view_margin") };
}

/** Dados do formulário para uma venda nova, com pré-preenchimento opcional (ex.: card do Frédy). */
export async function newSaleFormData(
  ctx: Ctx,
  pre: { clientId?: string | null; destination?: string | null; tripStart?: string | null; tripEnd?: string | null; passengerCount?: number | null; priceCents?: number; description?: string | null; productType?: string } = {},
) {
  const [base, me, client] = await Promise.all([
    common(ctx),
    prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { commissionRateBps: true } }),
    pre.clientId ? prisma.client.findFirst({ where: { AND: [{ id: pre.clientId }, clientScope(ctx)] }, select: { id: true, name: true, document: true, whatsapp: true } }) : null,
  ]);
  const initial: SaleFormInitial = {
    saleDate: today(ctx),
    client,
    sellerId: ctx.userId,
    destination: pre.destination ?? "",
    tripStart: pre.tripStart ?? "",
    tripEnd: pre.tripEnd ?? "",
    tripId: null,
    excursionId: null,
    passengerCount: pre.passengerCount ?? 1,
    locator: "",
    notes: "",
    feesCents: 0,
    discountCents: 0,
    commission: me.commissionRateBps > 0 ? { mode: "PERCENTUAL", bps: me.commissionRateBps } : { mode: "VALOR", amountCents: 0 },
    items: pre.priceCents
      ? [{ productType: pre.productType ?? "PACOTE", description: pre.description ?? "", supplierId: "", operatorId: "", commercialModel: "INTERMEDIACAO", priceCents: pre.priceCents, costCents: 0, supplierCommissionCents: 0, ravCents: 0, duCents: 0, overCents: 0, cardFeeCents: 0, supplierDueDate: "", locator: "" }]
      : [],
    payments: [],
    passengers: [],
    locked: {},
  };
  return { ...base, initial };
}

/** Dados do formulário para editar (ou continuar o rascunho de) uma venda. */
export async function editSaleFormData(ctx: Ctx, id: string) {
  const [sale, base] = await Promise.all([getSaleForEdit(ctx, id), common(ctx)]);
  // a excursão da própria venda continua disponível mesmo se já tiver encerrado as vendas
  if (sale.excursionId && !base.excursions.some((e) => e.id === sale.excursionId)) {
    const own = await prisma.excursion.findFirst({ where: { id: sale.excursionId, companyId: ctx.companyId }, select: { id: true, code: true, name: true, destination: true, startDate: true, endDate: true, pricePerSeatCents: true, seats: true } });
    if (own) base.excursions.push(own);
  }
  const initial: SaleFormInitial = {
    id: sale.id,
    code: sale.code,
    status: sale.status,
    saleDate: sale.saleDate,
    client: sale.client,
    sellerId: sale.sellerId,
    destination: sale.destination ?? "",
    tripStart: sale.tripStart ?? "",
    tripEnd: sale.tripEnd ?? "",
    passengerCount: sale.passengerCount,
    locator: sale.locator ?? "",
    notes: sale.notes ?? "",
    feesCents: sale.feesCents,
    discountCents: sale.discountCents,
    tripId: sale.tripId,
    excursionId: sale.excursionId,
    intermediaryId: sale.intermediaryId,
    intermediaryCommissionCents: sale.intermediaryCommissionCents,
    people: sale.people,
    commission: { mode: "VALOR", amountCents: sale.sellerCommissionCents },
    items: sale.items.map((i) => ({
      id: i.id,
      productType: i.productType,
      description: i.description ?? "",
      supplierId: i.supplierId ?? "",
      operatorId: i.operatorId ?? "",
      ravCents: i.ravCents,
      duCents: i.duCents,
      overCents: i.overCents,
      cardFeeCents: i.cardFeeCents,
      commercialModel: i.commercialModel as CommercialModel,
      priceCents: i.priceCents,
      costCents: i.costCents,
      supplierCommissionCents: i.supplierCommissionCents,
      supplierDueDate: i.supplierDueDate ?? "",
      locator: i.locator ?? "",
    })),
    payments: sale.plan,
    passengers: sale.passengers.map((p) => ({
      name: p.name,
      document: p.document ?? "",
      birthDate: p.birthDate ?? "",
      passportNumber: p.passportNumber ?? "",
      passportExpiry: p.passportExpiry ?? "",
      clientId: p.clientId,
      room: p.room,
      seat: p.seat,
    })),
    locked: sale.locked,
  };
  return { ...base, initial, sale };
}
