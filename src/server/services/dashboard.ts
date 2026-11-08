import { prisma, Prisma } from "../db";
import { can, today, type Ctx } from "../context";
import { addDays, addMonths, endOfMonth, monthKey, monthsBetween, previousPeriod, startOfMonth, type Period } from "@/lib/dates";
import { ratioBps, sum } from "@/lib/money";
import { CLIENT_DOC_MISSING, saleScope } from "./sales";
import { computeDre } from "./dre";

export type DashboardFilters = Period & { sellerId?: string; productType?: string; status?: string };

function salesWhere(ctx: Ctx, f: DashboardFilters, period: Period): Prisma.SaleWhereInput {
  return {
    ...saleScope(ctx),
    status: f.status ? f.status : { in: ["CONFIRMADA", "CONCLUIDA"] },
    saleDate: { gte: period.from, lte: period.to },
    ...(f.sellerId && can(ctx, "sales.view_all") ? { sellerId: f.sellerId } : {}),
    ...(f.productType ? { items: { some: { productType: f.productType } } } : {}),
  };
}

async function salesKpis(ctx: Ctx, f: DashboardFilters, period: Period) {
  const agg = await prisma.sale.aggregate({
    where: salesWhere(ctx, f, period),
    _sum: { grossCents: true, agencyRevenueCents: true, grossProfitCents: true, sellerCommissionCents: true, costCents: true },
    _count: { _all: true },
  });
  const gross = agg._sum.grossCents ?? 0;
  const count = agg._count._all;
  const profit = agg._sum.grossProfitCents ?? 0;
  return {
    grossCents: gross,
    count,
    agencyRevenueCents: agg._sum.agencyRevenueCents ?? 0,
    grossProfitCents: profit,
    marginBps: ratioBps(profit, gross),
    sellerCommissionCents: agg._sum.sellerCommissionCents ?? 0,
    costCents: agg._sum.costCents ?? 0,
    ticketCents: count ? Math.round(gross / count) : 0,
  };
}

export async function getDashboard(ctx: Ctx, f: DashboardFilters) {
  const t = today(ctx);
  const financial = can(ctx, "dashboard.financeiro");
  const showMargin = can(ctx, "sales.view_margin");
  const period: Period = { from: f.from, to: f.to };
  const [current, previous] = await Promise.all([salesKpis(ctx, f, period), salesKpis(ctx, f, previousPeriod(period))]);

  // Série de 12 meses terminando no mês final do período
  const seriesFrom = addMonths(startOfMonth(f.to), -11);
  const seriesTo = endOfMonth(f.to);
  const months = monthsBetween(seriesFrom, seriesTo);
  const seriesSales = await prisma.sale.findMany({
    where: salesWhere(ctx, f, { from: seriesFrom, to: seriesTo }),
    select: { saleDate: true, grossCents: true, grossProfitCents: true, agencyRevenueCents: true },
  });
  const evolution = months.map((m) => {
    const ss = seriesSales.filter((s) => monthKey(s.saleDate) === m);
    const gross = sum(ss.map((s) => s.grossCents));
    const profit = sum(ss.map((s) => s.grossProfitCents));
    return {
      month: m,
      grossCents: gross,
      count: ss.length,
      profitCents: showMargin ? profit : null,
      revenueCents: showMargin ? sum(ss.map((s) => s.agencyRevenueCents)) : null,
      marginBps: showMargin ? ratioBps(profit, gross) : null,
    };
  });

  // Distribuições do período
  const periodSales = await prisma.sale.findMany({
    where: salesWhere(ctx, f, period),
    select: {
      grossCents: true,
      grossProfitCents: true,
      destination: true,
      seller: { select: { id: true, name: true } },
      items: { select: { productType: true, priceCents: true } },
    },
  });
  const bySeller = groupSum(periodSales, (s) => s.seller.name, (s) => s.grossCents);
  const byCategory = groupSum(
    periodSales.flatMap((s) => s.items),
    (i) => i.productType,
    (i) => i.priceCents,
  );
  const byDestination = groupSum(
    periodSales.filter((s) => s.destination),
    (s) => s.destination!.trim(),
    (s) => s.grossCents,
  ).slice(0, 8);

  let finance = null as null | Awaited<ReturnType<typeof financeBlock>>;
  if (financial) finance = await financeBlock(ctx, period, months, seriesFrom, seriesTo, t);

  const alerts = await getAlerts(ctx, t, financial);
  const lists = await dashboardLists(ctx, t, financial);
  const dre = financial && showMargin && can(ctx, "reports.financial") ? await computeDre(ctx.companyId, period) : null;
  const byProductCount = groupSum(
    periodSales.flatMap((s) => s.items),
    (i) => i.productType,
    () => 1,
  );

  return {
    period,
    financial,
    showMargin,
    kpis: {
      ...current,
      agencyRevenueCents: showMargin ? current.agencyRevenueCents : null,
      grossProfitCents: showMargin ? current.grossProfitCents : null,
      marginBps: showMargin ? current.marginBps : null,
    },
    previous: {
      ...previous,
      agencyRevenueCents: showMargin ? previous.agencyRevenueCents : null,
      grossProfitCents: showMargin ? previous.grossProfitCents : null,
      marginBps: showMargin ? previous.marginBps : null,
    },
    evolution,
    bySeller: can(ctx, "sales.view_all") ? bySeller : [],
    byCategory,
    byDestination,
    byProductCount,
    finance,
    alerts,
    lists,
    result: dre ? { resultCents: dre.result, netRevenueCents: dre.netRevenue, costsCents: dre.netRevenue - dre.result, marginBps: dre.marginBps } : null,
  };
}

