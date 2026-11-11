import { prisma, type Tx, Prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { saleInputSchema, refundSchema, type SaleParsed } from "./schemas";
import { calculateSale, entryStatus, settlementPrincipal, supplierPayableMethod, supplierRemittance, validateSaleFinancials, type SellerCommissionRule } from "@/lib/finance";
import { PRODUCT_TYPES, REFUND_KINDS, type CommercialModel } from "@/lib/constants";
import { addDays, addMonths, startOfMonth } from "@/lib/dates";
import { applyBps, sum } from "@/lib/money";
import { pickCardFee } from "./admin";
import { newKey } from "@/lib/utils";
import { emitEvent } from "./automations";
import { prepareContractForSale, syncTripContract, effectiveContract, tripContractInclude } from "./contracts";
import { textContains, entryDelegate } from "./query";
import { clientScope } from "./registry";
import { settleEntryTx, reverseSettlementTx } from "./finance";
import { findPaidCardBill, getCardBillsFor, paidBillBlockingReversal, planCardCharge } from "./cards";

export type PlanItem = { key: string; dueDate: string; amountCents: number; method: string; description: string | null; payerClientId?: string | null };

// ---------------------------------------------------------------------------
// Visibilidade
// ---------------------------------------------------------------------------

export function saleScope(ctx: Ctx): Prisma.SaleWhereInput {
  return can(ctx, "sales.view_all") ? { companyId: ctx.companyId } : { companyId: ctx.companyId, sellerId: ctx.userId };
}

/** Cliente sem documento para o contrato: sem CPF/CNPJ e, se estrangeiro, sem passaporte nem RNE. */
export const CLIENT_DOC_MISSING: Prisma.SaleWhereInput = {
  client: { document: null, NOT: { foreigner: true, OR: [{ passportNumber: { not: null } }, { rne: { not: null } }] } },
};

/**
 * Passageiro ligado a um cadastro: completa só o que veio em branco (documento, nascimento,
 * passaporte e validade) com os dados do cadastro. O que foi digitado na venda não é trocado.
 */
async function fillPassengersFromClients(tx: Tx, ctx: Ctx, passengers: SaleParsed["passengers"]) {
  const ids = [...new Set(passengers.map((p) => p.clientId).filter(Boolean))] as string[];
  if (!ids.length) return passengers;
  const clients = await tx.client.findMany({
    // Só completa a partir de cadastros que a pessoa pode ver: um id de fora do escopo fica ligado, sem copiar documentos.
    where: { AND: [{ id: { in: ids } }, clientScope(ctx)] },
    select: { id: true, document: true, foreigner: true, passportNumber: true, passportExpiry: true, rne: true, birthDate: true },
  });
  const byId = new Map(clients.map((c) => [c.id, c]));
  return passengers.map((p) => {
    const c = p.clientId ? byId.get(p.clientId) : null;
    if (!c) return p;
    const doc = c.document ?? (c.foreigner ? c.rne ?? c.passportNumber : null);
    return {
      ...p,
      document: p.document || doc || null,
      birthDate: p.birthDate || c.birthDate || null,
      passportNumber: p.passportNumber || c.passportNumber || null,
      passportExpiry: p.passportExpiry || (p.passportNumber && p.passportNumber !== c.passportNumber ? null : c.passportExpiry) || null,
    };
  });
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

/**
 * Produtos pagos com o cartão da agência: o cartão precisa ser um cartão ativo da empresa.
 * Na confirmação (ou em venda já confirmada) também é preciso ter o cartão, o custo e os dias do cartão.
 */
async function validateAgencyCards(tx: Tx, ctx: Ctx, input: SaleParsed, confirming: boolean, keptCardIds: Set<string>) {
  const issues: { field: string; message: string }[] = [];
  const cardIdx = input.items.map((i, idx) => ({ i, idx })).filter(({ i }) => i.supplierPayment === "CARTAO_AGENCIA");
  if (!cardIdx.length) return;
  const ids = [...new Set(cardIdx.map(({ i }) => i.supplierCardAccountId).filter(Boolean))] as string[];
  const cards = ids.length ? await tx.financialAccount.findMany({ where: { id: { in: ids }, companyId: ctx.companyId, type: "CARTAO_CREDITO" } }) : [];
  // cartão desativado depois da venda continua valendo nos produtos que já estavam nele
  const byId = new Map(cards.filter((c) => c.active || keptCardIds.has(c.id)).map((c) => [c.id, c]));
  for (const { i, idx } of cardIdx) {
    const field = `items.${idx}.supplierCardAccountId`;
    if (i.supplierCardAccountId) {
      const card = byId.get(i.supplierCardAccountId);
      if (!card) issues.push({ field, message: "Escolha um cartão da agência ativo." });
      else if (confirming && (!card.closingDay || !card.dueDay))
        issues.push({ field, message: `Informe o dia de fechamento e o dia de vencimento do cartão "${card.name}" em Financeiro › Contas e saldos.` });
    } else if (confirming) issues.push({ field, message: "Escolha qual cartão da agência foi usado." });
    if (confirming && i.costCents <= 0) issues.push({ field: `items.${idx}.costCents`, message: "Informe o custo do fornecedor para lançar no cartão." });
  }
  if (issues.length) throw new AppError(issues.some((x) => x.message.startsWith("Escolha um")) ? "Cartão da agência inválido." : issues[0].message, "VALIDATION", issues);
}

async function validateRefs(tx: Tx, ctx: Ctx, input: SaleParsed, saleId?: string, confirming = input.confirm, keptCardIds = new Set<string>(), integration = false) {
  // vendedor sem "ver todos os clientes" só vende para cliente que já é dele: senão, criar uma venda daria acesso
  // ao cadastro e aos documentos de um cliente de outro vendedor. Integrações (Frédy, API) ficam de fora.
  const scope = integration ? { companyId: ctx.companyId } : clientScope(ctx);
  const client = await tx.client.findFirst({ where: { AND: [{ id: input.clientId, archivedAt: null }, scope] } });
  if (!client) throw new AppError("Cliente não encontrado.", "VALIDATION", [{ field: "clientId", message: "Selecione um cliente válido." }]);
  await validateAgencyCards(tx, ctx, input, confirming, keptCardIds);
  const supplierIds = [...new Set([...input.items.flatMap((i) => [i.supplierId, i.operatorId]), input.intermediaryId].filter(Boolean))] as string[];
  if (supplierIds.length) {
    const count = await tx.supplier.count({ where: { id: { in: supplierIds }, companyId: ctx.companyId } });
    if (count !== supplierIds.length) throw new AppError("Fornecedor, operadora ou intermediário inválido.");
  }
  if (input.intermediaryCommissionCents > 0 && !input.intermediaryId)
    throw new AppError("Selecione o intermediário que receberá a comissão.", "VALIDATION", [{ field: "intermediaryId", message: "Selecione o intermediário." }]);
  // Pagantes e passageiros vinculados a cadastros precisam ser da mesma empresa
  const personIds = [...new Set([...input.payments.map((p) => p.payerClientId), ...input.passengers.map((p) => p.clientId)].filter(Boolean))] as string[];
  if (personIds.length) {
    const count = await tx.client.count({ where: { id: { in: personIds }, companyId: ctx.companyId } });
    if (count !== personIds.length) throw new AppError("Pagante ou passageiro inválido.");
  }
  if (input.tripId) {
    const trip = await tx.trip.findFirst({ where: { id: input.tripId, companyId: ctx.companyId, cancelledAt: null } });
    if (!trip) throw new AppError("Viagem não encontrada.");
    if (trip.clientId !== input.clientId)
      throw new AppError("A viagem selecionada pertence a outro cliente.", "VALIDATION", [{ field: "tripId", message: "A viagem deve ser do mesmo cliente da venda." }]);
  }
  if (input.excursionId) {
    const exc = await tx.excursion.findFirst({ where: { id: input.excursionId, companyId: ctx.companyId } });
    if (!exc || exc.status === "CANCELADA") throw new AppError("Excursão não encontrada ou cancelada.");
    const booked = await tx.sale.aggregate({
      where: { excursionId: exc.id, companyId: ctx.companyId, status: { not: "CANCELADA" }, ...(saleId ? { id: { not: saleId } } : {}) },
      _sum: { passengerCount: true },
    });
    const free = exc.seats - (booked._sum.passengerCount ?? 0);
    if (input.passengerCount > free)
      throw new AppError(`A excursão tem apenas ${Math.max(free, 0)} vaga(s) disponível(is).`, "VALIDATION", [{ field: "passengerCount", message: "Vagas insuficientes na excursão." }]);
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

/** Campos de "como o fornecedor é pago" gravados no produto (já normalizados pelo schema). */
function supplierPaymentData(i: SaleParsed["items"][number]) {
  return {
    supplierPayment: i.supplierPayment,
    supplierPayMethod: i.supplierPayMethod,
    supplierCardAccountId: i.supplierCardAccountId,
    supplierCardInstallments: i.supplierCardInstallments,
    supplierCardStartInstallment: i.supplierCardStartInstallment,
    supplierCardFirstBillMonth: i.supplierCardFirstBillMonth,
  };
}

function computeTotals(input: SaleParsed) {
  const commission: SellerCommissionRule = input.commission;
  const totals = calculateSale(input.items, input.feesCents, input.discountCents, commission, input.intermediaryCommissionCents);
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
  const plan: PlanItem[] = input.payments.map((p) => ({ ...p, description: p.description ?? null, payerClientId: p.payerClientId ?? null }));
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
    tripId: input.tripId,
    excursionId: input.excursionId,
    intermediaryId: input.intermediaryId,
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
  clientId?: string | null;
  supplierId?: string | null;
  category?: string;
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
  existing: { id: string; sourceKey: string | null; settledCents: number; status: string; description: string; invoiceId?: string | null }[],
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
    // Lançamento já consolidado em fatura de fornecedor: o vencimento passa a ser o da fatura.
    const data = e.invoiceId ? { ...base, ...d, dueDate: undefined } : { ...base, ...d };
    await model.update({
      where: { id: e.id },
      data: { ...data, status: entryStatus(d.amountCents, e.settledCents, false), cancelledAt: null },
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
export async function syncConfirmedSale(tx: Tx, ctx: Ctx, saleId: string, opts?: { supplierPaymentChanged?: Set<string>; imported?: boolean }) {
  const sale = await tx.sale.findFirstOrThrow({
    where: { id: saleId, companyId: ctx.companyId },
    include: { items: { include: { supplier: true, operator: true } }, client: true, seller: true, company: true, intermediary: true },
  });
  const plan = JSON.parse(sale.paymentPlanJson) as PlanItem[];
  const payerIds = [...new Set(plan.map((p) => p.payerClientId).filter(Boolean))] as string[];
  const payers = new Map(
    (await tx.client.findMany({ where: { id: { in: payerIds }, companyId: ctx.companyId }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
  );

  // Taxa da maquininha: cartão que entra no caixa da agência vence na liquidação e gera a taxa como despesa (Deduções)
  const rates = await tx.cardFeeRate.findMany({ where: { companyId: ctx.companyId, active: true } });
  const cardCount = (method: string) => plan.filter((x) => x.method === method).length;
  const fees = plan
    .map((p) => {
      const rate = pickCardFee(rates, p.method, cardCount(p.method));
      return rate ? { p, rate, settleDate: addDays(p.dueDate, rate.settlementDays), fee: applyBps(p.amountCents, rate.rateBps) } : null;
    })
    .filter(Boolean) as { p: PlanItem; rate: { rateBps: number; settlementDays: number }; settleDate: string; fee: number }[];
  const feeByKey = new Map(fees.map((f) => [f.p.key, f]));

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
      dueDate: feeByKey.get(p.key)?.settleDate ?? p.dueDate,
      method: p.method,
      description: p.description || `${sale.code} · ${(p.payerClientId && payers.get(p.payerClientId)) || sale.client.name} · Parcela ${i + 1}/${plan.length}`,
      installmentNumber: i + 1,
      installmentCount: plan.length,
      clientId: p.payerClientId && payers.has(p.payerClientId) ? p.payerClientId : sale.clientId,
    })),
    { origin: "VENDA", saleId, category: "VENDAS" },
  );

  // 1b) Taxas de cartão da maquininha (uma conta a pagar por parcela no cartão)
  await syncEntries(
    tx,
    "payable",
    ctx,
    await tx.payable.findMany({ where: { companyId: ctx.companyId, saleId, origin: "TAXA_CARTAO" } }),
    fees
      .filter((f) => f.fee > 0)
      .map((f) => ({
        sourceKey: `taxa-cartao:${saleId}:${f.p.key}`,
        amountCents: f.fee,
        dueDate: f.settleDate,
        description: `${sale.code} · Taxa de cartão (${(f.rate.rateBps / 100).toLocaleString("pt-BR")}%)`,
      })),
    { origin: "TAXA_CARTAO", saleId, category: "TAXA_CARTAO" },
  );

  // 2) Contas a pagar a fornecedores (custos dos itens em que a agência paga o fornecedor)
  // 2a) Compras no cartão da agência lançadas pela venda: refaz as que mudaram ANTES de mexer nas contas,
  //     senão a regra "valor menor que o já baixado" travaria a edição.
  const cardItems = new Map(
    sale.items.filter((i) => i.commercialModel !== "COMISSAO" && i.supplierPayment === "CARTAO_AGENCIA" && i.costCents > 0 && i.supplierCardAccountId).map((i) => [i.id, i]),
  );
  await reconcileCardPurchases(tx, ctx, sale, cardItems);
  const existingPay = await tx.payable.findMany({ where: { companyId: ctx.companyId, saleId, origin: "CUSTO_VENDA" } });
  const defaultSupplierDue = sale.tripStart && sale.tripStart > sale.saleDate ? addDays(sale.tripStart, -7) : addDays(sale.saleDate, 7);
  const costItems = sale.items.filter((i) => i.commercialModel !== "COMISSAO" && i.costCents > 0);
  for (const item of costItems) {
    const key = `item:${item.id}:custo`;
    const paidNow = item.supplierPayment === "CARTAO_AGENCIA" || item.supplierPayment === "A_VISTA";
    const existing = existingPay.find((p) => p.sourceKey === key);
    // A forma prevista só é gravada quando a conta nasce (ou renasce) ou quando a forma de pagar o fornecedor
    // mudou na venda; fora disso, vale o que o financeiro ajustou na conta.
    const setMethod = !existing || existing.status === "CANCELADO" || !!opts?.supplierPaymentChanged?.has(item.id);
    await syncEntries(
      tx,
      "payable",
      ctx,
      existingPay.filter((p) => p.sourceKey === key),
      [
        {
          sourceKey: key,
          amountCents: item.costCents,
          // no cartão é a data da compra e à vista a do pagamento: sem data, usa a da venda
          dueDate: item.supplierDueDate ?? (paidNow || defaultSupplierDue < sale.saleDate ? sale.saleDate : defaultSupplierDue),
          description: `${sale.code} · ${(item.operator ?? item.supplier)?.name ?? "Fornecedor"} · ${item.description ?? item.productType}`,
          ...(setMethod ? { method: supplierPayableMethod(item) } : {}),
        },
      ],
      { origin: "CUSTO_VENDA", saleId, saleItemId: item.id, supplierId: item.operatorId ?? item.supplierId, category: "FORNECEDORES" },
    );
  }
  const keptCostKeys = new Set(costItems.map((i) => `item:${i.id}:custo`));
  await syncEntries(tx, "payable", ctx, existingPay.filter((p) => !keptCostKeys.has(p.sourceKey ?? "")), [], {});
  // 2b) Fornecedor pago com o cartão da agência: a conta já nasce paga e o valor vai para as faturas.
  const warnings = await chargeCardPurchases(tx, ctx, sale, cardItems);

  // 3) Comissões a receber de fornecedores (modelo COMISSAO)
  const existingSupComm = await tx.receivable.findMany({ where: { companyId: ctx.companyId, saleId, origin: "COMISSAO_FORNECEDOR" } });
  // COMISSAO: o fornecedor repassa comissão + over + RAV/DU − taxa CC. Demais modelos: apenas o over.
  const remits = sale.items
    .map((item) => ({
      item,
      amount: supplierRemittance({ ...item, commercialModel: item.commercialModel as CommercialModel }),
      key: `item:${item.id}:${item.commercialModel === "COMISSAO" ? "comissao" : "over"}`,
    }))
    .filter((r) => r.amount > 0);
  for (const { item, amount, key } of remits) {
    const isComm = item.commercialModel === "COMISSAO";
    const who = (item.operator ?? item.supplier)?.name ?? "fornecedor";
    await syncEntries(
      tx,
      "receivable",
      ctx,
      existingSupComm.filter((r) => r.sourceKey === key),
      [
        {
          sourceKey: key,
          amountCents: amount,
          // No cartão da agência e à vista, a data do produto é a da compra/pagamento ao fornecedor (o sistema
          // grava a da venda quando fica vazia): não serve de vencimento do over, que segue o retorno da viagem.
          dueDate:
            (!isComm && (item.supplierPayment === "CARTAO_AGENCIA" || item.supplierPayment === "A_VISTA") ? null : item.supplierDueDate) ??
            addDays(sale.tripEnd ?? sale.saleDate, 30),
          description: `${sale.code} · ${isComm ? "Comissão" : "Over"} ${who}`,
          category: isComm ? "COMISSAO_FORNECEDOR" : "OVER",
        },
      ],
      { origin: "COMISSAO_FORNECEDOR", saleId, supplierId: item.operatorId ?? item.supplierId },
    );
  }
  const keptCommKeys = new Set(remits.map((r) => r.key));
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

  // 4b) Comissão do intermediário (parceiro/freelancer): uma conta a pagar
  const interKey = `intermediario:${saleId}`;
  await syncEntries(
    tx,
    "payable",
    ctx,
    await tx.payable.findMany({ where: { companyId: ctx.companyId, sourceKey: interKey } }),
    sale.intermediaryCommissionCents > 0 && sale.intermediaryId
      ? [
          {
            sourceKey: interKey,
            amountCents: sale.intermediaryCommissionCents,
            dueDate: commissionDueDate(sale.saleDate, sale.company.commissionPayDay),
            description: `Comissão intermediário ${sale.intermediary?.name ?? ""} · ${sale.code}`,
            supplierId: sale.intermediaryId,
          },
        ]
      : [],
    { origin: "COMISSAO_INTERMEDIARIO", saleId, category: "COMISSOES" },
  );

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
        // venda antiga trazida do Monde: a reserva já foi feita lá
        status: opts?.imported ? "CONFIRMADA" : "PENDENTE",
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

  // 6) Contrato (venda antiga trazida do Monde não gera contrato novo)
  if (!opts?.imported) await prepareContractForSale(tx, ctx.companyId, saleId, { ctx });
  return { warnings };
}

type SaleForCard = { id: string; code: string; saleDate: string };
type CardItem = {
  id: string;
  productType: string;
  description: string | null;
  costCents: number;
  supplierDueDate: string | null;
  supplierCardAccountId: string | null;
  supplierCardInstallments: number;
  supplierCardStartInstallment: number;
  supplierCardFirstBillMonth: string | null;
};
export const CARD_AUTO_PREFIX = "venda-cartao:";
const itemLabel = (i: { description: string | null; productType: string }) => i.description || PRODUCT_TYPES.label(i.productType);
/** Data da compra no cartão: a informada no produto ou a data da venda. */
const cardPurchaseDate = (sale: SaleForCard, i: CardItem) => i.supplierDueDate ?? sale.saleDate;

/**
 * Estorna as compras no cartão lançadas pela venda que não batem mais com o produto (cartão, valor,
 * parcelas, data ou fatura mudaram; produto removido ou deixou de ser pago no cartão). As que batem
 * ficam como estão, para não refazer à toa a cada edição. Baixas feitas à mão no Financeiro não são tocadas.
 */
async function reconcileCardPurchases(tx: Tx, ctx: Ctx, sale: SaleForCard, cardItems: Map<string, CardItem>) {
  const autos = await tx.settlement.findMany({
    where: { companyId: ctx.companyId, autoKey: { startsWith: CARD_AUTO_PREFIX }, reversedAt: null, payable: { saleId: sale.id } },
    include: { payable: { select: { description: true } } },
  });
  for (const s of autos) {
    const item = cardItems.get(s.autoKey!.slice(CARD_AUTO_PREFIX.length));
    if (item && s.payableId) {
      const others = await tx.settlement.findMany({ where: { payableId: s.payableId, reversedAt: null, id: { not: s.id } } });
      const manualCents = sum(others.map((o) => settlementPrincipal(o.amountCents, o.interestCents, o.discountCents)));
      const same =
        s.accountId === item.supplierCardAccountId &&
        s.amountCents === item.costCents - manualCents &&
        s.cardInstallments === item.supplierCardInstallments &&
        s.cardStartInstallment === item.supplierCardStartInstallment &&
        (s.cardFirstBillMonth ?? null) === (item.supplierCardFirstBillMonth ?? null) &&
        s.date === cardPurchaseDate(sale, item);
      if (same) continue;
    }
    const paidBill = await paidBillBlockingReversal(tx, s);
    if (paidBill)
      throw new AppError(
        `A compra no cartão de "${s.payable?.description ?? "fornecedor"}" está na fatura "${paidBill}", que já foi paga. Para mudar ou tirar essa compra, estorne antes o pagamento da fatura no Financeiro.`,
        "CONFLICT",
      );
    const reason = item ? "Venda alterada: compra no cartão refeita" : "Venda alterada: produto removido ou deixou de ser pago no cartão";
    await reverseSettlementTx(tx, ctx, s, reason);
    await audit(tx, ctx, "venda.fornecedor_cartao_estornado", "Sale", sale.id, { settlementId: s.id, saleItemId: s.autoKey!.slice(CARD_AUTO_PREFIX.length), amountCents: s.amountCents, reason });
  }
}

/**
 * Lança no cartão da agência o saldo da conta de cada fornecedor pago no cartão (sem permissão do
 * financeiro: é o registro de uma compra já feita, e fica na auditoria). Se a compra cairia numa
 * fatura já paga, não falha: a conta fica em aberto com a forma "Cartão de crédito" e volta um aviso.
 */
async function chargeCardPurchases(tx: Tx, ctx: Ctx, sale: SaleForCard, cardItems: Map<string, CardItem>) {
  const warnings: string[] = [];
  for (const item of cardItems.values()) {
    const p = await tx.payable.findUnique({ where: { companyId_sourceKey: { companyId: ctx.companyId, sourceKey: `item:${item.id}:custo` } } });
    if (!p || p.status === "CANCELADO") continue;
    const autoKey = `${CARD_AUTO_PREFIX}${item.id}`;
    if (await tx.settlement.findFirst({ where: { payableId: p.id, autoKey, reversedAt: null } })) continue;
    const balance = p.amountCents - p.settledCents;
    if (balance <= 0) continue;
    if (p.invoiceId)
      throw new AppError(`O custo de "${itemLabel(item)}" já está na fatura do fornecedor. Tire da fatura antes de marcar como pago no cartão.`, "CONFLICT");
    const account = await tx.financialAccount.findFirst({ where: { id: item.supplierCardAccountId!, companyId: ctx.companyId, type: "CARTAO_CREDITO", active: true } });
    if (!account) {
      warnings.push(`${itemLabel(item)}: o cartão escolhido não está mais ativo, então a compra não foi lançada no cartão.`);
      continue;
    }
    const date = cardPurchaseDate(sale, item);
    const opts = { firstMonth: item.supplierCardFirstBillMonth, startInstallment: item.supplierCardStartInstallment };
    const plan = planCardCharge(account, { date, amountCents: balance, cardInstallments: item.supplierCardInstallments }, opts);
    const paid = await findPaidCardBill(tx, ctx.companyId, account, plan);
    if (paid) {
      warnings.push(
        `${itemLabel(item)}: a fatura de ${paid.label} do cartão "${account.name}" já está paga, então a compra não foi lançada no cartão. A conta do fornecedor ficou em aberto; no Financeiro, registre o pagamento com o cartão escolhendo a fatura seguinte.`,
      );
      await audit(tx, ctx, "venda.fornecedor_cartao_pendente", "Sale", sale.id, { saleItemId: item.id, accountId: account.id, faturaPaga: paid.month });
      continue;
    }
    const r = await settleEntryTx(
      tx,
      ctx,
      "payable",
      p.id,
      {
        date,
        amountCents: balance,
        interestCents: 0,
        discountCents: 0,
        accountId: account.id,
        method: null,
        notes: "Pago com o cartão da agência ao confirmar a venda",
        cardInstallments: item.supplierCardInstallments,
        cardFirstBillMonth: item.supplierCardFirstBillMonth,
        cardStartInstallment: item.supplierCardStartInstallment,
        autoKey,
      },
      { viaInvoice: false },
    );
    // Sem data informada, a compra foi lançada com a data da venda: grava essa data no produto, para que
    // corrigir depois só a data da venda não refaça a compra em outra fatura (nem trave a edição por fatura paga).
    if (!item.supplierDueDate) await tx.saleItem.update({ where: { id: item.id }, data: { supplierDueDate: date } });
    await audit(tx, ctx, "venda.fornecedor_pago_cartao", "Sale", sale.id, {
      saleItemId: item.id,
      settlementId: r.settlementId,
      accountId: account.id,
      amountCents: balance,
      parcelas: item.supplierCardInstallments,
      parcelaInicial: item.supplierCardStartInstallment,
    });
  }
  return warnings;
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

export async function createSale(ctx: Ctx, raw: unknown, meta?: { origin: "API" | "FREDY" | "MONDE"; externalRef: string }) {
  assertCan(ctx, "sales.create");
  const imported = meta?.origin === "MONDE";
  const input = saleInputSchema.parse(raw);
  const totals = computeTotals(input);

  return prisma.$transaction(async (tx) => {
    const { client, sellerId } = await validateRefs(tx, ctx, input, undefined, input.confirm, undefined, !!meta);
    let warnings: string[] = [];
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
        origin: meta?.origin ?? "MANUAL",
        externalRef: meta?.externalRef ?? null,
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
            operatorId: i.operatorId,
            ravCents: i.ravCents,
            duCents: i.duCents,
            overCents: i.overCents,
            cardFeeCents: i.commercialModel === "COMISSAO" ? i.cardFeeCents : 0,
            ...supplierPaymentData(i),
            sortOrder: idx,
          })),
        },
        passengers: { create: (await fillPassengersFromClients(tx, ctx, input.passengers)).map((p) => ({ ...p, companyId: ctx.companyId })) },
      },
    });
    if (!client.ownerId) await tx.client.update({ where: { id: client.id }, data: { ownerId: sellerId } });
    if (input.confirm) {
      ({ warnings } = await syncConfirmedSale(tx, ctx, sale.id, { imported }));
      // venda antiga do Monde não avisa integrações (não marca card no CRM)
      if (!imported) await emitConfirmed(tx, ctx, sale.id, code, client, totals.grossCents);
    }
    await audit(tx, ctx, input.confirm ? "venda.criada_confirmada" : "venda.criada_rascunho", "Sale", sale.id, { code, grossCents: totals.grossCents });
    return { id: sale.id, code, warnings };
  });
}

