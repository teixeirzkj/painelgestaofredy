/**
 * Regras financeiras de uma venda turística (funções puras, sem banco — cobertas por testes).
 *
 * Valores por produto (todos em centavos):
 *   price   valor da tarifa/produto vendido ao cliente
 *   rav/du  taxas RAV e DU cobradas do cliente — receita da agência
 *   cost    custo/repasse ao fornecedor (INTERMEDIACAO e REVENDA)
 *   supplierCommission  comissão paga pelo fornecedor (modelo COMISSAO)
 *   over    incentivo pago pelo fornecedor — receita da agência
 *   cardFee taxa CC RAV/DU: quando o cliente paga direto ao fornecedor no cartão, o fornecedor
 *           retém essa taxa do repasse à agência (só no modelo COMISSAO e nunca maior que RAV+DU)
 *
 * Definições usadas em todo o sistema:
 * - Faturamento comercial (grossCents) = Σ(price + rav + du) + taxas de serviço − descontos
 *   (total vendido, independentemente de quem recebe o dinheiro).
 * - Valor cobrado pela agência (clientPayableCents): parte paga à agência (exclui itens COMISSAO,
 *   pagos diretamente ao fornecedor).
 * - Custos / repasses (costCents): devidos a fornecedores (INTERMEDIACAO e REVENDA).
 * - Receita própria da agência (agencyRevenueCents), por produto:
 *     INTERMEDIACAO → price − cost + rav + du + over   (o repasse não é receita)
 *     REVENDA       → price + rav + du + over          (receita bruta; cost = custo do produto vendido)
 *     COMISSAO      → comissão + over + rav + du − cardFee
 *   + taxas de serviço − descontos.
 * - Lucro bruto = Σ margem dos produtos + taxas de serviço − descontos
 *                 − comissão do intermediário − comissão do vendedor
 *   (margem do produto = receita do produto, exceto em REVENDA, onde se desconta o custo).
 * - Margem (marginBps) = lucro bruto ÷ faturamento comercial.
 * - Comissão percentual do vendedor incide sobre o lucro antes da comissão do vendedor.
 */

import { applyBps, ratioBps, sum } from "./money";
import type { CommercialModel } from "./constants";

export type SaleItemInput = {
  commercialModel: CommercialModel;
  priceCents: number;
  costCents: number;
  supplierCommissionCents: number;
  ravCents?: number;
  duCents?: number;
  overCents?: number;
  cardFeeCents?: number;
};

export type SaleTotals = {
  grossCents: number;
  clientPayableCents: number;
  costCents: number;
  agencyRevenueCents: number;
  intermediaryCommissionCents: number;
  sellerCommissionCents: number;
  grossProfitCents: number;
  marginBps: number;
};

export type SellerCommissionRule =
  | { mode: "VALOR"; amountCents: number }
  | { mode: "PERCENTUAL"; bps: number }; // % sobre o lucro antes da comissão do vendedor

const v = (n: number | undefined) => n ?? 0;

/** Valor cobrado do cliente pelo produto (tarifa + taxas RAV/DU). */
export function itemCharge(i: SaleItemInput): number {
  return i.priceCents + v(i.ravCents) + v(i.duCents);
}

/** Taxas e incentivos que são receita da agência em qualquer modelo. */
function itemFees(i: SaleItemInput): number {
  return v(i.ravCents) + v(i.duCents) + v(i.overCents);
}

export function itemRevenue(i: SaleItemInput): number {
  switch (i.commercialModel) {
    case "INTERMEDIACAO":
      return i.priceCents - i.costCents + itemFees(i);
    case "REVENDA":
      return i.priceCents + itemFees(i);
    case "COMISSAO":
      return i.supplierCommissionCents + itemFees(i) - v(i.cardFeeCents);
  }
}

export function itemMargin(i: SaleItemInput): number {
  return i.commercialModel === "REVENDA" ? itemRevenue(i) - i.costCents : itemRevenue(i);
}

/** Valor que o fornecedor deve repassar à agência no modelo COMISSAO (comissão + over + RAV/DU − taxa CC). */
export function supplierRemittance(i: SaleItemInput): number {
  if (i.commercialModel !== "COMISSAO") return v(i.overCents);
  return i.supplierCommissionCents + itemFees(i) - v(i.cardFeeCents);
}