/** Listas operacionais do painel: vendas recentes, próximas viagens, contratos e pendências financeiras. */
async function dashboardLists(ctx: Ctx, t: string, financial: boolean) {
  const scope = saleScope(ctx);
  const [recentSales, upcomingTrips, pendingContracts, dueReceivables] = await Promise.all([
    prisma.sale.findMany({
      where: { ...scope, status: { not: "CANCELADA" } },
      orderBy: [{ createdAt: "desc" }],
      take: 6,
      select: { id: true, code: true, saleDate: true, status: true, destination: true, grossCents: true, client: { select: { name: true } } },
    }),
    prisma.sale.findMany({
      where: { ...scope, status: { in: ["CONFIRMADA", "CONCLUIDA"] }, tripStart: { gte: t } },
      orderBy: { tripStart: "asc" },
      take: 6,
      select: { id: true, code: true, destination: true, tripStart: true, passengerCount: true, client: { select: { name: true } } },
    }),
    prisma.contract.findMany({
      where: { companyId: ctx.companyId, status: { in: ["NAO_GERADO", "EM_PREPARACAO", "AGUARDANDO_ENVIO", "ENVIADO"] }, sale: { ...scope, status: { in: ["CONFIRMADA", "CONCLUIDA"] } } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, status: true, missingFieldsJson: true, sale: { select: { code: true, client: { select: { name: true } } } }, trip: { select: { code: true } } },
    }),
    financial && can(ctx, "finance.view")
      ? prisma.receivable.findMany({
          where: { companyId: ctx.companyId, status: { in: ["PENDENTE", "PARCIAL"] }, dueDate: { lte: addDays(t, 7) } },
          orderBy: { dueDate: "asc" },
          take: 6,
          select: { id: true, description: true, dueDate: true, amountCents: true, settledCents: true, client: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  return {
    recentSales,
    upcomingTrips,
    pendingContracts: pendingContracts.map((c) => ({ ...c, missing: (JSON.parse(c.missingFieldsJson) as string[]).length })),
    dueReceivables: dueReceivables.map((r) => ({ ...r, balanceCents: r.amountCents - r.settledCents, overdue: r.dueDate < t })),
  };
}

function groupSum<T>(rows: T[], key: (r: T) => string, value: (r: T) => number) {
  const m = new Map<string, { key: string; valueCents: number; count: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = m.get(k) ?? { key: k, valueCents: 0, count: 0 };
    cur.valueCents += value(r);
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.valueCents - a.valueCents);
}

async function financeBlock(ctx: Ctx, period: Period, months: string[], seriesFrom: string, seriesTo: string, t: string) {
  const c = ctx.companyId;
  const open = { in: ["PENDENTE", "PARCIAL"] };
  const [recPeriod, payPeriod, recOverdue, payOverdue, settlements, openRec, openPay, commissionsPending, accounts, accSettlements, expenses] = await Promise.all([
    prisma.receivable.findMany({ where: { companyId: c, status: open, dueDate: { gte: period.from, lte: period.to } }, select: { amountCents: true, settledCents: true } }),
    prisma.payable.findMany({ where: { companyId: c, status: open, dueDate: { gte: period.from, lte: period.to } }, select: { amountCents: true, settledCents: true } }),
    prisma.receivable.findMany({ where: { companyId: c, status: open, dueDate: { lt: t } }, select: { amountCents: true, settledCents: true } }),
    prisma.payable.findMany({ where: { companyId: c, status: open, dueDate: { lt: t } }, select: { amountCents: true, settledCents: true } }),
    prisma.settlement.findMany({ where: { companyId: c, reversedAt: null, account: { type: { not: "CARTAO_CREDITO" } }, date: { gte: seriesFrom, lte: seriesTo } }, select: { date: true, kind: true, amountCents: true } }),
    prisma.receivable.findMany({ where: { companyId: c, status: open, dueDate: { gte: seriesFrom, lte: seriesTo } }, select: { dueDate: true, amountCents: true, settledCents: true } }),
    prisma.payable.findMany({ where: { companyId: c, status: open, dueDate: { gte: seriesFrom, lte: seriesTo } }, select: { dueDate: true, amountCents: true, settledCents: true } }),
    prisma.commission.aggregate({ where: { companyId: c, status: "PENDENTE" }, _sum: { amountCents: true } }),
    prisma.financialAccount.findMany({ where: { companyId: c, active: true, type: { not: "CARTAO_CREDITO" } }, select: { initialBalanceCents: true } }),
    prisma.settlement.groupBy({ by: ["kind"], where: { companyId: c, reversedAt: null, account: { type: { not: "CARTAO_CREDITO" } }, date: { lte: t } }, _sum: { amountCents: true } }),
    prisma.payable.findMany({
      where: { companyId: c, status: { not: "CANCELADO" }, dueDate: { gte: period.from, lte: period.to }, origin: { notIn: ["CUSTO_VENDA"] } },
      select: { category: true, amountCents: true },
    }),
  ]);
  const balanceCents =
    sum(accounts.map((a) => a.initialBalanceCents)) +
    (accSettlements.find((x) => x.kind === "RECEBIMENTO")?._sum.amountCents ?? 0) -
    (accSettlements.find((x) => x.kind === "PAGAMENTO")?._sum.amountCents ?? 0);
  const expensesByCategory = groupSum(expenses, (e) => e.category, (e) => e.amountCents);
  const bal = (rows: { amountCents: number; settledCents: number }[]) => sum(rows.map((r) => r.amountCents - r.settledCents));
  const realizedInPeriod = settlements.filter((s) => s.date >= period.from && s.date <= period.to);
  return {
    receivableCents: bal(recPeriod),
    payableCents: bal(payPeriod),
    overdueReceivableCents: bal(recOverdue),
    overduePayableCents: bal(payOverdue),
    receivedCents: sum(realizedInPeriod.filter((s) => s.kind === "RECEBIMENTO").map((s) => s.amountCents)),
    paidCents: sum(realizedInPeriod.filter((s) => s.kind === "PAGAMENTO").map((s) => s.amountCents)),
    commissionsPendingCents: commissionsPending._sum.amountCents ?? 0,
    balanceCents,
    expensesByCategory,
    cashSeries: months.map((m) => ({
      month: m,
      receivedCents: sum(settlements.filter((s) => s.kind === "RECEBIMENTO" && monthKey(s.date) === m).map((s) => s.amountCents)),
      paidCents: sum(settlements.filter((s) => s.kind === "PAGAMENTO" && monthKey(s.date) === m).map((s) => s.amountCents)),
      toReceiveCents: bal(openRec.filter((r) => monthKey(r.dueDate) === m)),
      toPayCents: bal(openPay.filter((r) => monthKey(r.dueDate) === m)),
    })),
  };
}

export type Alert = { key: string; severity: "danger" | "warning" | "info"; title: string; detail: string; href: string; count: number; amountCents?: number };

export async function getAlerts(ctx: Ctx, t: string, financial: boolean): Promise<Alert[]> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { upcomingDueDays: true, upcomingTripDays: true } });
  const c = ctx.companyId;
  const open = { in: ["PENDENTE", "PARCIAL"] };
  const alerts: Alert[] = [];
  const bal = (rows: { amountCents: number; settledCents: number }[]) => sum(rows.map((r) => r.amountCents - r.settledCents));

  if (financial && can(ctx, "finance.view")) {
    const [payOver, payNext, recOver] = await Promise.all([
      prisma.payable.findMany({ where: { companyId: c, status: open, dueDate: { lt: t } }, select: { amountCents: true, settledCents: true } }),
      prisma.payable.findMany({ where: { companyId: c, status: open, dueDate: { gte: t, lte: addDays(t, company.upcomingDueDays) } }, select: { amountCents: true, settledCents: true } }),
      prisma.receivable.findMany({ where: { companyId: c, status: open, dueDate: { lt: t } }, select: { amountCents: true, settledCents: true } }),
    ]);
    if (payOver.length) alerts.push({ key: "pagar-vencidas", severity: "danger", title: "Contas a pagar vencidas", detail: `${payOver.length} lançamento(s)`, href: "/financeiro/pagar?status=VENCIDO", count: payOver.length, amountCents: bal(payOver) });
    if (recOver.length) alerts.push({ key: "receber-atrasados", severity: "danger", title: "Recebimentos atrasados", detail: `${recOver.length} parcela(s)`, href: "/financeiro/receber?status=VENCIDO", count: recOver.length, amountCents: bal(recOver) });
    if (payNext.length) alerts.push({ key: "pagar-proximas", severity: "warning", title: `Pagamentos nos próximos ${company.upcomingDueDays} dias`, detail: `${payNext.length} lançamento(s)`, href: `/financeiro/pagar?status=ABERTO&from=${t}&to=${addDays(t, company.upcomingDueDays)}`, count: payNext.length, amountCents: bal(payNext) });
    const commissions = await prisma.commission.findMany({ where: { companyId: c, status: "PENDENTE" }, select: { amountCents: true } });
    const invoices = await prisma.supplierInvoice.findMany({ where: { companyId: c, status: { in: ["ABERTA", "CONFERIDA"] } }, select: { dueDate: true, status: true } });
    const invOver = invoices.filter((i) => i.dueDate < t).length;
    const invCheck = invoices.filter((i) => i.status === "ABERTA").length;
    if (invOver) alerts.push({ key: "faturas-vencidas", severity: "danger", title: "Faturas de fornecedor vencidas", detail: `${invOver} fatura(s) sem pagamento`, href: "/financeiro/faturas", count: invOver });
    else if (invCheck) alerts.push({ key: "faturas-conferir", severity: "info", title: "Faturas de fornecedor para conferir", detail: `${invCheck} em conferência`, href: "/financeiro/faturas?status=ABERTA", count: invCheck });
    if (commissions.length) alerts.push({ key: "comissoes", severity: "info", title: "Comissões pendentes", detail: `${commissions.length} comissão(ões) a pagar`, href: "/financeiro/pagar?category=COMISSOES&status=ABERTO", count: commissions.length, amountCents: sum(commissions.map((x) => x.amountCents)) });
  } else {
    const own = await prisma.commission.findMany({ where: { companyId: c, sellerId: ctx.userId, status: "PENDENTE" }, select: { amountCents: true } });
    if (own.length) alerts.push({ key: "comissoes", severity: "info", title: "Suas comissões pendentes", detail: `${own.length} venda(s)`, href: "/vendas", count: own.length, amountCents: sum(own.map((x) => x.amountCents)) });
  }

  const scope = saleScope(ctx);
  const [contracts, trips, incomplete] = await Promise.all([
    prisma.contract.findMany({ where: { companyId: c, status: { in: ["EM_PREPARACAO", "AGUARDANDO_ENVIO", "ENVIADO"] }, sale: { ...scope, status: { in: ["CONFIRMADA", "CONCLUIDA"] } } }, select: { status: true } }),
    prisma.sale.count({ where: { ...scope, status: "CONFIRMADA", tripStart: { gte: t, lte: addDays(t, company.upcomingTripDays) } } }),
    prisma.sale.findMany({
      where: { ...scope, status: "CONFIRMADA", OR: [{ destination: null }, { tripStart: null }, { locator: null }, CLIENT_DOC_MISSING] },
      select: { id: true },
    }),
  ]);
  const awaiting = contracts.filter((x) => x.status !== "EM_PREPARACAO").length;
  const preparing = contracts.length - awaiting;
  if (awaiting) alerts.push({ key: "contratos-assinatura", severity: "warning", title: "Contratos aguardando assinatura", detail: `${awaiting} contrato(s) emitido(s) ou enviado(s)`, href: "/contratos?status=AGUARDANDO_ENVIO", count: awaiting });
  if (preparing) alerts.push({ key: "contratos-preparacao", severity: "info", title: "Contratos para conferir e emitir", detail: `${preparing} em preparação`, href: "/contratos?status=EM_PREPARACAO", count: preparing });
  if (incomplete.length) alerts.push({ key: "vendas-incompletas", severity: "warning", title: "Vendas sem informações obrigatórias", detail: "Destino, data da viagem, localizador ou documento do cliente", href: "/vendas?pendencias=1", count: incomplete.length });
  const passports = await prisma.sale.findMany({
    where: {
      ...scope,
      status: "CONFIRMADA",
      tripStart: { gte: t, lte: addDays(t, 120) },
      client: { passportExpiry: { not: null, lt: addMonths(t, 6) } },
      items: { some: { productType: { in: ["AEREO", "PACOTE", "CRUZEIRO"] } } },
    },
    select: { id: true },
  });
  if (passports.length) alerts.push({ key: "passaportes", severity: "warning", title: "Passaporte vencendo antes da viagem", detail: "Clientes com viagem marcada e passaporte com menos de 6 meses de validade", href: "/vendas?viagem=proximas", count: passports.length });
  if (trips) alerts.push({ key: "viagens-proximas", severity: "info", title: `Viagens nos próximos ${company.upcomingTripDays} dias`, detail: `${trips} reserva(s)`, href: `/vendas?viagem=proximas`, count: trips });
  return alerts;
}