export async function updateSale(ctx: Ctx, id: string, raw: unknown) {
  const input = saleInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const sale = await getEditableSale(tx, ctx, id);
    if (sale.status === "CANCELADA") throw new AppError("Venda cancelada não pode ser alterada.");
    // Venda conferida pelo financeiro: só o financeiro edita direto; os demais precisam de solicitação aprovada.
    let approvedRequestId: string | null = null;
    if (sale.reviewedAt && !can(ctx, "finance.manage")) {
      const req = await tx.editRequest.findFirst({ where: { saleId: id, companyId: ctx.companyId, status: "APROVADA" } });
      if (!req) throw new AppError("Esta venda já foi conferida pelo financeiro. Solicite a edição pela própria venda.", "FORBIDDEN");
      approvedRequestId = req.id;
    }
    const willBeConfirmed = sale.status !== "ORCAMENTO" || input.confirm;
    const totals = computeTotals({ ...input, confirm: willBeConfirmed });
    const keptCardIds = new Set(sale.items.map((i) => i.supplierCardAccountId).filter(Boolean) as string[]);
    const { client, sellerId } = await validateRefs(tx, ctx, { ...input, sellerId: input.sellerId ?? sale.sellerId }, id, willBeConfirmed, keptCardIds);

    // Itens: atualiza os que mantêm id, cria novos e remove os excluídos.
    const keepIds = new Set(input.items.map((i) => i.id).filter(Boolean) as string[]);
    for (const kid of keepIds) if (!sale.items.some((i) => i.id === kid)) throw new AppError("Produto inválido na venda.");
    // produtos mantidos em que a forma de pagar o fornecedor mudou: a conta a pagar recebe a forma nova
    const supplierPaymentChanged = new Set(
      input.items
        .filter((i) => {
          const old = i.id ? sale.items.find((o) => o.id === i.id) : null;
          return (
            !!old &&
            (old.supplierPayment !== i.supplierPayment ||
              (old.supplierPayMethod ?? null) !== (i.supplierPayMethod ?? null) ||
              (old.supplierCardAccountId ?? null) !== (i.supplierCardAccountId ?? null))
          );
        })
        .map((i) => i.id!),
    );
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
        operatorId: i.operatorId,
        ravCents: i.ravCents,
        duCents: i.duCents,
        overCents: i.overCents,
        cardFeeCents: i.commercialModel === "COMISSAO" ? i.cardFeeCents : 0,
        ...supplierPaymentData(i),
        sortOrder: idx,
      };
      if (i.id) await tx.saleItem.update({ where: { id: i.id }, data });
      else await tx.saleItem.create({ data: { ...data, companyId: ctx.companyId, saleId: id } });
    }
    await tx.passenger.deleteMany({ where: { saleId: id, companyId: ctx.companyId } });
    if (input.passengers.length) {
      const passengers = await fillPassengersFromClients(tx, ctx, input.passengers);
      await tx.passenger.createMany({ data: passengers.map((p) => ({ ...p, companyId: ctx.companyId, saleId: id })) });
    }

    const confirmingNow = sale.status === "ORCAMENTO" && input.confirm;
    await tx.sale.update({
      where: { id },
      data: {
        ...saleData(input, totals),
        sellerId,
        ...(confirmingNow ? { status: "CONFIRMADA", confirmedAt: new Date() } : {}),
        ...(approvedRequestId ? { reviewedAt: null, reviewedById: null } : {}),
      },
    });
    if (approvedRequestId) await tx.editRequest.update({ where: { id: approvedRequestId }, data: { status: "UTILIZADA" } });
    let warnings: string[] = [];
    if (willBeConfirmed) {
      ({ warnings } = await syncConfirmedSale(tx, ctx, id, { supplierPaymentChanged }));
      await emitConfirmed(tx, ctx, id, sale.code, client, totals.grossCents);
    }
    // saiu de uma viagem (ou trocou de viagem): o contrato da viagem antiga é refeito sem ela
    if (sale.tripId && sale.tripId !== (input.tripId ?? null)) {
      await syncTripContract(tx, ctx.companyId, sale.tripId, { ctx });
      if (willBeConfirmed) await prepareContractForSale(tx, ctx.companyId, id, { ctx });
    }
    await audit(tx, ctx, confirmingNow ? "venda.confirmada" : "venda.alterada", "Sale", id, {
      antes: { grossCents: sale.grossCents, costCents: sale.costCents, sellerCommissionCents: sale.sellerCommissionCents },
      depois: { grossCents: totals.grossCents, costCents: totals.costCents, sellerCommissionCents: totals.sellerCommissionCents },
    });
    return { id, code: sale.code, warnings };
  });
}

