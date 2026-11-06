/**
 * Relatórios gerenciais. Definições consistentes com src/lib/finance.ts:
 * - Faturamento: valor comercial vendido (competência = data da venda).
 * - Receita própria: parcela que é efetivamente da agência.
 * - Lucro bruto: após custos e comissão do vendedor.
 * - Caixa: movimentação realizada (data da baixa), independente da competência.
 */
import { prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { monthKey, monthsBetween, monthLabel, previousPeriod, type Period } from "@/lib/dates";
import { formatBRL, ratioBps, sum } from "@/lib/money";
import { saleScope } from "./sales";
import { computeDre } from "./dre";
import { displayStatus } from "@/lib/finance";
import {
  ENTRY_STATUS,
  PAYABLE_CATEGORIES,
  PRODUCT_TYPES,
  SALE_STATUS,
  SUPPLIER_CATEGORIES,
  RECEIVABLE_CATEGORIES,
  REFUND_KINDS,
} from "@/lib/constants";
import type { Permission } from "@/lib/permissions";

export type ColType = "text" | "money" | "percent" | "int" | "date";
export type Column = { key: string; label: string; type: ColType };
export type ReportResult = { columns: Column[]; rows: Record<string, string | number | null>[]; totals?: Record<string, number | null>; note?: string };

export const REPORTS: { key: string; title: string; group: "Comercial" | "Financeiro" | "Operação"; permission: Permission; margin?: boolean; comparable?: boolean; description: string }[] = [
  { key: "vendas-periodo", title: "Vendas por período", group: "Comercial", permission: "reports.commercial", description: "Todas as vendas confirmadas no período." },
  { key: "vendas-vendedor", title: "Vendas por vendedor", group: "Comercial", permission: "reports.commercial", comparable: true, description: "Faturamento e quantidade por vendedor." },
  { key: "vendas-produto", title: "Vendas por produto", group: "Comercial", permission: "reports.commercial", comparable: true, description: "Faturamento por categoria de produto." },
  { key: "vendas-destino", title: "Vendas por destino", group: "Comercial", permission: "reports.commercial", comparable: true, description: "Faturamento por destino." },
  { key: "rentabilidade-venda", title: "Rentabilidade por venda", group: "Comercial", permission: "reports.commercial", margin: true, description: "Receita, custos, comissão, lucro e margem de cada venda." },
  { key: "rentabilidade-vendedor", title: "Rentabilidade por vendedor", group: "Comercial", permission: "reports.commercial", margin: true, comparable: true, description: "Lucro bruto e margem por vendedor." },
  { key: "receita-margem", title: "Receita e margem (mensal)", group: "Financeiro", permission: "reports.financial", margin: true, description: "Faturamento × receita própria × lucro por mês (competência)." },
  { key: "contas-receber", title: "Contas a receber", group: "Financeiro", permission: "reports.financial", description: "Lançamentos a receber com vencimento no período." },
  { key: "contas-pagar", title: "Contas a pagar", group: "Financeiro", permission: "reports.financial", description: "Lançamentos a pagar com vencimento no período." },
  { key: "fluxo-caixa", title: "Fluxo de caixa (realizado)", group: "Financeiro", permission: "reports.financial", description: "Entradas e saídas efetivamente movimentadas por mês." },
  { key: "comissoes", title: "Comissões", group: "Financeiro", permission: "reports.financial", description: "Comissões de vendedores das vendas do período." },
  { key: "despesas-categoria", title: "Despesas por categoria", group: "Financeiro", permission: "reports.financial", comparable: true, description: "Contas a pagar por categoria (vencimento no período)." },
  { key: "resultado-fornecedor", title: "Resultados por fornecedor", group: "Financeiro", permission: "reports.financial", description: "Volume negociado, custos, pagos e pendências por fornecedor." },
  { key: "dre", title: "DRE gerencial", group: "Financeiro", permission: "reports.financial", margin: true, description: "Demonstrativo de resultado por competência: receitas da agência, custos, comissões e despesas." },
  { key: "contas-vencidas", title: "Contas vencidas", group: "Financeiro", permission: "reports.financial", description: "Recebimentos e pagamentos em atraso na data de hoje (o período é ignorado)." },
  { key: "centro-custo", title: "Lançamentos por centro de custo", group: "Financeiro", permission: "reports.financial", description: "Receitas e despesas avulsas por centro de custo (vencimento no período)." },
  { key: "reembolsos", title: "Reembolsos e multas", group: "Financeiro", permission: "reports.financial", description: "Reembolsos e multas registrados nas vendas (vencimento no período)." },
  { key: "comissoes-intermediarios", title: "Comissões de intermediários", group: "Financeiro", permission: "reports.financial", description: "Comissões a pagar a parceiros/intermediários das vendas do período." },
  { key: "resultado-viagem", title: "Resultado por viagem", group: "Operação", permission: "reports.commercial", margin: true, description: "Vendas agrupadas por viagem, com valores e lucro." },
  { key: "resultado-excursao", title: "Resultado por excursão", group: "Operação", permission: "reports.commercial", margin: true, description: "Ocupação, receitas, custos e resultado de cada excursão (saída no período)." },
];

export function availableReports(ctx: Ctx) {
  return REPORTS.filter((r) => can(ctx, r.permission) && (!r.margin || can(ctx, "sales.view_margin")));
}

const confirmed = { in: ["CONFIRMADA", "CONCLUIDA"] };

async function periodSales(ctx: Ctx, p: Period) {
  return prisma.sale.findMany({
    where: { ...saleScope(ctx), status: confirmed, saleDate: { gte: p.from, lte: p.to } },
    include: { client: { select: { name: true } }, seller: { select: { name: true } }, items: { select: { productType: true, priceCents: true } } },
    orderBy: { saleDate: "asc" },
  });
}

type Grouped = { key: string; label: string; values: Record<string, number> };

async function grouped(ctx: Ctx, key: string, p: Period): Promise<Grouped[]> {
  const m = new Map<string, Grouped>();
  const add = (k: string, label: string, vals: Record<string, number>) => {
    const g = m.get(k) ?? { key: k, label, values: {} };
    for (const [vk, v] of Object.entries(vals)) g.values[vk] = (g.values[vk] ?? 0) + v;
    m.set(k, g);
  };
  if (key === "despesas-categoria") {
    const pays = await prisma.payable.findMany({ where: { companyId: ctx.companyId, status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } } });
    for (const x of pays) add(x.category, PAYABLE_CATEGORIES.label(x.category), { amount: x.amountCents, paid: x.paidCents, open: x.amountCents - x.settledCents, count: 1 });
    return [...m.values()];
  }
  const sales = await periodSales(ctx, p);
  for (const s of sales) {
    if (key === "vendas-vendedor") add(s.sellerId, s.seller.name, { count: 1, gross: s.grossCents });
    if (key === "rentabilidade-vendedor")
      add(s.sellerId, s.seller.name, { count: 1, gross: s.grossCents, revenue: s.agencyRevenueCents, commission: s.sellerCommissionCents, profit: s.grossProfitCents });
    if (key === "vendas-destino") add((s.destination ?? "Não informado").trim().toLowerCase(), s.destination ?? "Não informado", { count: 1, gross: s.grossCents });
    if (key === "vendas-produto") for (const i of s.items) add(i.productType, PRODUCT_TYPES.label(i.productType), { count: 1, gross: i.priceCents });
  }
  return [...m.values()];
}

