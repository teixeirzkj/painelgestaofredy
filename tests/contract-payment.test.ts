import { describe, expect, it } from "vitest";
import { paymentText } from "@/server/services/contracts";

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
  it("sem parcelas e sem item direto: continua faltando", () => {
    expect(paymentText("[]", [hotel])).toBe("");
  });
});