/**
 * Cancela a venda de forma controlada:
 * - lançamentos sem baixa são cancelados;
 * - lançamentos com baixa parcial têm o saldo restante encerrado (o valor baixado é preservado);
 * - nada que já foi pago é apagado — devoluções ao cliente devem ser lançadas no financeiro;
 * - compras no cartão da agência lançadas pela venda ficam na fatura, a não ser que se peça para tirar
 *   (reverseCardCharges). Fatura já paga nunca é mexida: a compra fica e volta um aviso.
 */
export async function cancelSale(ctx: Ctx, id: string, reason: string, opts: { reverseCardCharges?: boolean } = {}) {
  if (!reason || reason.trim().length < 3) throw new AppError("Informe o motivo do cancelamento.");
  return prisma.$transaction(async (tx) => {
    const sale = await getEditableSale(tx, ctx, id);
    if (sale.status === "CANCELADA") throw new AppError("A venda já está cancelada.");
    if (sale.status !== "ORCAMENTO") assertCan(ctx, "sales.cancel");
    const warnings: string[] = [];
    const now = new Date();
    const t = today(ctx);

    // Compras no cartão da agência lançadas por esta venda
    const keptCard = new Set<string>();
    const autos = await tx.settlement.findMany({
      where: { companyId: ctx.companyId, autoKey: { startsWith: CARD_AUTO_PREFIX }, reversedAt: null, payable: { saleId: id } },
      include: { account: { select: { name: true } }, payable: { select: { description: true } } },
    });
    for (const s of autos) {
      const what = s.payable?.description ?? "Fornecedor";
      if (opts.reverseCardCharges && !(await paidBillBlockingReversal(tx, s))) {
        await reverseSettlementTx(tx, ctx, s, "Venda cancelada: compra tirada do cartão");
        continue;
      }
      keptCard.add(s.payableId!);
      warnings.push(
        opts.reverseCardCharges
          ? `${what}: a compra no cartão ${s.account.name} já está numa fatura paga e foi mantida. Lance o reembolso do fornecedor na venda.`
          : `${what}: compra no cartão ${s.account.name} mantida na fatura.`,
      );
    }

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
        } else if (!keptCard.has(e.id)) {
          warnings.push(`${e.description}: ${money(e.settledCents)} já baixado foi mantido.`);
        }
      }
    }
    await tx.sale.update({ where: { id }, data: { status: "CANCELADA", cancelledAt: now, cancelReason: reason.trim() } });
    const commission = await tx.commission.findUnique({ where: { saleId: id } });
    if (commission) await refreshCommissionStatus(tx, commission.id);
    await tx.reservation.updateMany({ where: { saleId: id, companyId: ctx.companyId }, data: { status: "CANCELADA" } });
    // o contrato da viagem não é cancelado pela venda-base: a viagem troca a base ou marca o contrato como desatualizado
    await tx.contract.updateMany({ where: { saleId: id, companyId: ctx.companyId, tripId: null, status: { not: "CANCELADO" } }, data: { status: "CANCELADO" } });
    if (sale.tripId) await syncTripContract(tx, ctx.companyId, sale.tripId, { ctx });
    await audit(tx, ctx, "venda.cancelada", "Sale", id, { reason, warnings, tirarComprasDoCartao: !!opts.reverseCardCharges });
    return { warnings };
  });
}