const GROUPED_COLUMNS: Record<string, Column[]> = {
  "vendas-vendedor": [
    { key: "label", label: "Vendedor", type: "text" },
    { key: "count", label: "Vendas", type: "int" },
    { key: "gross", label: "Faturamento", type: "money" },
    { key: "ticket", label: "Ticket médio", type: "money" },
  ],
  "vendas-produto": [
    { key: "label", label: "Produto", type: "text" },
    { key: "count", label: "Itens vendidos", type: "int" },
    { key: "gross", label: "Faturamento", type: "money" },
  ],
  "vendas-destino": [
    { key: "label", label: "Destino", type: "text" },
    { key: "count", label: "Vendas", type: "int" },
    { key: "gross", label: "Faturamento", type: "money" },
    { key: "ticket", label: "Ticket médio", type: "money" },
  ],
  "rentabilidade-vendedor": [
    { key: "label", label: "Vendedor", type: "text" },
    { key: "count", label: "Vendas", type: "int" },
    { key: "gross", label: "Faturamento", type: "money" },
    { key: "revenue", label: "Receita própria", type: "money" },
    { key: "commission", label: "Comissão", type: "money" },
    { key: "profit", label: "Lucro bruto", type: "money" },
    { key: "margin", label: "Margem", type: "percent" },
  ],
  "despesas-categoria": [
    { key: "label", label: "Categoria", type: "text" },
    { key: "count", label: "Lançamentos", type: "int" },
    { key: "amount", label: "Valor", type: "money" },
    { key: "paid", label: "Pago", type: "money" },
    { key: "open", label: "Em aberto", type: "money" },
  ],
};
const COMPARE_METRIC: Record<string, string> = {
  "vendas-vendedor": "gross",
  "vendas-produto": "gross",
  "vendas-destino": "gross",
  "rentabilidade-vendedor": "profit",
  "despesas-categoria": "amount",
};

