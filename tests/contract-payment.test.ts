import { describe, expect, it } from "vitest";
import { paymentText, renderTemplate } from "@/server/services/contracts";

const aereo = { productType: "AEREO", description: "GRU-LIS", priceCents: 1255247, supplierPayment: "CLIENTE_DIRETO", supplier: { name: "Azul" } };
const hotel = { productType: "HOSPEDAGEM", description: null, priceCents: 300000, supplierPayment: "FATURADO", supplier: null };
const plan = JSON.stringify([{ dueDate: "2026-08-13", amountCents: 300000, method: "PIX" }]);

describe("condições de pagamento no contrato", () => {
  it("cliente paga direto ao fornecedor: o contrato não fica em branco", () => {
    const t = paymentText("[]", [aereo]);
    expect(t).toContain("diretamente ao fornecedor");
    expect(t).toContain("Azul");
    expect(t).toContain("12.552,47");
  });
  it("só parcelas da agência: igual a antes", () => {
    expect(paymentText(plan, [hotel])).toMatch(/^1\) R\$\s?3\.000,00 em 13\/08\/2026 via /);
  });
  it("misto: parcelas da agência e o que vai direto ao fornecedor", () => {
    const t = paymentText(plan, [aereo, hotel]);
    expect(t).toContain("Pago à agência:");
    expect(t).toContain("Pago pelo cliente diretamente ao fornecedor");
  });
  it("forma e parcelas que o cliente paga ao fornecedor vão para o contrato", () => {
    expect(paymentText("[]", [{ ...aereo, clientPayMethod: "CARTAO_CREDITO", clientPayInstallments: 10 }])).toMatch(/via Cartão de crédito em 10x$/);
    expect(paymentText("[]", [{ ...aereo, clientPayMethod: "PIX", clientPayInstallments: 1 }])).toMatch(/via PIX à vista$/);
  });
  it("a linha [MODELO SUGERIDO] dos modelos antigos não aparece no contrato", () => {
    const body = "CONTRATO\n[MODELO SUGERIDO: submeta à revisão jurídica da agência antes do uso e apague esta linha]\n\nCONTRATADA: {{agencia.nome}}";
    const r = renderTemplate(body, "", { "agencia.nome": "Azul" });
    expect(r.content).toBe("CONTRATO\n\nCONTRATADA: Azul");
  });
  it("sem parcelas e sem item direto: continua faltando", () => {
    expect(paymentText("[]", [hotel])).toBe("");
  });
});