export async function duplicateSale(ctx: Ctx, id: string) {
  assertCan(ctx, "sales.create");
  const sale = await prisma.sale.findFirst({ where: { id, ...saleScope(ctx) }, include: { items: true, passengers: true } });
  if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  const plan = JSON.parse(sale.paymentPlanJson) as PlanItem[];
  // Cartão desativado depois da venda: a cópia nasce sem cartão (o rascunho aceita) e o usuário escolhe outro ao confirmar.
  const cardIds = [...new Set(sale.items.map((i) => i.supplierCardAccountId).filter(Boolean))] as string[];
  const activeCards = new Set(
    cardIds.length
      ? (await prisma.financialAccount.findMany({ where: { id: { in: cardIds }, companyId: ctx.companyId, type: "CARTAO_CREDITO", active: true }, select: { id: true } })).map((c) => c.id)
      : [],
  );
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
    tripId: sale.tripId,
    excursionId: sale.excursionId,
    intermediaryId: sale.intermediaryId,
    intermediaryCommissionCents: sale.intermediaryCommissionCents,
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
      operatorId: i.operatorId,
      ravCents: i.ravCents,
      duCents: i.duCents,
      overCents: i.overCents,
      cardFeeCents: i.cardFeeCents,
      supplierPayment: i.supplierPayment as SaleParsed["items"][number]["supplierPayment"],
      supplierPayMethod: i.supplierPayMethod,
      supplierCardAccountId: i.supplierCardAccountId && activeCards.has(i.supplierCardAccountId) ? i.supplierCardAccountId : null,
      supplierCardInstallments: i.supplierCardInstallments,
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
  if (active.length === 0) return saleStatus === "ORCAMENTO" || receivables.length === 0 ? "SEM_COBRANCA" : "QUITADO";
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
  tripId?: string;
  excursionId?: string;
};

