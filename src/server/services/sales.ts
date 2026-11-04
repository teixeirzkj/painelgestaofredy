import { prisma, type Tx, Prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { saleInputSchema, type SaleParsed } from "./schemas";
import { calculateSale, entryStatus, validateSaleFinancials, type SellerCommissionRule } from "@/lib/finance";
import { addDays, addMonths, startOfMonth } from "@/lib/dates";
import { sum } from "@/lib/money";
import { newKey } from "@/lib/utils";
import { emitEvent } from "./automations";
import { prepareContractForSale } from "./contracts";
import { textContains, entryDelegate } from "./query";

export type PlanItem = { key: string; dueDate: string; amountCents: number; method: string; description: string | null };

// ---------------------------------------------------------------------------
// Visibilidade
// ---------------------------------------------------------------------------

export function saleScope(ctx: Ctx): Prisma.SaleWhereInput {
  return can(ctx, "sales.view_all") ? { companyId: ctx.companyId } : { companyId: ctx.companyId, sellerId: ctx.userId };
}

async function getEditableSale(tx: Tx, ctx: Ctx, id: string) {
  const sale = await tx.sale.findFirst({ where: { id, ...saleScope(ctx) }, include: { items: true } });
  if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  if (sale.sellerId !== ctx.userId && !can(ctx, "sales.edit_all"))
    throw new AppError("Você só pode alterar as próprias vendas.", "FORBIDDEN");
  return sale;
}

// ---------------------------------------------------------------------------
// Validação de entrada e regras
// ---------------------------------------------------------------------------

async function validateRefs(tx: Tx, ctx: Ctx, input: SaleParsed) {
  const client = await tx.client.findFirst({ where: { id: input.clientId, companyId: ctx.companyId, archivedAt: null } });
  if (!client) throw new AppError("Cliente não encontrado.", "VALIDATION", [{ field: "clientId", message: "Selecione um cliente válido." }]);
  const supplierIds = [...new Set(input.items.map((i) => i.supplierId).filter(Boolean))] as string[];
  if (supplierIds.length) {
    const count = await tx.supplier.count({ where: { id: { in: supplierIds }, companyId: ctx.companyId } });
    if (count !== supplierIds.length) throw new AppError("Fornecedor inválido em um dos produtos.");
  }
  let sellerId = ctx.userId;
  if (input.sellerId && input.sellerId !== ctx.userId) {
    if (!can(ctx, "sales.edit_all")) throw new AppError("Você não pode lançar vendas para outro vendedor.", "FORBIDDEN");
    const seller = await tx.user.findFirst({ where: { id: input.sellerId, companyId: ctx.companyId, active: true } });
    if (!seller) throw new AppError("Vendedor inválido.");
    sellerId = seller.id;
  }
  return { client, sellerId };
}

function computeTotals(input: SaleParsed) {
  const commission: SellerCommissionRule = input.commission;
  const totals = calculateSale(input.items, input.feesCents, input.discountCents, commission);
  const issues = validateSaleFinancials(input.items, input.feesCents, input.discountCents, totals, sum(input.payments.map((p) => p.amountCents)));
  // Rascunho pode ficar sem plano de pagamento; confirmação exige plano fechando com o valor cobrado.
  const relevant = input.confirm ? issues : issues.filter((i) => i.field !== "payments" || input.payments.length > 0);
  if (relevant.length) throw new AppError(relevant[0].message, "VALIDATION", relevant);
  const keys = new Set(input.payments.map((p) => p.key));
  if (keys.size !== input.payments.length) throw new AppError("Parcelas duplicadas no plano de pagamento.");
  return totals;
}

function mainProductType(input: SaleParsed) {
  if (input.mainProductType) return input.mainProductType;
  return [...input.items].sort((a, b) => b.priceCents - a.priceCents)[0].productType;
}

function saleData(input: SaleParsed, totals: ReturnType<typeof calculateSale>) {
  const plan: PlanItem[] = input.payments.map((p) => ({ ...p, description: p.description ?? null }));
  return {
    saleDate: input.saleDate,
    clientId: input.clientId,
    mainProductType: mainProductType(input),
    destination: input.destination,
    tripStart: input.tripStart,
    tripEnd: input.tripEnd,
    passengerCount: input.passengerCount,
    locator: input.locator,
    notes: input.notes,
    feesCents: input.feesCents,
    discountCents: input.discountCents,
    ...totals,
    paymentPlanJson: JSON.stringify(plan),
  };
}

// ---------------------------------------------------------------------------
// Sincronização dos lançamentos gerados pela venda (idempotente)
// ---------------------------------------------------------------------------

type Desired = {
  sourceKey: string;
  amountCents: number;
  dueDate: string;
  description: string;
  method?: string | null;
  installmentNumber?: number | null;
  installmentCount?: number | null;
};

const money = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Concilia os lançamentos existentes (por sourceKey) com os desejados:
 * - cria os que faltam;
 * - atualiza valores/vencimentos dos existentes, sem nunca reduzir abaixo do já baixado;
 * - cancela os que deixaram de existir, desde que não tenham baixas (senão bloqueia).
 */
async function syncEntries(
  tx: Tx,
  kind: "receivable" | "payable",
  ctx: Ctx,
  existing: { id: string; sourceKey: string | null; settledCents: number; status: string; description: string }[],
  desired: Desired[],
  base: Record<string, unknown>,
) {
  const model = entryDelegate(tx, kind);
  const byKey = new Map(existing.map((e) => [e.sourceKey, e]));
  const desiredKeys = new Set(desired.map((d) => d.sourceKey));

  for (const d of desired) {
    const e = byKey.get(d.sourceKey);
    if (!e) {
      await model.create({
        data: { ...base, companyId: ctx.companyId, ...d, status: "PENDENTE" },
      });
      continue;
    }
    if (e.settledCents > d.amountCents)
      throw new AppError(
        `"${e.description}" já possui ${money(e.settledCents)} baixado; o novo valor (${money(d.amountCents)}) não pode ser menor. Estorne a baixa antes.`,
        "CONFLICT",
      );
    await model.update({
      where: { id: e.id },
      data: { ...base, ...d, status: entryStatus(d.amountCents, e.settledCents, false), cancelledAt: null },
    });
  }

  for (const e of existing) {
    if (e.sourceKey && desiredKeys.has(e.sourceKey)) continue;
    if (e.status === "CANCELADO") continue;
    if (e.settledCents > 0)
      throw new AppError(`"${e.description}" já possui baixa registrada e não pode ser removido. Estorne a baixa antes.`, "CONFLICT");
    await model.update({ where: { id: e.id }, data: { status: "CANCELADO", cancelledAt: new Date() } });
  }
}

export function commissionDueDate(saleDate: string, payDay: number) {
  const next = addMonths(startOfMonth(saleDate), 1);
  return `${next.slice(0, 8)}${String(Math.min(Math.max(payDay, 1), 28)).padStart(2, "0")}`;
}

/** Aplica todas as consequências de uma venda confirmada. Pode ser chamada várias vezes sem duplicar nada. */
export async function syncConfirmedSale(tx: Tx, ctx: Ctx, saleId: string) {
  const sale = await tx.sale.findFirstOrThrow({
    where: { id: saleId, companyId: ctx.companyId },
    include: { items: { include: { supplier: true } }, client: true, seller: true, company: true },
  });
  const plan = JSON.parse(sale.paymentPlanJson) as PlanItem[];

  // 1) Contas a receber do cliente (parcelas)
  const existingRec = await tx.receivable.findMany({ where: { companyId: ctx.companyId, saleId, origin: "VENDA" } });
  await syncEntries(
    tx,
    "receivable",
    ctx,
    existingRec,
    plan.map((p, i) => ({
      sourceKey: `venda:${saleId}:parcela:${p.key}`,
      amountCents: p.amountCents,
      dueDate: p.dueDate,
      method: p.method,
      description: p.description || `${sale.code} · ${sale.client.name} · Parcela ${i + 1}/${plan.length}`,
      installmentNumber: i + 1,
      installmentCount: plan.length,
    })),
    { origin: "VENDA", saleId, clientId: sale.clientId, category: "VENDAS" },
  );

  // 2) Contas a pagar a fornecedores (custos dos itens em intermediação/revenda)
  const existingPay = await tx.payable.findMany({ where: { companyId: ctx.companyId, saleId, origin: "CUSTO_VENDA" } });
  const defaultSupplierDue = sale.tripStart && sale.tripStart > sale.saleDate ? addDays(sale.tripStart, -7) : addDays(sale.saleDate, 7);
  const costItems = sale.items.filter((i) => i.commercialModel !== "COMISSAO" && i.costCents > 0);
  for (const item of costItems) {
    const key = `item:${item.id}:custo`;
    await syncEntries(
      tx,
      "payable",
      ctx,
      existingPay.filter((p) => p.sourceKey === key),
      [
        {
          sourceKey: key,
          amountCents: item.costCents,
          dueDate: item.supplierDueDate ?? (defaultSupplierDue < sale.saleDate ? sale.saleDate : defaultSupplierDue),
          description: `${sale.code} · ${item.supplier?.name ?? "Fornecedor"} · ${item.description ?? item.productType}`,
        },
      ],
      { origin: "CUSTO_VENDA", saleId, saleItemId: item.id, supplierId: item.supplierId, category: "FORNECEDORES" },
    );
  }
  const keptCostKeys = new Set(costItems.map((i) => `item:${i.id}:custo`));
  await syncEntries(tx, "payable", ctx, existingPay.filter((p) => !keptCostKeys.has(p.sourceKey ?? "")), [], {});

  // 3) Comissões a receber de fornecedores (modelo COMISSAO)
  const existingSupComm = await tx.receivable.findMany({ where: { companyId: ctx.companyId, saleId, origin: "COMISSAO_FORNECEDOR" } });
  const commItems = sale.items.filter((i) => i.commercialModel === "COMISSAO" && i.supplierCommissionCents > 0);
  for (const item of commItems) {
    const key = `item:${item.id}:comissao`;
    await syncEntries(
      tx,
      "receivable",
      ctx,
      existingSupComm.filter((r) => r.sourceKey === key),
      [
        {
          sourceKey: key,
          amountCents: item.supplierCommissionCents,
          dueDate: item.supplierDueDate ?? addDays(sale.tripEnd ?? sale.saleDate, 30),
          description: `${sale.code} · Comissão ${item.supplier?.name ?? "fornecedor"}`,
        },
      ],
      { origin: "COMISSAO_FORNECEDOR", saleId, supplierId: item.supplierId, category: "COMISSAO_FORNECEDOR" },
    );
  }
  const keptCommKeys = new Set(commItems.map((i) => `item:${i.id}:comissao`));
  await syncEntries(tx, "receivable", ctx, existingSupComm.filter((r) => !keptCommKeys.has(r.sourceKey ?? "")), [], {});

  // 4) Comissão do vendedor: um registro de comissão + uma conta a pagar (sem duplicar despesa)
  const commission = await tx.commission.upsert({
    where: { saleId },
    create: { companyId: ctx.companyId, saleId, sellerId: sale.sellerId, amountCents: sale.sellerCommissionCents, status: "PENDENTE" },
    update: { sellerId: sale.sellerId, amountCents: sale.sellerCommissionCents },
  });
  const commKey = `comissao:${saleId}`;
  const existingCommPay = await tx.payable.findMany({ where: { companyId: ctx.companyId, sourceKey: commKey } });
  await syncEntries(
    tx,
    "payable",
    ctx,
    existingCommPay,
    sale.sellerCommissionCents > 0
      ? [
          {
            sourceKey: commKey,
            amountCents: sale.sellerCommissionCents,
            dueDate: commissionDueDate(sale.saleDate, sale.company.commissionPayDay),
            description: `Comissão ${sale.seller.name} · ${sale.code}`,
          },
        ]
      : [],
    { origin: "COMISSAO_VENDEDOR", saleId, commissionId: commission.id, category: "COMISSOES" },
  );
  await refreshCommissionStatus(tx, commission.id);

  // 5) Reservas (informações operacionais por produto)
  for (const item of sale.items) {
    await tx.reservation.upsert({
      where: { saleItemId: item.id },
      create: {
        companyId: ctx.companyId,
        saleId,
        saleItemId: item.id,
        supplierId: item.supplierId,
        productType: item.productType,
        locator: item.locator ?? sale.locator,
        startDate: sale.tripStart,
        endDate: sale.tripEnd,
        status: "PENDENTE",
      },
      update: {
        supplierId: item.supplierId,
        productType: item.productType,
        locator: item.locator ?? sale.locator,
        startDate: sale.tripStart,
        endDate: sale.tripEnd,
      },
    });
  }

  // 6) Contrato
  await prepareContractForSale(tx, ctx.companyId, saleId);
}

export async function refreshCommissionStatus(tx: Tx, commissionId: string) {
  const c = await tx.commission.findUnique({ where: { id: commissionId }, include: { payable: true, sale: { select: { status: true } } } });
  if (!c) return;
  let status = "PENDENTE";
  if (c.amountCents === 0 || (c.sale.status === "CANCELADA" && (!c.payable || c.payable.settledCents === 0))) status = "CANCELADA";
  else if (c.payable?.status === "PAGO") status = "PAGA";
  if (status !== c.status) await tx.commission.update({ where: { id: c.id }, data: { status } });
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

async function nextNumber(tx: Tx, companyId: string) {
  const last = await tx.sale.findFirst({ where: { companyId }, orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

function emitConfirmed(tx: Tx, ctx: Ctx, saleId: string, code: string, client: { id: string; name: string; fredyContactId: string | null; consentMessaging: boolean }, grossCents: number) {
  return emitEvent(tx, ctx.companyId, "venda_confirmada.evento", {
    type: "venda.confirmada",
    entityType: "Sale",
    entityId: saleId,
    idempotencyKey: `venda.confirmada:${saleId}`,
    payload: { saleId, saleCode: code, grossCents, client: { id: client.id, name: client.name, fredyContactId: client.fredyContactId }, messagingAllowed: client.consentMessaging },
  });
}

export async function createSale(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "sales.create");
  const input = saleInputSchema.parse(raw);
  const totals = computeTotals(input);

  return prisma.$transaction(async (tx) => {
    const { client, sellerId } = await validateRefs(tx, ctx, input);
    const number = await nextNumber(tx, ctx.companyId);
    const code = `V-${input.saleDate.slice(0, 4)}-${String(number).padStart(4, "0")}`;
    const status = input.confirm ? "CONFIRMADA" : "ORCAMENTO";
    const sale = await tx.sale.create({
      data: {
        companyId: ctx.companyId,
        number,
        code,
        sellerId,
        createdById: ctx.userId,
        status,
        confirmedAt: input.confirm ? new Date() : null,
        ...saleData(input, totals),
        items: {
          create: input.items.map((i, idx) => ({
            companyId: ctx.companyId,
            productType: i.productType,
            description: i.description,
            supplierId: i.supplierId,
            commercialModel: i.commercialModel,
            priceCents: i.priceCents,
            costCents: i.commercialModel === "COMISSAO" ? 0 : i.costCents,
            supplierCommissionCents: i.commercialModel === "COMISSAO" ? i.supplierCommissionCents : 0,
            supplierDueDate: i.supplierDueDate,
            locator: i.locator,
            sortOrder: idx,
          })),
        },
        passengers: { create: input.passengers.map((p) => ({ ...p, companyId: ctx.companyId })) },
      },
    });
    if (!client.ownerId) await tx.client.update({ where: { id: client.id }, data: { ownerId: sellerId } });
    if (input.confirm) {
      await syncConfirmedSale(tx, ctx, sale.id);
      await emitConfirmed(tx, ctx, sale.id, code, client, totals.grossCents);
    }
    await audit(tx, ctx, input.confirm ? "venda.criada_confirmada" : "venda.criada_rascunho", "Sale", sale.id, { code, grossCents: totals.grossCents });
    return { id: sale.id, code };
  });
}

export async function updateSale(ctx: Ctx, id: string, raw: unknown) {
  const input = saleInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const sale = await getEditableSale(tx, ctx, id);
    if (sale.status === "CANCELADA") throw new AppError("Venda cancelada não pode ser alterada.");
    const willBeConfirmed = sale.status !== "ORCAMENTO" || input.confirm;
    const totals = computeTotals({ ...input, confirm: willBeConfirmed });
    const { client, sellerId } = await validateRefs(tx, ctx, { ...input, sellerId: input.sellerId ?? sale.sellerId });

    // Itens: atualiza os que mantêm id, cria novos e remove os excluídos.
    const keepIds = new Set(input.items.map((i) => i.id).filter(Boolean) as string[]);
    for (const kid of keepIds) if (!sale.items.some((i) => i.id === kid)) throw new AppError("Produto inválido na venda.");
    await tx.saleItem.deleteMany({ where: { saleId: id, companyId: ctx.companyId, id: { notIn: [...keepIds] } } });
    for (const [idx, i] of input.items.entries()) {
      const data = {
        productType: i.productType,
        description: i.description,
        supplierId: i.supplierId,
        commercialModel: i.commercialModel,
        priceCents: i.priceCents,
        costCents: i.commercialModel === "COMISSAO" ? 0 : i.costCents,
        supplierCommissionCents: i.commercialModel === "COMISSAO" ? i.supplierCommissionCents : 0,
        supplierDueDate: i.supplierDueDate,
        locator: i.locator,
        sortOrder: idx,
      };
      if (i.id) await tx.saleItem.update({ where: { id: i.id }, data });
      else await tx.saleItem.create({ data: { ...data, companyId: ctx.companyId, saleId: id } });
    }
    await tx.passenger.deleteMany({ where: { saleId: id, companyId: ctx.companyId } });
    if (input.passengers.length) await tx.passenger.createMany({ data: input.passengers.map((p) => ({ ...p, companyId: ctx.companyId, saleId: id })) });

    const confirmingNow = sale.status === "ORCAMENTO" && input.confirm;
    await tx.sale.update({
      where: { id },
      data: {
        ...saleData(input, totals),
        sellerId,
        ...(confirmingNow ? { status: "CONFIRMADA", confirmedAt: new Date() } : {}),
      },
    });
    if (willBeConfirmed) {
      await syncConfirmedSale(tx, ctx, id);
      await emitConfirmed(tx, ctx, id, sale.code, client, totals.grossCents);
    }
    await audit(tx, ctx, confirmingNow ? "venda.confirmada" : "venda.alterada", "Sale", id, {
      antes: { grossCents: sale.grossCents, costCents: sale.costCents, sellerCommissionCents: sale.sellerCommissionCents },
      depois: { grossCents: totals.grossCents, costCents: totals.costCents, sellerCommissionCents: totals.sellerCommissionCents },
    });
    return { id, code: sale.code };
  });
}

/**
 * Cancela a venda de forma controlada:
 * - lançamentos sem baixa são cancelados;
 * - lançamentos com baixa parcial têm o saldo restante encerrado (o valor baixado é preservado);
 * - nada que já foi pago é apagado — devoluções ao cliente devem ser lançadas no financeiro.
 */
export async function cancelSale(ctx: Ctx, id: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw new AppError("Informe o motivo do cancelamento.");
  return prisma.$transaction(async (tx) => {
    const sale = await getEditableSale(tx, ctx, id);
    if (sale.status === "CANCELADA") throw new AppError("A venda já está cancelada.");
    if (sale.status !== "ORCAMENTO") assertCan(ctx, "sales.cancel");
    const warnings: string[] = [];
    const now = new Date();
    const t = today(ctx);

    for (const kind of ["receivable", "payable"] as const) {
      const model = entryDelegate(tx, kind);
      const entries = await model.findMany({
        where: { companyId: ctx.companyId, saleId: id, status: { not: "CANCELADO" } },
      });
      for (const e of entries) {
        if (e.settledCents === 0) {
          await model.update({ where: { id: e.id }, data: { status: "CANCELADO", cancelledAt: now } });
        } else if (e.settledCents < e.amountCents) {
          await model.update({
            where: { id: e.id },
            data: {
              amountCents: e.settledCents,
              status: "PAGO",
              notes: `${e.notes ? e.notes + "\n" : ""}Saldo de ${money(e.amountCents - e.settledCents)} encerrado pelo cancelamento da venda em ${t.split("-").reverse().join("/")}.`,
            },
          });
          warnings.push(`${e.description}: ${money(e.settledCents)} já baixado foi mantido.`);
        } else {
          warnings.push(`${e.description}: ${money(e.settledCents)} já baixado foi mantido.`);
        }
      }
    }
    await tx.sale.update({ where: { id }, data: { status: "CANCELADA", cancelledAt: now, cancelReason: reason.trim() } });
    const commission = await tx.commission.findUnique({ where: { saleId: id } });
    if (commission) await refreshCommissionStatus(tx, commission.id);
    await tx.reservation.updateMany({ where: { saleId: id, companyId: ctx.companyId }, data: { status: "CANCELADA" } });
    await tx.contract.updateMany({ where: { saleId: id, companyId: ctx.companyId, status: { not: "CANCELADO" } }, data: { status: "CANCELADO" } });
    await audit(tx, ctx, "venda.cancelada", "Sale", id, { reason, warnings });
    return { warnings };
  });
}

export async function duplicateSale(ctx: Ctx, id: string) {
  assertCan(ctx, "sales.create");
  const sale = await prisma.sale.findFirst({ where: { id, ...saleScope(ctx) }, include: { items: true, passengers: true } });
  if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  const plan = JSON.parse(sale.paymentPlanJson) as PlanItem[];
  return createSale(ctx, {
    saleDate: today(ctx),
    clientId: sale.clientId,
    sellerId: can(ctx, "sales.edit_all") ? sale.sellerId : ctx.userId,
    mainProductType: sale.mainProductType,
    destination: sale.destination,
    tripStart: null,
    tripEnd: null,
    passengerCount: sale.passengerCount,
    locator: null,
    notes: `Duplicada de ${sale.code}`,
    feesCents: sale.feesCents,
    discountCents: sale.discountCents,
    commission: { mode: "VALOR", amountCents: sale.sellerCommissionCents },
    items: sale.items.map((i) => ({
      productType: i.productType,
      description: i.description,
      supplierId: i.supplierId,
      commercialModel: i.commercialModel,
      priceCents: i.priceCents,
      costCents: i.costCents,
      supplierCommissionCents: i.supplierCommissionCents,
      supplierDueDate: null,
      locator: null,
    })),
    payments: plan.map((p) => ({ ...p, key: newKey(), dueDate: today(ctx) })),
    passengers: [],
    confirm: false,
  });
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export type SaleFinancialStatus = "SEM_COBRANCA" | "PENDENTE" | "PARCIAL" | "QUITADO" | "ATRASADO" | "CANCELADO";

export function saleFinancialStatus(
  saleStatus: string,
  receivables: { amountCents: number; settledCents: number; status: string; dueDate: string }[],
  t: string,
): SaleFinancialStatus {
  if (saleStatus === "CANCELADA") return "CANCELADO";
  const active = receivables.filter((r) => r.status !== "CANCELADO");
  if (active.length === 0) return saleStatus === "ORCAMENTO" ? "SEM_COBRANCA" : "QUITADO";
  if (active.every((r) => r.status === "PAGO")) return "QUITADO";
  if (active.some((r) => r.status !== "PAGO" && r.dueDate < t)) return "ATRASADO";
  if (active.some((r) => r.settledCents > 0)) return "PARCIAL";
  return "PENDENTE";
}

export type SaleListFilters = {
  q?: string;
  status?: string;
  sellerId?: string;
  productType?: string;
  from?: string;
  to?: string;
  financial?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  pending?: boolean; // vendas confirmadas sem informações obrigatórias
  upcomingTripDays?: number; // viagens nos próximos N dias
};

export async function listSales(ctx: Ctx, f: SaleListFilters) {
  const extra: Prisma.SaleWhereInput[] = [];
  if (f.pending)
    extra.push({ status: "CONFIRMADA", OR: [{ destination: null }, { tripStart: null }, { locator: null }, { client: { document: null } }] });
  if (f.upcomingTripDays)
    extra.push({ status: "CONFIRMADA", tripStart: { gte: today(ctx), lte: addDays(today(ctx), f.upcomingTripDays) } });
  const where: Prisma.SaleWhereInput = {
    AND: extra,
    ...saleScope(ctx),
    ...(f.status ? { status: f.status } : {}),
    ...(f.sellerId && can(ctx, "sales.view_all") ? { sellerId: f.sellerId } : {}),
    ...(f.productType ? { items: { some: { productType: f.productType } } } : {}),
    ...(f.from || f.to ? { saleDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.q
      ? {
          OR: [
            { code: textContains(f.q) },
            { destination: textContains(f.q) },
            { locator: textContains(f.q) },
            { client: { name: textContains(f.q) } },
          ],
        }
      : {}),
  };
  const sortMap: Record<string, Prisma.SaleOrderByWithRelationInput> = {
    recentes: { saleDate: "desc" },
    antigas: { saleDate: "asc" },
    maior_valor: { grossCents: "desc" },
    menor_valor: { grossCents: "asc" },
    maior_lucro: { grossProfitCents: "desc" },
    codigo: { number: "desc" },
  };
  const orderBy = [sortMap[f.sort ?? "recentes"] ?? sortMap.recentes, { number: "desc" as const }];
  const pageSize = f.pageSize ?? 20;
  const page = Math.max(1, f.page ?? 1);
  const t = today(ctx);

  // filtro por status financeiro é derivado: aplicamos após carregar (limitado)
  const rows = await prisma.sale.findMany({
    where,
    orderBy,
    include: {
      client: { select: { id: true, name: true } },
      seller: { select: { id: true, name: true } },
      receivables: { where: { origin: "VENDA" }, select: { amountCents: true, settledCents: true, status: true, dueDate: true } },
      contracts: { select: { status: true } },
    },
    ...(f.financial ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
  });
  let mapped = rows.map((s) => ({
    id: s.id,
    code: s.code,
    saleDate: s.saleDate,
    status: s.status,
    client: s.client,
    seller: s.seller,
    destination: s.destination,
    mainProductType: s.mainProductType,
    grossCents: s.grossCents,
    grossProfitCents: can(ctx, "sales.view_margin") ? s.grossProfitCents : null,
    marginBps: can(ctx, "sales.view_margin") ? s.marginBps : null,
    financialStatus: saleFinancialStatus(s.status, s.receivables, t),
    contractStatus: s.contracts[0]?.status ?? "NAO_GERADO",
  }));
  let total: number;
  if (f.financial) {
    mapped = mapped.filter((m) => m.financialStatus === f.financial);
    total = mapped.length;
    mapped = mapped.slice((page - 1) * pageSize, page * pageSize);
  } else {
    total = await prisma.sale.count({ where });
  }
  return { items: mapped, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getSale(ctx: Ctx, id: string) {
  const sale = await prisma.sale.findFirst({
    where: { id, ...saleScope(ctx) },
    include: {
      client: true,
      seller: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      items: { include: { supplier: { select: { id: true, name: true } }, reservation: true }, orderBy: { sortOrder: "asc" } },
      passengers: true,
      receivables: { orderBy: [{ dueDate: "asc" }], include: { settlements: { where: { reversedAt: null } } } },
      payables: { orderBy: [{ dueDate: "asc" }] },
      commission: true,
      contracts: true,
    },
  });
  if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  const showMargin = can(ctx, "sales.view_margin");
  const canFinance = can(ctx, "finance.view");
  return {
    ...sale,
    costCents: showMargin ? sale.costCents : null,
    grossProfitCents: showMargin ? sale.grossProfitCents : null,
    marginBps: showMargin ? sale.marginBps : null,
    agencyRevenueCents: showMargin ? sale.agencyRevenueCents : null,
    items: sale.items.map((i) => ({ ...i, costCents: showMargin ? i.costCents : null, supplierCommissionCents: showMargin ? i.supplierCommissionCents : null })),
    payables: canFinance ? sale.payables : [],
    plan: JSON.parse(sale.paymentPlanJson) as PlanItem[],
    financialStatus: saleFinancialStatus(sale.status, sale.receivables.filter((r) => r.origin === "VENDA"), today(ctx)),
    permissions: { showMargin, canFinance, canEdit: sale.sellerId === ctx.userId || can(ctx, "sales.edit_all"), canCancel: can(ctx, "sales.cancel") || sale.status === "ORCAMENTO" },
  };
}

/** Dados brutos para o formulário de edição (inclui custos: quem edita a venda precisa informá-los). */
export async function getSaleForEdit(ctx: Ctx, id: string) {
  const sale = await prisma.sale.findFirst({
    where: { id, ...saleScope(ctx) },
    include: {
      client: { select: { id: true, name: true, document: true, whatsapp: true, phone: true, email: true } },
      items: { orderBy: { sortOrder: "asc" } },
      passengers: true,
      receivables: { where: { origin: "VENDA" }, select: { sourceKey: true, settledCents: true, status: true } },
    },
  });
  if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  if (sale.sellerId !== ctx.userId && !can(ctx, "sales.edit_all")) throw new AppError("Você só pode alterar as próprias vendas.", "FORBIDDEN");
  if (sale.status === "CANCELADA") throw new AppError("Venda cancelada não pode ser alterada.");
  const plan = JSON.parse(sale.paymentPlanJson) as PlanItem[];
  const locked: Record<string, number> = {};
  for (const r of sale.receivables) {
    const key = r.sourceKey?.split(":parcela:")[1];
    if (key && r.settledCents > 0) locked[key] = r.settledCents;
  }
  return { ...sale, plan, locked };
}

export async function getSaleAudit(ctx: Ctx, id: string) {
  await getSale(ctx, id);
  return prisma.auditLog.findMany({
    where: { companyId: ctx.companyId, entityType: "Sale", entityId: id },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
}
