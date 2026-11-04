/**
 * Regras financeiras de uma venda (funções puras, sem banco — cobertas por testes).
 *
 * Definições usadas em todo o sistema:
 * - Faturamento comercial (grossCents): total vendido ao cliente, independentemente de
 *   quem recebe o dinheiro = Σ valor dos itens + taxas − descontos.
 * - Valor cobrado pela agência (clientPayableCents): o que o cliente paga à agência
 *   (exclui itens no modelo COMISSAO, pagos diretamente ao fornecedor).
 * - Custos / repasses (costCents): valores devidos a fornecedores (INTERMEDIACAO e REVENDA).
 * - Receita própria da agência (agencyRevenueCents):
 *     INTERMEDIACAO → valor − custo (a agência só intermedeia; o repasse não é receita)
 *     REVENDA       → valor cheio (receita bruta; o custo é custo do produto vendido)
 *     COMISSAO      → comissão paga pelo fornecedor
 *   + taxas adicionais − descontos.
 * - Lucro bruto (grossProfitCents): resultado da venda após custos e comissão do vendedor
 *   = Σ(valor − custo) [INTERMEDIACAO/REVENDA] + Σ comissão do fornecedor [COMISSAO]
 *     + taxas − descontos − comissão do vendedor.
 * - Margem (marginBps): lucro bruto ÷ faturamento comercial.
 */

import { applyBps, ratioBps, sum } from "./money";
import type { CommercialModel } from "./constants";

export type SaleItemInput = {
  commercialModel: CommercialModel;
  priceCents: number;
  costCents: number;
  supplierCommissionCents: number;
};

export type SaleTotals = {
  grossCents: number;
  clientPayableCents: number;
  costCents: number;
  agencyRevenueCents: number;
  sellerCommissionCents: number;
  grossProfitCents: number;
  marginBps: number;
};

export type SellerCommissionRule =
  | { mode: "VALOR"; amountCents: number }
  | { mode: "PERCENTUAL"; bps: number }; // % sobre a receita da agência

export function itemRevenue(i: SaleItemInput): number {
  switch (i.commercialModel) {
    case "INTERMEDIACAO":
      return i.priceCents - i.costCents;
    case "REVENDA":
      return i.priceCents;
    case "COMISSAO":
      return i.supplierCommissionCents;
  }
}

export function itemMargin(i: SaleItemInput): number {
  return i.commercialModel === "COMISSAO" ? i.supplierCommissionCents : i.priceCents - i.costCents;
}

export function calculateSale(
  items: SaleItemInput[],
  feesCents: number,
  discountCents: number,
  commission: SellerCommissionRule,
): SaleTotals {
  const grossCents = sum(items.map((i) => i.priceCents)) + feesCents - discountCents;
  const clientPayableCents =
    sum(items.filter((i) => i.commercialModel !== "COMISSAO").map((i) => i.priceCents)) + feesCents - discountCents;
  const costCents = sum(items.filter((i) => i.commercialModel !== "COMISSAO").map((i) => i.costCents));
  const agencyRevenueCents = sum(items.map(itemRevenue)) + feesCents - discountCents;
  const marginBeforeCommission = sum(items.map(itemMargin)) + feesCents - discountCents;
  const sellerCommissionCents =
    commission.mode === "VALOR"
      ? commission.amountCents
      : Math.max(0, applyBps(marginBeforeCommission, commission.bps));
  const grossProfitCents = marginBeforeCommission - sellerCommissionCents;
  return {
    grossCents,
    clientPayableCents,
    costCents,
    agencyRevenueCents,
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
  });
  if (feesCents < 0 || discountCents < 0) issues.push({ field: "fees", message: "Taxas e descontos não podem ser negativos." });
  if (totals.clientPayableCents < 0) issues.push({ field: "discountCents", message: "O desconto é maior que o valor cobrado." });
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