export async function listSales(ctx: Ctx, f: SaleListFilters) {
  const extra: Prisma.SaleWhereInput[] = [];
  if (f.pending)
    extra.push({ status: "CONFIRMADA", OR: [{ destination: null }, { tripStart: null }, { locator: null }, CLIENT_DOC_MISSING] });
  if (f.upcomingTripDays)
    extra.push({ status: "CONFIRMADA", tripStart: { gte: today(ctx), lte: addDays(today(ctx), f.upcomingTripDays) } });
  const where: Prisma.SaleWhereInput = {
    AND: extra,
    ...saleScope(ctx),
    ...(f.status ? { status: f.status } : {}),
    ...(f.tripId ? { tripId: f.tripId } : {}),
    ...(f.excursionId ? { excursionId: f.excursionId } : {}),
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
            { passengers: { some: { name: textContains(f.q) } } },
            { items: { some: { locator: textContains(f.q) } } },
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
      contracts: { select: { status: true, tripId: true, saleIdsJson: true } },
      trip: tripContractInclude({ status: true, tripId: true }),
      _count: { select: { items: true } },
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
    contractStatus: effectiveContract(s)?.status ?? "NAO_GERADO",
    /** a venda está no contrato da viagem (não tem contrato próprio) */
    inTripContract: !!effectiveContract(s)?.tripId,
    /** no contrato da viagem, mas incluída depois da emissão: ainda não está no texto */
    tripContractPending: (() => {
      const c = effectiveContract(s);
      return !!c?.tripId && !(JSON.parse(c.saleIdsJson) as string[]).includes(s.id);
    })(),
    trip: s.trip ? { id: s.trip.id, code: s.trip.code } : null,
    itemCount: s._count.items,
    tripStart: s.tripStart,
  }));
  let total: number;
  if (f.financial) {
    mapped = mapped.filter((m) => m.financialStatus === f.financial);
    total = mapped.length;
    mapped = mapped.slice((page - 1) * pageSize, page * pageSize);
  } else {
    total = await prisma.sale.count({ where });
  }
  const [agg, openRec] = await Promise.all([
    prisma.sale.aggregate({ where: { AND: [where, { status: { not: "CANCELADA" } }] }, _sum: { grossCents: true, grossProfitCents: true }, _count: { _all: true } }),
    prisma.receivable.aggregate({
      where: { companyId: ctx.companyId, origin: "VENDA", status: { in: ["PENDENTE", "PARCIAL"] }, sale: where },
      _sum: { amountCents: true, settledCents: true },
    }),
  ]);
  const summary = {
    count: agg._count._all,
    grossCents: agg._sum.grossCents ?? 0,
    grossProfitCents: can(ctx, "sales.view_margin") ? (agg._sum.grossProfitCents ?? 0) : null,
    openCents: (openRec._sum.amountCents ?? 0) - (openRec._sum.settledCents ?? 0),
  };
  return { items: mapped, total, page, pages: Math.max(1, Math.ceil(total / pageSize)), summary };
}

