import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createSale } from "@/server/services/sales";
import { createManualPayable, settleEntry } from "@/server/services/finance";
import { addPayablesToInvoice, createInvoice } from "@/server/services/invoices";
import { pickCardFee } from "@/server/services/admin";
import { PAYMENT_METHODS } from "@/lib/constants";
import { makeCompany, exampleSale } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

async function payable(env: Env, description: string, amountCents: number, extra: Record<string, unknown> = {}) {
  const ids = await createManualPayable(env.fin, { description, category: "FORNECEDORES", amountCents, firstDueDate: "2026-11-10", ...extra });
  return ids;
}
const get = (id: string) => prisma.payable.findUniqueOrThrow({ where: { id } });

describe("contas a pagar: baixa parcial e valor do mês", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeCompany("Pagar parcial");
  });

  it("paga em duas vezes: 1.500 hoje e 500 depois", async () => {
    const [id] = await payable(env, "Salário Marcos", 200000);
    await settleEntry(env.fin, "payable", id, { date: "2026-11-10", amountCents: 150000, accountId: env.account.id });
    let p = await get(id);
    expect(p.status).toBe("PARCIAL");
    expect(p.paidCents).toBe(150000);
    expect(p.amountCents - p.settledCents).toBe(50000);

    // acima do saldo continua bloqueado
    await expect(settleEntry(env.fin, "payable", id, { date: "2026-11-11", amountCents: 60000, accountId: env.account.id })).rejects.toThrow(/maior que o saldo/);

    await settleEntry(env.fin, "payable", id, { date: "2026-11-12", amountCents: 50000, accountId: env.account.id });
    p = await get(id);
    expect(p.status).toBe("PAGO");
    expect(await prisma.settlement.count({ where: { payableId: id, reversedAt: null } })).toBe(2);
  });

  it("muda o valor da conta deste mês na própria baixa (só este mês)", async () => {
    const ids = await payable(env, "VT", 30000, { recurringMonths: 3 });
    await settleEntry(env.fin, "payable", ids[0], { date: "2026-11-10", amountCents: 34500, newTotalCents: 34500, accountId: env.account.id });
    const p = await get(ids[0]);
    expect(p.amountCents).toBe(34500);
    expect(p.status).toBe("PAGO");
    expect((await get(ids[1])).amountCents).toBe(30000);
    expect((await get(ids[2])).amountCents).toBe(30000);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { companyId: env.company.id, action: "pagar.valor_ajustado", entityId: ids[0] } });
    expect(JSON.parse(String(log.dataJson))).toMatchObject({ antes: 30000, depois: 34500 });
  });

  it("valor do mês menor e pagamento parcial", async () => {
    const [id] = await payable(env, "Comissão de outubro", 30000);
    await settleEntry(env.fin, "payable", id, { date: "2026-11-10", amountCents: 10000, newTotalCents: 25000, accountId: env.account.id });
    const p = await get(id);
    expect(p.amountCents).toBe(25000);
    expect(p.status).toBe("PARCIAL");
    expect(p.amountCents - p.settledCents).toBe(15000);
  });

  it("não deixa o valor do mês ficar menor que o já pago", async () => {
    const [id] = await payable(env, "Energia", 30000);
    await settleEntry(env.fin, "payable", id, { date: "2026-11-10", amountCents: 20000, accountId: env.account.id });
    await expect(settleEntry(env.fin, "payable", id, { date: "2026-11-11", amountCents: 1000, newTotalCents: 15000, accountId: env.account.id })).rejects.toThrow(/menor que o já pago/);
    const p = await get(id);
    expect(p.amountCents).toBe(30000);
    expect(p.settledCents).toBe(20000);
  });

  it("se a baixa falhar, o ajuste do valor também é desfeito", async () => {
    const [id] = await payable(env, "Internet", 30000);
    await expect(settleEntry(env.fin, "payable", id, { date: "2026-11-10", amountCents: 25000, newTotalCents: 20000, accountId: env.account.id })).rejects.toThrow(/maior que o saldo/);
    const p = await get(id);
    expect(p.amountCents).toBe(30000);
    expect(p.settledCents).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "pagar.valor_ajustado", entityId: id } })).toBe(0);
  });

  it("conta gerada pela venda não muda de valor na baixa, mas aceita pagamento parcial", async () => {
    const sale = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id));
    const comm = await prisma.payable.findFirstOrThrow({ where: { sourceKey: `comissao:${sale.id}` } });
    await expect(settleEntry(env.fin, "payable", comm.id, { date: "2026-11-10", amountCents: 5000, newTotalCents: comm.amountCents + 1000, accountId: env.account.id })).rejects.toThrow(/gerado por uma venda/);
    await settleEntry(env.fin, "payable", comm.id, { date: "2026-11-10", amountCents: 5000, accountId: env.account.id });
    const after = await get(comm.id);
    expect(after.status).toBe("PARCIAL");
    if (after.commissionId) expect((await prisma.commission.findUniqueOrThrow({ where: { id: after.commissionId } })).status).not.toBe("PAGA");
  });

  it("conta dentro de fatura de fornecedor continua sendo paga pela fatura", async () => {
    const env2 = await makeCompany("Pagar fatura");
    const sale = await createSale(env2.admin, exampleSale(env2.client.id, env2.supplier.id));
    const p = await prisma.payable.findFirstOrThrow({ where: { saleId: sale.id, origin: "CUSTO_VENDA" } });
    const inv = await createInvoice(env2.fin, { supplierId: env2.supplier.id, number: "F-9", issueDate: "2026-11-04", dueDate: "2026-11-30", declaredCents: p.amountCents });
    await addPayablesToInvoice(env2.fin, inv, [p.id]);
    await expect(settleEntry(env2.fin, "payable", p.id, { date: "2026-11-10", amountCents: 1000, newTotalCents: 1, accountId: env2.account.id })).rejects.toThrow(/fatura de fornecedor/);
  });

  it("outra empresa não ajusta nem baixa a conta", async () => {
    const other = await makeCompany("Pagar intrusa");
    const [id] = await payable(env, "Aluguel", 100000);
    await expect(settleEntry(other.fin, "payable", id, { date: "2026-11-10", amountCents: 1000, newTotalCents: 2000, accountId: other.account.id })).rejects.toThrow(/não encontrado/);
    expect((await get(id)).amountCents).toBe(100000);
  });
});

describe("débito em conta corrente", () => {
  it("é uma forma de pagamento válida e sem taxa de maquininha", async () => {
    const env = await makeCompany("Débito em conta");
    expect(PAYMENT_METHODS.label("DEBITO_CONTA")).toBe("Débito em conta corrente");
    const [id] = await payable(env, "Tarifa do banco", 4500, { method: "DEBITO_CONTA" });
    expect((await get(id)).method).toBe("DEBITO_CONTA");
    await settleEntry(env.fin, "payable", id, { date: "2026-11-10", amountCents: 4500, accountId: env.account.id, method: "DEBITO_CONTA" });
    const s = await prisma.settlement.findFirstOrThrow({ where: { payableId: id } });
    expect(s.method).toBe("DEBITO_CONTA");
    const rates = [
      { modality: "DEBITO", installmentsFrom: 1, installmentsTo: 1, active: true },
      { modality: "CREDITO", installmentsFrom: 1, installmentsTo: 12, active: true },
    ];
    expect(pickCardFee(rates, "DEBITO_CONTA", 1)).toBeNull();
  });
});