export function calculateSale(
  items: SaleItemInput[],
  feesCents: number,
  discountCents: number,
  commission: SellerCommissionRule,
  intermediaryCommissionCents = 0,
): SaleTotals {
  const grossCents = sum(items.map(itemCharge)) + feesCents - discountCents;
  const clientPayableCents = sum(items.filter((i) => i.commercialModel !== "COMISSAO").map(itemCharge)) + feesCents - discountCents;
  const costCents = sum(items.filter((i) => i.commercialModel !== "COMISSAO").map((i) => i.costCents));
  const agencyRevenueCents = sum(items.map(itemRevenue)) + feesCents - discountCents;
  const marginBeforeCommission = sum(items.map(itemMargin)) + feesCents - discountCents - intermediaryCommissionCents;
  const sellerCommissionCents =
    commission.mode === "VALOR" ? commission.amountCents : Math.max(0, applyBps(marginBeforeCommission, commission.bps));
  const grossProfitCents = marginBeforeCommission - sellerCommissionCents;
  return {
    grossCents,
    clientPayableCents,
    costCents,
    agencyRevenueCents,
    intermediaryCommissionCents,
    sellerCommissionCents,
    grossProfitCents,
    marginBps: ratioBps(grossProfitCents, grossCents),
  };
}

export type SaleValidationIssue = { field: string; message: string };

export function validateSaleFinancials(
  items: SaleItemInput[],
  feesCents: number,
  discountCents: number,
  totals: SaleTotals,
  planTotalCents: number,
): SaleValidationIssue[] {
  const issues: SaleValidationIssue[] = [];
  if (items.length === 0) issues.push({ field: "items", message: "Inclua ao menos um produto." });
  items.forEach((i, idx) => {
    if (i.priceCents <= 0) issues.push({ field: `items.${idx}.priceCents`, message: `Produto ${idx + 1}: informe o valor vendido.` });
    if (i.costCents < 0 || i.supplierCommissionCents < 0)
      issues.push({ field: `items.${idx}`, message: `Produto ${idx + 1}: valores não podem ser negativos.` });
    if (i.commercialModel !== "COMISSAO" && i.costCents > i.priceCents && i.commercialModel === "INTERMEDIACAO")
      issues.push({ field: `items.${idx}.costCents`, message: `Produto ${idx + 1}: custo maior que o valor vendido.` });
    if (i.commercialModel === "COMISSAO" && i.supplierCommissionCents > i.priceCents)
      issues.push({ field: `items.${idx}.supplierCommissionCents`, message: `Produto ${idx + 1}: comissão maior que o valor vendido.` });
    if ([i.ravCents, i.duCents, i.overCents, i.cardFeeCents].some((x) => v(x) < 0))
      issues.push({ field: `items.${idx}`, message: `Produto ${idx + 1}: taxas não podem ser negativas.` });
    if (v(i.cardFeeCents) > 0 && i.commercialModel !== "COMISSAO")
      issues.push({ field: `items.${idx}.cardFeeCents`, message: `Produto ${idx + 1}: a taxa CC só se aplica quando o cliente paga direto ao fornecedor (modelo Comissão).` });
    if (v(i.cardFeeCents) > v(i.ravCents) + v(i.duCents))
      issues.push({ field: `items.${idx}.cardFeeCents`, message: `Produto ${idx + 1}: a taxa CC não pode ser maior que as taxas RAV + DU.` });
  });
  if (feesCents < 0 || discountCents < 0) issues.push({ field: "fees", message: "Taxas e descontos não podem ser negativos." });
  if (totals.clientPayableCents < 0) issues.push({ field: "discountCents", message: "O desconto é maior que o valor cobrado." });
  if (totals.intermediaryCommissionCents < 0) issues.push({ field: "intermediary", message: "Comissão do intermediário inválida." });
  if (totals.sellerCommissionCents < 0) issues.push({ field: "commission", message: "Comissão do vendedor inválida." });
  if (planTotalCents !== totals.clientPayableCents)
    issues.push({
      field: "payments",
      message: `A soma das parcelas (${(planTotalCents / 100).toFixed(2)}) difere do valor a receber do cliente (${(totals.clientPayableCents / 100).toFixed(2)}).`,
    });
  return issues;
}

/** Status armazenado de um lançamento a partir do saldo. */
export function entryStatus(amountCents: number, settledCents: number, cancelled: boolean): "PENDENTE" | "PARCIAL" | "PAGO" | "CANCELADO" {
  if (cancelled) return "CANCELADO";
  if (settledCents <= 0) return "PENDENTE";
  if (settledCents >= amountCents) return "PAGO";
  return "PARCIAL";
}

/** Status exibido (VENCIDO é derivado da data). */
export function displayStatus(status: string, dueDate: string, today: string): string {
  if ((status === "PENDENTE" || status === "PARCIAL") && dueDate < today) return "VENCIDO";
  return status;
}

/**
 * Efeito de uma baixa sobre o saldo:
 *   valor movimentado (amount) = principal + juros − desconto  ⇒  principal abatido = amount − juros + desconto
 */
export function settlementPrincipal(amountCents: number, interestCents: number, discountCents: number): number {
  return amountCents - interestCents + discountCents;
}