export async function getSale(ctx: Ctx, id: string) {
  const sale = await prisma.sale.findFirst({
    where: { id, ...saleScope(ctx) },
    include: {
      client: true,
      seller: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      items: {
        include: { supplier: { select: { id: true, name: true } }, operator: { select: { id: true, name: true } }, supplierCardAccount: { select: { id: true, name: true } }, reservation: true },
        orderBy: { sortOrder: "asc" },
      },
      passengers: { include: { client: { select: { id: true, name: true } } } },
      receivables: { orderBy: [{ dueDate: "asc" }], include: { settlements: { where: { reversedAt: null } }, client: { select: { id: true, name: true } } } },
      payables: { orderBy: [{ dueDate: "asc" }], include: { invoice: { select: { id: true, number: true, status: true } } } },
      trip: {
        select: {
          id: true,
          code: true,
          title: true,
          contracts: { where: { status: { not: "CANCELADO" } }, take: 1 },
          sales: { where: { status: { in: ["CONFIRMADA", "CONCLUIDA"] } }, select: { id: true, code: true, contracts: { select: { id: true } } }, orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }] },
        },
      },
      excursion: { select: { id: true, code: true, name: true } },
      intermediary: { select: { id: true, name: true } },
      attachments: { orderBy: { createdAt: "desc" } },
      commission: true,
      contracts: true,
    },
  });
  if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
  const showMargin = can(ctx, "sales.view_margin");
  const canFinance = can(ctx, "finance.view");
  // Compras no cartão da agência lançadas pela venda: em quais faturas caíram
  const cardAutos = await prisma.settlement.findMany({
    where: { companyId: ctx.companyId, reversedAt: null, autoKey: { in: sale.items.map((i) => `${CARD_AUTO_PREFIX}${i.id}`) } },
    select: { id: true, autoKey: true, cardBillsJson: true },
  });
  const cardBills = await getCardBillsFor(prisma as unknown as Tx, ctx.companyId, cardAutos);
  // só o mês da fatura ("dez/2026"): o nome do cartão já aparece em "Fornecedor: pago no cartão ..."
  const cardByItem = new Map(cardAutos.map((c) => [c.autoKey!.slice(CARD_AUTO_PREFIX.length), (cardBills[c.id] ?? []).map((b) => b.description.split(" · ").pop() ?? b.description)]));
  // venda cancelada: compras tiradas do cartão no cancelamento
  const cardReversed =
    sale.status === "CANCELADA"
      ? new Set(
          (
            await prisma.settlement.findMany({
              where: { companyId: ctx.companyId, reversedAt: { not: null }, reversalReason: { startsWith: "Venda cancelada" }, autoKey: { in: sale.items.map((i) => `${CARD_AUTO_PREFIX}${i.id}`) } },
              select: { autoKey: true },
            })
          ).map((r) => r.autoKey!.slice(CARD_AUTO_PREFIX.length)),
        )
      : new Set<string>();
  return {
    ...sale,
    costCents: showMargin ? sale.costCents : null,
    grossProfitCents: showMargin ? sale.grossProfitCents : null,
    marginBps: showMargin ? sale.marginBps : null,
    agencyRevenueCents: showMargin ? sale.agencyRevenueCents : null,
    intermediaryCommissionCents: showMargin ? sale.intermediaryCommissionCents : null,
    items: sale.items.map((i) => ({
      ...i,
      costCents: showMargin ? i.costCents : null,
      supplierCommissionCents: showMargin ? i.supplierCommissionCents : null,
      overCents: showMargin ? i.overCents : null,
      cardFeeCents: showMargin ? i.cardFeeCents : null,
      /** cartão da agência: faturas em que a compra caiu (null = ainda não lançada no cartão) */
      cardBills: cardByItem.get(i.id) ?? null,
      /** venda cancelada: a compra no cartão foi estornada no cancelamento */
      cardReversedOnCancel: cardReversed.has(i.id),
    })),
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
      client: { select: { id: true, name: true, document: true, whatsapp: true, phone: true, email: true, foreigner: true, passportNumber: true, rne: true, nationality: true } },
      items: { orderBy: { sortOrder: "asc" } },
      passengers: true,
      receivables: { where: { origin: "VENDA" }, select: { sourceKey: true, settledCents: true, status: true } },
      trip: { select: { id: true, code: true, title: true } },
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
  const personIds = [...new Set([...plan.map((p) => p.payerClientId), ...sale.passengers.map((p) => p.clientId)].filter(Boolean))] as string[];
  const people = await prisma.client.findMany({ where: { id: { in: personIds }, companyId: ctx.companyId }, select: { id: true, name: true, document: true } });
  return { ...sale, plan, locked, people };
}

