/**
 * DRE gerencial (regime de competência) de uma agência de viagens.
 *
 * - Receitas e custos das vendas: vendas confirmadas/concluídas pela DATA DA VENDA.
 *   Vendas canceladas não entram (o que foi retido aparece como multa cobrada do cliente).
 * - Despesas e outras receitas: lançamentos não cancelados pela data de VENCIMENTO
 *   (o sistema não tem data de competência separada; ver MONDE_GAP_ANALYSIS.md).
 * - Repasses (reembolsos a clientes / de fornecedores) movimentam caixa, mas não entram no resultado.
 * - Lançamentos gerados pelas vendas (custos, comissões) não são somados de novo: o resultado da
 *   venda já os considera. Isso evita a dupla contagem.
 */
import { prisma } from "../db";
import type { Period } from "@/lib/dates";
import { sum, ratioBps } from "@/lib/money";
import { PASS_THROUGH_CATEGORIES, PAYABLE_CATEGORIES } from "@/lib/constants";

export type DreLine = { key: string; label: string; amountCents: number; level: 0 | 1 | 2; kind: "total" | "plus" | "minus" | "info" };

/** Origens de contas a pagar que já estão refletidas no resultado das vendas. */
const SALE_DRIVEN_PAYABLES = new Set(["CUSTO_VENDA", "COMISSAO_VENDEDOR", "COMISSAO_INTERMEDIARIO"]);
/** Origens de contas a receber que já estão refletidas no resultado das vendas. */
const SALE_DRIVEN_RECEIVABLES = new Set(["VENDA", "COMISSAO_FORNECEDOR"]);

export async function computeDre(companyId: string, p: Period) {
  const [sales, payables, receivables] = await Promise.all([
    prisma.sale.findMany({
      where: { companyId, status: { in: ["CONFIRMADA", "CONCLUIDA"] }, saleDate: { gte: p.from, lte: p.to } },
      include: { items: true },
    }),
    prisma.payable.findMany({ where: { companyId, status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } } }),
    prisma.receivable.findMany({ where: { companyId, status: { not: "CANCELADO" }, dueDate: { gte: p.from, lte: p.to } } }),
  ]);
  const items = sales.flatMap((s) => s.items);
  const by = (m: string) => items.filter((i) => i.commercialModel === m);

  const intermediation = sum(by("INTERMEDIACAO").map((i) => i.priceCents - i.costCents));
  const resale = sum(by("REVENDA").map((i) => i.priceCents));
  const supplierCommission = sum(by("COMISSAO").map((i) => i.supplierCommissionCents));
  const over = sum(items.map((i) => i.overCents));
  const ravDu = sum(items.map((i) => i.ravCents + i.duCents));
  const serviceFees = sum(sales.map((s) => s.feesCents));
  const grossRevenue = intermediation + resale + supplierCommission + over + ravDu + serviceFees;
  const discounts = sum(sales.map((s) => s.discountCents));
  const cardFees = sum(items.map((i) => i.cardFeeCents));
  const netRevenue = grossRevenue - discounts - cardFees;
  const cogs = sum(by("REVENDA").map((i) => i.costCents));
  const sellerComm = sum(sales.map((s) => s.sellerCommissionCents));
  const interComm = sum(sales.map((s) => s.intermediaryCommissionCents));
  const salesProfit = netRevenue - cogs - sellerComm - interComm;

  const expenses = payables.filter((x) => !SALE_DRIVEN_PAYABLES.has(x.origin) && !PASS_THROUGH_CATEGORIES.has(x.category));
  const excursionCosts = sum(expenses.filter((x) => x.category === "OPERACAO_PROPRIA").map((x) => x.amountCents));
  const fines = sum(expenses.filter((x) => x.category === "MULTA_FORNECEDOR").map((x) => x.amountCents));
  const opex = expenses.filter((x) => x.category !== "OPERACAO_PROPRIA" && x.category !== "MULTA_FORNECEDOR");
  const opexByCat = new Map<string, number>();
  for (const x of opex) opexByCat.set(x.category, (opexByCat.get(x.category) ?? 0) + x.amountCents);
  const opexTotal = sum([...opexByCat.values()]);

  const otherRec = receivables.filter((r) => !SALE_DRIVEN_RECEIVABLES.has(r.origin) && !PASS_THROUGH_CATEGORIES.has(r.category));
  const clientFines = sum(otherRec.filter((r) => r.category === "MULTA_CLIENTE").map((r) => r.amountCents));
  const otherIncome = sum(otherRec.filter((r) => r.category !== "MULTA_CLIENTE").map((r) => r.amountCents));

  const result = salesProfit - excursionCosts - opexTotal - fines + clientFines + otherIncome;

  const lines: DreLine[] = [
    { key: "faturamento", label: "Faturamento comercial (total vendido, informativo)", amountCents: sum(sales.map((s) => s.grossCents)), level: 0, kind: "info" },
    { key: "intermediacao", label: "Margem de intermediação", amountCents: intermediation, level: 1, kind: "plus" },
    { key: "revenda", label: "Vendas de revenda e operação própria", amountCents: resale, level: 1, kind: "plus" },
    { key: "comissao_fornecedor", label: "Comissões de fornecedores", amountCents: supplierCommission, level: 1, kind: "plus" },
    { key: "over", label: "Incentivos (over)", amountCents: over, level: 1, kind: "plus" },
    { key: "rav_du", label: "Taxas RAV e DU", amountCents: ravDu, level: 1, kind: "plus" },
    { key: "taxa_servico", label: "Taxas de serviço", amountCents: serviceFees, level: 1, kind: "plus" },
    { key: "receita_bruta", label: "Receita operacional bruta", amountCents: grossRevenue, level: 0, kind: "total" },
    { key: "descontos", label: "Descontos concedidos", amountCents: discounts, level: 1, kind: "minus" },
    { key: "taxa_cc", label: "Taxas CC retidas por fornecedores", amountCents: cardFees, level: 1, kind: "minus" },
    { key: "receita_liquida", label: "Receita líquida da agência", amountCents: netRevenue, level: 0, kind: "total" },
    { key: "cpv", label: "Custo dos produtos revendidos", amountCents: cogs, level: 1, kind: "minus" },
    { key: "comissao_vendedor", label: "Comissões de vendedores", amountCents: sellerComm, level: 1, kind: "minus" },
    { key: "comissao_intermediario", label: "Comissões de intermediários", amountCents: interComm, level: 1, kind: "minus" },
    { key: "lucro_vendas", label: "Lucro bruto das vendas", amountCents: salesProfit, level: 0, kind: "total" },
    { key: "excursoes", label: "Custos de excursões (operação própria)", amountCents: excursionCosts, level: 1, kind: "minus" },
    ...[...opexByCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, v]) => ({ key: `desp_${cat}`, label: PAYABLE_CATEGORIES.label(cat), amountCents: v, level: 2 as const, kind: "minus" as const })),
    { key: "despesas", label: "Despesas operacionais", amountCents: opexTotal, level: 1, kind: "minus" },
    { key: "multas_fornecedor", label: "Multas pagas a fornecedores", amountCents: fines, level: 1, kind: "minus" },
    { key: "multas_cliente", label: "Multas cobradas de clientes", amountCents: clientFines, level: 1, kind: "plus" },
    { key: "outras_receitas", label: "Outras receitas", amountCents: otherIncome, level: 1, kind: "plus" },
    { key: "resultado", label: "Resultado operacional", amountCents: result, level: 0, kind: "total" },
  ];
  return { lines, netRevenue, salesProfit, result, marginBps: ratioBps(result, netRevenue) };
}
