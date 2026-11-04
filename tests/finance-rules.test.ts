import { describe, expect, it } from "vitest";
import { calculateSale, entryStatus, displayStatus, settlementPrincipal, validateSaleFinancials } from "@/lib/finance";
import { parseBRL, splitInstallments, centsToInput, applyBps } from "@/lib/money";
import { addMonths, previousPeriod, resolvePeriod } from "@/lib/dates";
import { resolvePermissions } from "@/lib/permissions";
import { isValidCPF, isValidCNPJ } from "@/lib/utils";

describe("cálculo financeiro da venda", () => {
  it("cenário obrigatório: pacote R$ 8.000, custo R$ 6.500, comissão R$ 200 (intermediação)", () => {
    const t = calculateSale(
      [{ commercialModel: "INTERMEDIACAO", priceCents: 800000, costCents: 650000, supplierCommissionCents: 0 }],
      0,
      0,
      { mode: "VALOR", amountCents: 20000 },
    );
    expect(t.grossCents).toBe(800000); // faturamento
    expect(t.clientPayableCents).toBe(800000); // cliente paga à agência
    expect(t.costCents).toBe(650000); // repasse ao fornecedor
    expect(t.agencyRevenueCents).toBe(150000); // receita própria (não os 8.000)
    expect(t.sellerCommissionCents).toBe(20000);
    expect(t.grossProfitCents).toBe(130000);
    expect(t.marginBps).toBe(1625); // 16,25%
  });

  it("revenda: receita bruta é o valor cheio, lucro igual à intermediação", () => {
    const t = calculateSale([{ commercialModel: "REVENDA", priceCents: 800000, costCents: 650000, supplierCommissionCents: 0 }], 0, 0, {
      mode: "VALOR",
      amountCents: 20000,
    });
    expect(t.agencyRevenueCents).toBe(800000);
    expect(t.grossProfitCents).toBe(130000);
  });

  it("comissão: cliente paga direto ao fornecedor; agência só recebe a comissão", () => {
    const t = calculateSale([{ commercialModel: "COMISSAO", priceCents: 500000, costCents: 0, supplierCommissionCents: 50000 }], 0, 0, {
      mode: "VALOR",
      amountCents: 10000,
    });
    expect(t.grossCents).toBe(500000);
    expect(t.clientPayableCents).toBe(0);
    expect(t.costCents).toBe(0);
    expect(t.agencyRevenueCents).toBe(50000);
    expect(t.grossProfitCents).toBe(40000);
  });

  it("venda mista com taxas, desconto e comissão percentual sobre a margem", () => {
    const t = calculateSale(
      [
        { commercialModel: "INTERMEDIACAO", priceCents: 300000, costCents: 250000, supplierCommissionCents: 0 },
        { commercialModel: "COMISSAO", priceCents: 100000, costCents: 0, supplierCommissionCents: 12000 },
      ],
      5000,
      2000,
      { mode: "PERCENTUAL", bps: 1000 },
    );
    // margem antes da comissão = 50.000 + 12.000 + 5.000 - 2.000 = 65.000
    expect(t.sellerCommissionCents).toBe(6500);
    expect(t.grossProfitCents).toBe(58500);
    expect(t.clientPayableCents).toBe(303000);
    expect(t.grossCents).toBe(403000);
  });

  it("valida soma das parcelas e custo maior que o preço", () => {
    const items = [{ commercialModel: "INTERMEDIACAO" as const, priceCents: 1000, costCents: 2000, supplierCommissionCents: 0 }];
    const t = calculateSale(items, 0, 0, { mode: "VALOR", amountCents: 0 });
    const issues = validateSaleFinancials(items, 0, 0, t, 500);
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(["items.0.costCents", "payments"]));
  });
});

describe("parcelamento e dinheiro", () => {
  it("divide sem perder centavos", () => {
    expect(splitInstallments(800000, 4)).toEqual([200000, 200000, 200000, 200000]);
    const p = splitInstallments(100000, 3);
    expect(p.reduce((a, b) => a + b)).toBe(100000);
    expect(p).toEqual([33334, 33333, 33333]);
  });
  it("interpreta valores digitados em pt-BR", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 8.000")).toBe(800000);
    expect(parseBRL("8000")).toBe(800000);
    expect(parseBRL("10,5")).toBe(1050);
    expect(parseBRL("abc")).toBeNull();
    expect(centsToInput(123456)).toBe("1234,56");
    expect(applyBps(10000, 250)).toBe(250);
  });
  it("status e baixa com juros/desconto", () => {
    expect(entryStatus(1000, 0, false)).toBe("PENDENTE");
    expect(entryStatus(1000, 500, false)).toBe("PARCIAL");
    expect(entryStatus(1000, 1000, false)).toBe("PAGO");
    expect(entryStatus(1000, 0, true)).toBe("CANCELADO");
    expect(displayStatus("PENDENTE", "2026-01-01", "2026-02-01")).toBe("VENCIDO");
    expect(displayStatus("PAGO", "2026-01-01", "2026-02-01")).toBe("PAGO");
    // recebeu 1.050 com 50 de juros => abate 1.000
    expect(settlementPrincipal(105000, 5000, 0)).toBe(100000);
    // recebeu 950 com 50 de desconto => abate 1.000
    expect(settlementPrincipal(95000, 0, 5000)).toBe(100000);
  });
});

describe("datas", () => {
  it("soma meses respeitando fim de mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("período anterior de mês cheio", () => {
    const p = resolvePeriod("mes", "2026-11-04");
    expect(p).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(previousPeriod(p)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});

describe("permissões e documentos", () => {
  it("vendedor não vê margem nem financeiro por padrão; override configurável", () => {
    const v = resolvePermissions("VENDEDOR");
    expect(v.has("sales.view_margin")).toBe(false);
    expect(v.has("finance.view")).toBe(false);
    const v2 = resolvePermissions("VENDEDOR", [{ permission: "sales.view_margin", allowed: true }, { permission: "settings.manage", allowed: true }]);
    expect(v2.has("sales.view_margin")).toBe(true);
    expect(v2.has("settings.manage")).toBe(false); // não configurável
    const g = resolvePermissions("GESTOR", [{ permission: "finance.view", allowed: false }]);
    expect(g.has("finance.view")).toBe(false);
  });
  it("valida CPF e CNPJ", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
    expect(isValidCPF("111.111.111-11")).toBe(false);
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
  });
});