function derive(v: Record<string, number>) {
  return {
    ...v,
    ticket: v.count ? Math.round((v.gross ?? 0) / v.count) : 0,
    margin: v.gross ? ratioBps(v.profit ?? 0, v.gross) : 0,
  };
}

export async function runReport(ctx: Ctx, key: string, p: Period, opts: { compare?: boolean } = {}): Promise<ReportResult> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw new AppError("Relatório não encontrado.", "NOT_FOUND");
  assertCan(ctx, def.permission);
  if (def.margin) assertCan(ctx, "sales.view_margin");
  const t = today(ctx);

  if (GROUPED_COLUMNS[key]) {
    const cur = await grouped(ctx, key, p);
    const columns = [...GROUPED_COLUMNS[key]];
    let prevMap = new Map<string, Grouped>();
    const metric = COMPARE_METRIC[key];
    if (opts.compare) {
      const prev = await grouped(ctx, key, previousPeriod(p));
      prevMap = new Map(prev.map((g) => [g.key, g]));
      for (const g of prev) if (!cur.some((c) => c.key === g.key)) cur.push({ key: g.key, label: g.label, values: {} });
      const metricLabel = columns.find((c) => c.key === metric)!.label;
      columns.push({ key: "prev", label: `${metricLabel} (período anterior)`, type: "money" }, { key: "delta", label: "Variação", type: "percent" });
    }
    const rows = cur
      .map((g) => {
        const v = derive(g.values);
        const row: Record<string, string | number | null> = { label: g.label, ...v };
        if (opts.compare) {
          const prev = prevMap.get(g.key)?.values[metric] ?? 0;
          row.prev = prev;
          row.delta = prev ? ratioBps((v[metric as keyof typeof v] as number) - prev, prev) : null;
        }
        return row;
      })
      .sort((a, b) => Number(b[metric] ?? 0) - Number(a[metric] ?? 0));
    const totals: Record<string, number | null> = {};
    for (const c of columns) if (c.type === "money" || c.type === "int") totals[c.key] = sum(rows.map((r) => Number(r[c.key] ?? 0)));
    if (columns.some((c) => c.key === "margin")) totals.margin = ratioBps(totals.profit ?? 0, totals.gross ?? 0);
    if (columns.some((c) => c.key === "ticket")) totals.ticket = totals.count ? Math.round((totals.gross ?? 0) / totals.count) : 0;
    if (opts.compare) totals.delta = totals.prev ? ratioBps((totals[metric] ?? 0) - (totals.prev ?? 0), totals.prev) : null;
    return { columns, rows, totals, note: opts.compare ? `Comparado com ${previousPeriod(p).from.split("-").reverse().join("/")} a ${previousPeriod(p).to.split("-").reverse().join("/")}.` : undefined };
  }

  switch (key) {
    case "vendas-periodo": {
      const sales = await periodSales(ctx, p);
      const margin = can(ctx, "sales.view_margin");
      const columns: Column[] = [
        { key: "code", label: "Código", type: "text" },
        { key: "date", label: "Data", type: "date" },
        { key: "client", label: "Cliente", type: "text" },
        { key: "seller", label: "Vendedor", type: "text" },
        { key: "product", label: "Produto", type: "text" },
        { key: "destination", label: "Destino", type: "text" },
        { key: "status", label: "Status", type: "text" },
        { key: "gross", label: "Faturamento", type: "money" },
        ...(margin ? [{ key: "profit", label: "Lucro bruto", type: "money" as const }] : []),
      ];
      const rows = sales.map((s) => ({
        code: s.code,
        date: s.saleDate,
        client: s.client.name,
        seller: s.seller.name,
        product: PRODUCT_TYPES.label(s.mainProductType),
        destination: s.destination ?? "",
        status: SALE_STATUS.label(s.status),
        gross: s.grossCents,
        ...(margin ? { profit: s.grossProfitCents } : {}),
      }));
      return { columns, rows, totals: { gross: sum(sales.map((s) => s.grossCents)), ...(margin ? { profit: sum(sales.map((s) => s.grossProfitCents)) } : {}) } };
    }
    case "rentabilidade-venda": {
      const sales = await periodSales(ctx, p);
      const columns: Column[] = [
        { key: "code", label: "Código", type: "text" },
        { key: "date", label: "Data", type: "date" },
        { key: "client", label: "Cliente", type: "text" },
        { key: "gross", label: "Faturamento", type: "money" },
        { key: "cost", label: "Custos/repasses", type: "money" },
        { key: "revenue", label: "Receita própria", type: "money" },
        { key: "commission", label: "Comissão vendedor", type: "money" },
        { key: "profit", label: "Lucro bruto", type: "money" },
        { key: "margin", label: "Margem", type: "percent" },
      ];
      const rows = sales.map((s) => ({
        code: s.code,
        date: s.saleDate,
        client: s.client.name,
        gross: s.grossCents,
        cost: s.costCents,
        revenue: s.agencyRevenueCents,
        commission: s.sellerCommissionCents,
        profit: s.grossProfitCents,
        margin: s.marginBps,
      }));
      const totals = {
        gross: sum(rows.map((r) => r.gross)),
        cost: sum(rows.map((r) => r.cost)),
        revenue: sum(rows.map((r) => r.revenue)),
        commission: sum(rows.map((r) => r.commission)),
        profit: sum(rows.map((r) => r.profit)),
      };
      return { columns, rows, totals: { ...totals, margin: ratioBps(totals.profit, totals.gross) } };
    }
    case "receita-margem": {
      const sales = await periodSales(ctx, p);
      const months = monthsBetween(p.from, p.to);
      const rows = months.map((m) => {
        const ss = sales.filter((s) => monthKey(s.saleDate) === m);
        const gross = sum(ss.map((s) => s.grossCents));
        const profit = sum(ss.map((s) => s.grossProfitCents));
        return {
          month: monthLabel(m),
          count: ss.length,
          gross,
          cost: sum(ss.map((s) => s.costCents)),
          revenue: sum(ss.map((s) => s.agencyRevenueCents)),
          commission: sum(ss.map((s) => s.sellerCommissionCents)),
          profit,
          margin: ratioBps(profit, gross),
        };
      });
      const totals = {
        count: sum(rows.map((r) => r.count)),
        gross: sum(rows.map((r) => r.gross)),
        cost: sum(rows.map((r) => r.cost)),
        revenue: sum(rows.map((r) => r.revenue)),
        commission: sum(rows.map((r) => r.commission)),
        profit: sum(rows.map((r) => r.profit)),
      };
      return {
        columns: [
          { key: "month", label: "Mês", type: "text" },
          { key: "count", label: "Vendas", type: "int" },
          { key: "gross", label: "Faturamento", type: "money" },
          { key: "cost", label: "Custos/repasses", type: "money" },
          { key: "revenue", label: "Receita própria", type: "money" },
          { key: "commission", label: "Comissões", type: "money" },
          { key: "profit", label: "Lucro bruto", type: "money" },
          { key: "margin", label: "Margem", type: "percent" },
        ],
        rows,
        totals: { ...totals, margin: ratioBps(totals.profit, totals.gross) },
        note: "Regime de competência: valores pela data da venda. Para movimentação de dinheiro, use o Fluxo de caixa.",
      };
    }
    case "contas-receber":
    case "contas-pagar": {
      const isRec = key === "contas-receber";
      const where = { companyId: ctx.companyId, status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } };
      const list = isRec
        ? await prisma.receivable.findMany({ where, include: { client: { select: { name: true } }, supplier: { select: { name: true } }, sale: { select: { code: true } } }, orderBy: { dueDate: "asc" } })
        : await prisma.payable.findMany({ where, include: { supplier: { select: { name: true } }, sale: { select: { code: true } } }, orderBy: { dueDate: "asc" } });
      const rows = list.map((e) => ({
        due: e.dueDate,
        description: e.description,
        party: ("client" in e && e.client?.name) || e.supplier?.name || "",
        sale: e.sale?.code ?? "",
        category: isRec ? RECEIVABLE_CATEGORIES.label(e.category) : PAYABLE_CATEGORIES.label(e.category),
        amount: e.amountCents,
        moved: "receivedCents" in e ? e.receivedCents : (e as { paidCents: number }).paidCents,
        balance: e.amountCents - e.settledCents,
        status: ENTRY_STATUS.label(displayStatus(e.status, e.dueDate, t)),
      }));
      return {
        columns: [
          { key: "due", label: "Vencimento", type: "date" },
          { key: "description", label: "Descrição", type: "text" },
          { key: "party", label: isRec ? "Cliente/Fornecedor" : "Fornecedor", type: "text" },
          { key: "sale", label: "Venda", type: "text" },
          { key: "category", label: "Categoria", type: "text" },
          { key: "amount", label: "Valor original", type: "money" },
          { key: "moved", label: isRec ? "Recebido" : "Pago", type: "money" },
          { key: "balance", label: "Saldo", type: "money" },
          { key: "status", label: "Status", type: "text" },
        ],
        rows,
        totals: { amount: sum(rows.map((r) => r.amount)), moved: sum(rows.map((r) => r.moved)), balance: sum(rows.map((r) => r.balance)) },
      };
    }
    case "fluxo-caixa": {
      const settlements = await prisma.settlement.findMany({ where: { companyId: ctx.companyId, reversedAt: null, account: { type: { not: "CARTAO_CREDITO" } }, date: { gte: p.from, lte: p.to } } });
      const rows = monthsBetween(p.from, p.to).map((m) => {
        const ss = settlements.filter((s) => monthKey(s.date) === m);
        const inn = sum(ss.filter((s) => s.kind === "RECEBIMENTO").map((s) => s.amountCents));
        const out = sum(ss.filter((s) => s.kind === "PAGAMENTO").map((s) => s.amountCents));
        return { month: monthLabel(m), in: inn, out, net: inn - out };
      });
      return {
        columns: [
          { key: "month", label: "Mês", type: "text" },
          { key: "in", label: "Entradas realizadas", type: "money" },
          { key: "out", label: "Saídas realizadas", type: "money" },
          { key: "net", label: "Resultado de caixa", type: "money" },
        ],
        rows,
        totals: { in: sum(rows.map((r) => r.in)), out: sum(rows.map((r) => r.out)), net: sum(rows.map((r) => r.net)) },
        note: "Transferências entre contas não são consideradas entradas ou saídas.",
      };
    }
    case "comissoes": {
      const list = await prisma.commission.findMany({
        where: { companyId: ctx.companyId, sale: { saleDate: { gte: p.from, lte: p.to } } },
        include: { seller: { select: { name: true } }, sale: { select: { code: true, saleDate: true, grossCents: true } }, payable: { select: { dueDate: true, paidCents: true } } },
        orderBy: { sale: { saleDate: "asc" } },
      });
      const rows = list.map((c) => ({
        seller: c.seller.name,
        sale: c.sale.code,
        date: c.sale.saleDate,
        gross: c.sale.grossCents,
        amount: c.amountCents,
        due: c.payable?.dueDate ?? "",
        paid: c.payable?.paidCents ?? 0,
        status: { PENDENTE: "Pendente", PAGA: "Paga", CANCELADA: "Cancelada" }[c.status] ?? c.status,
      }));
      return {
        columns: [
          { key: "seller", label: "Vendedor", type: "text" },
          { key: "sale", label: "Venda", type: "text" },
          { key: "date", label: "Data da venda", type: "date" },
          { key: "gross", label: "Valor da venda", type: "money" },
          { key: "amount", label: "Comissão", type: "money" },
          { key: "due", label: "Vencimento", type: "date" },
          { key: "paid", label: "Pago", type: "money" },
          { key: "status", label: "Status", type: "text" },
        ],
        rows,
        totals: { gross: sum(rows.map((r) => r.gross)), amount: sum(rows.filter((r) => r.status !== "Cancelada").map((r) => r.amount)), paid: sum(rows.map((r) => r.paid)) },
      };
    }
    case "resultado-fornecedor": {
      const suppliers = await prisma.supplier.findMany({ where: { companyId: ctx.companyId } });
      const [items, pays] = await Promise.all([
        prisma.saleItem.findMany({ where: { companyId: ctx.companyId, supplierId: { not: null }, sale: { status: confirmed, saleDate: { gte: p.from, lte: p.to } } } }),
        prisma.payable.findMany({ where: { companyId: ctx.companyId, supplierId: { not: null }, status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } } }),
      ]);
      const rows = suppliers
        .map((s) => {
          const it = items.filter((i) => i.supplierId === s.id);
          const ps = pays.filter((x) => x.supplierId === s.id);
          return {
            supplier: s.name,
            category: SUPPLIER_CATEGORIES.label(s.category),
            count: new Set(it.map((i) => i.saleId)).size,
            negotiated: sum(it.map((i) => i.priceCents)),
            cost: sum(it.map((i) => i.costCents)),
            commission: sum(it.map((i) => i.supplierCommissionCents)),
            paid: sum(ps.map((x) => x.paidCents)),
            open: sum(ps.map((x) => x.amountCents - x.settledCents)),
          };
        })
        .filter((r) => r.count || r.paid || r.open)
        .sort((a, b) => b.negotiated - a.negotiated);
      return {
        columns: [
          { key: "supplier", label: "Fornecedor", type: "text" },
          { key: "category", label: "Categoria", type: "text" },
          { key: "count", label: "Vendas", type: "int" },
          { key: "negotiated", label: "Valor negociado", type: "money" },
          { key: "cost", label: "Custos", type: "money" },
          { key: "commission", label: "Comissões recebíveis", type: "money" },
          { key: "paid", label: "Pago no período", type: "money" },
          { key: "open", label: "Pendente", type: "money" },
        ],
        rows,
        totals: Object.fromEntries(["count", "negotiated", "cost", "commission", "paid", "open"].map((k) => [k, sum(rows.map((r) => r[k as keyof typeof r] as number))])),
      };
    }
    case "dre": {
      const d = await computeDre(ctx.companyId, p);
      const rows = d.lines.map((l) => ({
        line: `${"   ".repeat(l.level)}${l.kind === "minus" ? "(−) " : l.kind === "plus" ? "(+) " : l.kind === "total" ? "(=) " : ""}${l.label}`,
        amount: l.kind === "minus" ? -l.amountCents : l.amountCents,
        share: d.netRevenue ? ratioBps(l.kind === "minus" ? -l.amountCents : l.amountCents, d.netRevenue) : null,
      }));
      return {
        columns: [
          { key: "line", label: "Conta", type: "text" },
          { key: "amount", label: "Valor", type: "money" },
          { key: "share", label: "% da receita líquida", type: "percent" },
        ],
        rows,
        note: "Vendas pela data da venda; despesas e outras receitas pela data de vencimento. Reembolsos são repasses e não entram no resultado. Custos e comissões gerados pelas vendas são considerados uma única vez.",
      };
    }
    case "contas-vencidas": {
      const [recs, pays] = await Promise.all([
        prisma.receivable.findMany({ where: { companyId: ctx.companyId, status: { in: ["PENDENTE", "PARCIAL"] }, dueDate: { lt: t } }, include: { client: { select: { name: true } }, supplier: { select: { name: true } }, sale: { select: { code: true } } } }),
        prisma.payable.findMany({ where: { companyId: ctx.companyId, status: { in: ["PENDENTE", "PARCIAL"] }, dueDate: { lt: t } }, include: { client: { select: { name: true } }, supplier: { select: { name: true } }, sale: { select: { code: true } } } }),
      ]);
      const days = (d: string) => Math.round((Date.parse(t) - Date.parse(d)) / 86400000);
      const rows = [
        ...recs.map((r) => ({ type: "A receber", due: r.dueDate, days: days(r.dueDate), description: r.description, party: r.client?.name ?? r.supplier?.name ?? "—", sale: r.sale?.code ?? "", balance: r.amountCents - r.settledCents })),
        ...pays.map((r) => ({ type: "A pagar", due: r.dueDate, days: days(r.dueDate), description: r.description, party: r.supplier?.name ?? r.client?.name ?? "—", sale: r.sale?.code ?? "", balance: r.amountCents - r.settledCents })),
      ].sort((a, b) => a.due.localeCompare(b.due));
      return {
        columns: [
          { key: "type", label: "Tipo", type: "text" },
          { key: "due", label: "Vencimento", type: "date" },
          { key: "days", label: "Dias em atraso", type: "int" },
          { key: "description", label: "Descrição", type: "text" },
          { key: "party", label: "Cliente/Fornecedor", type: "text" },
          { key: "sale", label: "Venda", type: "text" },
          { key: "balance", label: "Saldo", type: "money" },
        ],
        rows,
        totals: { balance: sum(rows.map((r) => r.balance)) },
        note: `Posição em ${t.split("-").reverse().join("/")}. A receber em atraso: ${formatBRL(sum(rows.filter((r) => r.type === "A receber").map((r) => r.balance)))} · A pagar em atraso: ${formatBRL(sum(rows.filter((r) => r.type === "A pagar").map((r) => r.balance)))}.`,
      };
    }
    case "centro-custo": {
      const [recs, pays, centers] = await Promise.all([
        prisma.receivable.findMany({ where: { companyId: ctx.companyId, status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } }, select: { costCenterId: true, amountCents: true, settledCents: true } }),
        prisma.payable.findMany({ where: { companyId: ctx.companyId, status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } }, select: { costCenterId: true, amountCents: true, settledCents: true } }),
        prisma.costCenter.findMany({ where: { companyId: ctx.companyId } }),
      ]);
      const label = new Map(centers.map((c) => [c.id, c.name]));
      const keys = [...new Set([...recs, ...pays].map((x) => x.costCenterId ?? ""))];
      const rows = keys
        .map((k) => {
          const r = recs.filter((x) => (x.costCenterId ?? "") === k);
          const pp = pays.filter((x) => (x.costCenterId ?? "") === k);
          const income = sum(r.map((x) => x.amountCents));
          const expense = sum(pp.map((x) => x.amountCents));
          return { center: k ? label.get(k) ?? "—" : "Sem centro de custo", income, expense, net: income - expense, open: sum(r.map((x) => x.amountCents - x.settledCents)) - sum(pp.map((x) => x.amountCents - x.settledCents)) };
        })
        .sort((a, b) => (a.center === "Sem centro de custo" ? 1 : b.center === "Sem centro de custo" ? -1 : b.expense - a.expense));
      return {
        columns: [
          { key: "center", label: "Centro de custo", type: "text" },
          { key: "income", label: "Receitas", type: "money" },
          { key: "expense", label: "Despesas", type: "money" },
          { key: "net", label: "Saldo", type: "money" },
          { key: "open", label: "Em aberto (líquido)", type: "money" },
        ],
        rows,
        totals: Object.fromEntries(["income", "expense", "net", "open"].map((k) => [k, sum(rows.map((r) => r[k as keyof typeof r] as number))])),
      };
    }
    case "reembolsos": {
      const where = { companyId: ctx.companyId, origin: "AJUSTE_VENDA", status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } };
      const inc = { sale: { select: { code: true, client: { select: { name: true } } } }, supplier: { select: { name: true } } };
      const [pays, recs] = await Promise.all([prisma.payable.findMany({ where, include: inc }), prisma.receivable.findMany({ where, include: inc })]);
      const rows = [...pays, ...recs]
        .map((x) => ({
          date: x.dueDate,
          sale: x.sale?.code ?? "",
          client: x.sale?.client.name ?? "",
          kind: REFUND_KINDS.label(x.category),
          supplier: x.supplier?.name ?? "",
          amount: x.amountCents,
          settled: x.settledCents,
          status: ENTRY_STATUS.label(displayStatus(x.status, x.dueDate, t)),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        columns: [
          { key: "date", label: "Vencimento", type: "date" },
          { key: "sale", label: "Venda", type: "text" },
          { key: "client", label: "Cliente", type: "text" },
          { key: "kind", label: "Tipo", type: "text" },
          { key: "supplier", label: "Fornecedor", type: "text" },
          { key: "amount", label: "Valor", type: "money" },
          { key: "settled", label: "Baixado", type: "money" },
          { key: "status", label: "Status", type: "text" },
        ],
        rows,
        totals: { amount: sum(rows.map((r) => r.amount)), settled: sum(rows.map((r) => r.settled)) },
      };
    }
    case "comissoes-intermediarios": {
      const sales = await prisma.sale.findMany({
        where: { companyId: ctx.companyId, status: confirmed, intermediaryCommissionCents: { gt: 0 }, saleDate: { gte: p.from, lte: p.to } },
        include: { intermediary: { select: { name: true } }, payables: { where: { origin: "COMISSAO_INTERMEDIARIO" }, select: { dueDate: true, paidCents: true, status: true } } },
        orderBy: { saleDate: "asc" },
      });
      const rows = sales.map((s) => ({
        intermediary: s.intermediary?.name ?? "—",
        sale: s.code,
        date: s.saleDate,
        gross: s.grossCents,
        amount: s.intermediaryCommissionCents,
        due: s.payables[0]?.dueDate ?? "",
        paid: s.payables[0]?.paidCents ?? 0,
      }));
      return {
        columns: [
          { key: "intermediary", label: "Intermediário", type: "text" },
          { key: "sale", label: "Venda", type: "text" },
          { key: "date", label: "Data da venda", type: "date" },
          { key: "gross", label: "Valor da venda", type: "money" },
          { key: "amount", label: "Comissão", type: "money" },
          { key: "due", label: "Vencimento", type: "date" },
          { key: "paid", label: "Pago", type: "money" },
        ],
        rows,
        totals: { gross: sum(rows.map((r) => r.gross)), amount: sum(rows.map((r) => r.amount)), paid: sum(rows.map((r) => r.paid)) },
      };
    }
    case "resultado-viagem": {
      const trips = await prisma.trip.findMany({
        where: { companyId: ctx.companyId, sales: { some: { ...saleScope(ctx), status: confirmed, saleDate: { gte: p.from, lte: p.to } } } },
        include: { client: { select: { name: true } }, sales: { where: { ...saleScope(ctx), status: confirmed } } },
      });
      const rows = trips.map((tr) => {
        const gross = sum(tr.sales.map((x) => x.grossCents));
        const profit = sum(tr.sales.map((x) => x.grossProfitCents));
        const dates = tr.sales.map((x) => x.tripStart).filter(Boolean).sort() as string[];
        return { code: tr.code, title: tr.title, client: tr.client.name, start: dates[0] ?? "", count: tr.sales.length, gross, revenue: sum(tr.sales.map((x) => x.agencyRevenueCents)), profit, margin: ratioBps(profit, gross) };
      });
      return {
        columns: [
          { key: "code", label: "Viagem", type: "text" },
          { key: "title", label: "Descrição", type: "text" },
          { key: "client", label: "Cliente", type: "text" },
          { key: "start", label: "Início", type: "date" },
          { key: "count", label: "Vendas", type: "int" },
          { key: "gross", label: "Faturamento", type: "money" },
          { key: "revenue", label: "Receita própria", type: "money" },
          { key: "profit", label: "Lucro bruto", type: "money" },
          { key: "margin", label: "Margem", type: "percent" },
        ],
        rows,
        totals: { count: sum(rows.map((r) => r.count)), gross: sum(rows.map((r) => r.gross)), revenue: sum(rows.map((r) => r.revenue)), profit: sum(rows.map((r) => r.profit)), margin: ratioBps(sum(rows.map((r) => r.profit)), sum(rows.map((r) => r.gross))) },
      };
    }
    case "resultado-excursao": {
      const excs = await prisma.excursion.findMany({
        where: { companyId: ctx.companyId, startDate: { gte: p.from, lte: p.to } },
        include: { sales: { where: { status: { not: "CANCELADA" } } }, payables: { where: { status: { not: "CANCELADO" } } } },
        orderBy: { startDate: "asc" },
      });
      const rows = excs.map((e) => {
        const gross = sum(e.sales.map((x) => x.grossCents));
        const costs = sum(e.payables.map((x) => x.amountCents));
        const result = sum(e.sales.map((x) => x.grossProfitCents)) - costs;
        const booked = sum(e.sales.map((x) => x.passengerCount));
        return { code: e.code, name: e.name, start: e.startDate, seats: e.seats, booked, occupancy: ratioBps(booked, e.seats), gross, costs, result, margin: ratioBps(result, gross) };
      });
      return {
        columns: [
          { key: "code", label: "Excursão", type: "text" },
          { key: "name", label: "Nome", type: "text" },
          { key: "start", label: "Saída", type: "date" },
          { key: "seats", label: "Vagas", type: "int" },
          { key: "booked", label: "Passageiros", type: "int" },
          { key: "occupancy", label: "Ocupação", type: "percent" },
          { key: "gross", label: "Vendido", type: "money" },
          { key: "costs", label: "Custos da operação", type: "money" },
          { key: "result", label: "Resultado", type: "money" },
          { key: "margin", label: "Margem", type: "percent" },
        ],
        rows,
        totals: { seats: sum(rows.map((r) => r.seats)), booked: sum(rows.map((r) => r.booked)), gross: sum(rows.map((r) => r.gross)), costs: sum(rows.map((r) => r.costs)), result: sum(rows.map((r) => r.result)) },
      };
    }
  }
  throw new AppError("Relatório não implementado.");
}