// ---------------------------------------------------------------------------
// Reembolsos, multas e créditos ligados à venda (cancelamentos, remarcações)
// ---------------------------------------------------------------------------

/**
 * Registra um reembolso ou multa vinculado à venda, gerando o lançamento financeiro correspondente:
 * - Reembolso ao cliente → conta a pagar ao cliente (repasse: não entra no DRE)
 * - Reembolso do fornecedor → conta a receber do fornecedor (repasse: não entra no DRE)
 * - Multa paga ao fornecedor → conta a pagar (despesa)
 * - Multa cobrada do cliente → conta a receber (receita)
 * A chave do pedido garante que um duplo clique não gere dois lançamentos.
 */
export async function registerRefund(ctx: Ctx, saleId: string, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const input = refundSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, companyId: ctx.companyId } });
    if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");
    if (sale.status === "ORCAMENTO") throw new AppError("Rascunhos não têm movimentação financeira para reembolsar.");
    const needsSupplier = input.kind === "REEMBOLSO_FORNECEDOR" || input.kind === "MULTA_FORNECEDOR";
    if (needsSupplier) {
      if (!input.supplierId) throw new AppError("Selecione o fornecedor.", "VALIDATION", [{ field: "supplierId", message: "Selecione o fornecedor." }]);
      const sup = await tx.supplier.findFirst({ where: { id: input.supplierId, companyId: ctx.companyId } });
      if (!sup) throw new AppError("Fornecedor inválido.");
    }
    const sourceKey = `ajuste:${saleId}:${input.requestKey}`;
    const dup =
      (await tx.payable.findFirst({ where: { companyId: ctx.companyId, sourceKey } })) ??
      (await tx.receivable.findFirst({ where: { companyId: ctx.companyId, sourceKey } }));
    if (dup) return { id: dup.id, duplicated: true };
    const description = `${sale.code} · ${REFUND_KINDS.label(input.kind)}${input.description ? ` · ${input.description}` : ""}`;
    const common = { companyId: ctx.companyId, sourceKey, saleId, description, amountCents: input.amountCents, dueDate: input.dueDate, status: "PENDENTE", origin: "AJUSTE_VENDA", category: input.kind };
    let id: string;
    if (input.kind === "REEMBOLSO_CLIENTE" || input.kind === "MULTA_FORNECEDOR") {
      id = (
        await tx.payable.create({
          data: { ...common, clientId: input.kind === "REEMBOLSO_CLIENTE" ? sale.clientId : null, supplierId: input.kind === "MULTA_FORNECEDOR" ? input.supplierId : null },
        })
      ).id;
    } else {
      id = (
        await tx.receivable.create({
          data: { ...common, clientId: input.kind === "MULTA_CLIENTE" ? sale.clientId : null, supplierId: input.kind === "REEMBOLSO_FORNECEDOR" ? input.supplierId : null },
        })
      ).id;
    }
    await audit(tx, ctx, "venda.ajuste_registrado", "Sale", saleId, { kind: input.kind, amountCents: input.amountCents, entryId: id });
    return { id, duplicated: false };
  });
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
