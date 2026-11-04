/**
 * Regras do turismo adicionadas na adequação ao Monde:
 * RAV/DU, over, taxa CC, intermediário, pagantes, viagens, excursões, faturas de fornecedores,
 * reembolsos/multas e DRE gerencial.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { calculateSale, validateSaleFinancials, supplierRemittance } from "@/lib/finance";
import { createSale, updateSale, registerRefund } from "@/server/services/sales";
import { settleEntry, reverseSettlement } from "@/server/services/finance";
import { createTrip, getTrip, linkSaleToTrip, tripStatus } from "@/server/services/trips";
import { saveExcursion, addExcursionCost, getExcursion } from "@/server/services/excursions";
import { addPayablesToInvoice, checkInvoice, createInvoice, getInvoice, payInvoice, registerInvoiceDifference } from "@/server/services/invoices";
import { computeDre } from "@/server/services/dre";
import { pickRule } from "@/server/services/catalog";
import { makeCompany, exampleSale } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

describe("cálculo: RAV, DU, over, taxa CC e intermediário", () => {
  it("o cenário obrigatório continua idêntico (campos novos zerados)", () => {
    const t = calculateSale([{ commercialModel: "INTERMEDIACAO", priceCents: 800000, costCents: 650000, supplierCommissionCents: 0 }], 0, 0, { mode: "VALOR", amountCents: 20000 });
    expect(t).toMatchObject({ grossCents: 800000, agencyRevenueCents: 150000, grossProfitCents: 130000, marginBps: 1625, intermediaryCommissionCents: 0 });
  });

  it("aéreo pago direto à consolidadora: RAV+DU−taxa CC é receita e repasse do fornecedor", () => {
    const item = { commercialModel: "COMISSAO" as const, priceCents: 980000, costCents: 0, supplierCommissionCents: 0, ravCents: 30000, duCents: 16000, cardFeeCents: 2000 };
    const t = calculateSale([item], 0, 0, { mode: "VALOR", amountCents: 0 });
    expect(t.grossCents).toBe(1026000); // tarifa + taxas cobradas do cliente
    expect(t.clientPayableCents).toBe(0); // cliente pagou direto ao fornecedor
    expect(t.agencyRevenueCents).toBe(44000);
    expect(t.grossProfitCents).toBe(44000);
    expect(supplierRemittance(item)).toBe(44000);
  });

  it("intermediação com over e comissão de intermediário (sem dupla contagem)", () => {
    const t = calculateSale(
      [{ commercialModel: "INTERMEDIACAO", priceCents: 1000000, costCents: 800000, supplierCommissionCents: 0, overCents: 20000, ravCents: 5000 }],
      10000,
      0,
      { mode: "PERCENTUAL", bps: 1000 },
      30000,
    );
    // margem = 200.000 + 20.000 over + 5.000 RAV + 10.000 taxa − 30.000 intermediário = 205.000
    expect(t.agencyRevenueCents).toBe(235000);
    expect(t.sellerCommissionCents).toBe(20500);
    expect(t.grossProfitCents).toBe(184500);
    expect(t.clientPayableCents).toBe(1015000);
  });

  it("taxa CC: só no modelo comissão e nunca maior que RAV+DU", () => {
    const bad1 = [{ commercialModel: "INTERMEDIACAO" as const, priceCents: 1000, costCents: 500, supplierCommissionCents: 0, ravCents: 100, cardFeeCents: 10 }];
    const bad2 = [{ commercialModel: "COMISSAO" as const, priceCents: 1000, costCents: 0, supplierCommissionCents: 0, ravCents: 100, cardFeeCents: 150 }];
    for (const items of [bad1, bad2]) {
      const t = calculateSale(items, 0, 0, { mode: "VALOR", amountCents: 0 });
      expect(validateSaleFinancials(items, 0, 0, t, t.clientPayableCents).some((i) => i.field.endsWith("cardFeeCents"))).toBe(true);
    }
  });

  it("regra de comissão mais específica vence", () => {
    const rules = [
      { supplierId: null, productType: "HOTEL", description: null, commissionBps: 500, overBps: 0 },
      { supplierId: "s1", productType: null, description: null, commissionBps: 800, overBps: 100 },
      { supplierId: "s1", productType: "HOTEL", description: null, commissionBps: 1000, overBps: 200 },
    ];
    expect(pickRule(rules, "s1", "HOTEL")?.commissionBps).toBe(1000);
    expect(pickRule(rules, "s1", "AEREO")?.commissionBps).toBe(800);
    expect(pickRule(rules, "s2", "HOTEL")?.commissionBps).toBe(500);
    expect(pickRule(rules, "s2", "AEREO")).toBeNull();
  });
});

describe("venda turística integrada ao financeiro", () => {
  let env: Env;
  let intermediary: { id: string };
  let payer: { id: string };
  let saleId: string;

  beforeAll(async () => {
    env = await makeCompany("Turismo");
    intermediary = await prisma.supplier.create({ data: { companyId: env.company.id, name: "Parceira", category: "INTERMEDIARIO" } });
    payer = await prisma.client.create({ data: { companyId: env.company.id, name: "Empresa Pagante", personType: "PJ", document: "11444777000161" } });
    const r = await createSale(
      env.admin,
      exampleSale(env.client.id, env.supplier.id, {
        intermediaryId: intermediary.id,
        intermediaryCommissionCents: 30000,
        items: [{ productType: "HOTEL", supplierId: env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: 800000, costCents: 650000, overCents: 16000, supplierDueDate: "2026-12-10" }],
        payments: [
          { key: "a", dueDate: "2026-11-15", amountCents: 400000, method: "PIX" },
          { key: "b", dueDate: "2026-12-15", amountCents: 400000, method: "BOLETO", payerClientId: payer.id },
        ],
      }),
    );
    saleId = r.id;
  });

  it("gera over a receber do fornecedor, comissão do intermediário e parcela do pagante", async () => {
    const rec = await prisma.receivable.findMany({ where: { saleId }, orderBy: { dueDate: "asc" } });
    const over = rec.find((r) => r.category === "OVER")!;
    expect(over.amountCents).toBe(16000);
    expect(over.supplierId).toBe(env.supplier.id);
    const parcels = rec.filter((r) => r.origin === "VENDA");
    expect(parcels.map((p) => p.clientId)).toEqual([env.client.id, payer.id]);
    const inter = await prisma.payable.findMany({ where: { saleId, origin: "COMISSAO_INTERMEDIARIO" } });
    expect(inter).toHaveLength(1);
    expect(inter[0]).toMatchObject({ amountCents: 30000, supplierId: intermediary.id, category: "COMISSOES" });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(sale.grossProfitCents).toBe(150000 + 16000 - 30000 - 20000);
  });

  it("reeditar a venda não duplica over nem comissão de intermediário", async () => {
    await updateSale(
      env.admin,
      saleId,
      exampleSale(env.client.id, env.supplier.id, {
        intermediaryId: intermediary.id,
        intermediaryCommissionCents: 25000,
        items: [{ productType: "HOTEL", supplierId: env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: 800000, costCents: 650000, overCents: 16000, supplierDueDate: "2026-12-10" }],
        payments: [
          { key: "a", dueDate: "2026-11-15", amountCents: 400000, method: "PIX" },
          { key: "b", dueDate: "2026-12-15", amountCents: 400000, method: "BOLETO", payerClientId: payer.id },
        ],
      }),
    );
    const inter = await prisma.payable.findMany({ where: { saleId, origin: "COMISSAO_INTERMEDIARIO", status: { not: "CANCELADO" } } });
    expect(inter).toHaveLength(1);
    expect(inter[0].amountCents).toBe(25000);
    expect(await prisma.receivable.count({ where: { saleId, category: "OVER", status: { not: "CANCELADO" } } })).toBe(1);
  });

  it("comissão de intermediário exige intermediário selecionado", async () => {
    await expect(createSale(env.admin, exampleSale(env.client.id, env.supplier.id, { intermediaryCommissionCents: 1000 }))).rejects.toThrow(/intermediário/);
  });

  it("pagante de outra empresa é recusado", async () => {
    const other = await makeCompany("Outra");
    await expect(
      createSale(env.admin, exampleSale(env.client.id, env.supplier.id, { payments: [{ key: "x", dueDate: "2026-11-15", amountCents: 800000, method: "PIX", payerClientId: other.client.id }] })),
    ).rejects.toThrow(/inválido/);
  });

  it("reembolso é idempotente e fica fora do DRE; multa entra como receita", async () => {
    const r1 = await registerRefund(env.fin, saleId, { kind: "REEMBOLSO_CLIENTE", amountCents: 50000, dueDate: "2026-11-20", requestKey: "abc123" });
    const r2 = await registerRefund(env.fin, saleId, { kind: "REEMBOLSO_CLIENTE", amountCents: 50000, dueDate: "2026-11-20", requestKey: "abc123" });
    expect(r2.id).toBe(r1.id);
    expect(r2.duplicated).toBe(true);
    await registerRefund(env.fin, saleId, { kind: "MULTA_CLIENTE", amountCents: 10000, dueDate: "2026-11-20", requestKey: "multa1" });
    await expect(registerRefund(env.seller, saleId, { kind: "MULTA_CLIENTE", amountCents: 1, dueDate: "2026-11-20", requestKey: "zzzzzz" })).rejects.toThrow(/permissão/);
    const dre = await computeDre(env.company.id, { from: "2026-11-01", to: "2026-11-30" });
    const line = (k: string) => dre.lines.find((l) => l.key === k)!.amountCents;
    const sales = await prisma.sale.findMany({ where: { companyId: env.company.id, status: { in: ["CONFIRMADA", "CONCLUIDA"] }, saleDate: { gte: "2026-11-01", lte: "2026-11-30" } } });
    // lucro das vendas do DRE = soma do lucro das vendas (sem contar de novo custos e comissões gerados por elas)
    expect(line("lucro_vendas")).toBe(sales.reduce((a, s) => a + s.grossProfitCents, 0));
    expect(line("multas_cliente")).toBe(10000);
    expect(dre.lines.some((l) => l.label.includes("Reembolsos"))).toBe(false);
    expect(line("resultado")).toBe(line("lucro_vendas") + 10000);
  });
});

describe("viagens: agrupamento de vendas", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeCompany("Viagens");
  });

  it("agrupa vendas do mesmo cliente e deriva datas e situação", async () => {
    const trip = await createTrip(env.seller, { clientId: env.client.id, title: "Férias", destination: "Lisboa" });
    const a = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { tripId: trip.id, tripStart: "2027-01-10", tripEnd: "2027-01-12" }));
    const b = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { tripStart: "2027-01-12", tripEnd: "2027-01-20" }));
    await linkSaleToTrip(env.seller, trip.id, b.id);
    const t = await getTrip(env.seller, trip.id);
    expect(t.sales.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(t.start).toBe("2027-01-10");
    expect(t.end).toBe("2027-01-20");
    expect(t.totals.grossCents).toBe(1600000);
    expect(tripStatus(false, t.sales, "2027-01-15")).toBe("EM_VIAGEM");
    expect(tripStatus(false, t.sales, "2027-02-01")).toBe("FINALIZADA");
  });

  it("não vincula venda de outro cliente nem de outra empresa", async () => {
    const other = await prisma.client.create({ data: { companyId: env.company.id, name: "Outro Cliente" } });
    const trip = await createTrip(env.admin, { clientId: env.client.id, title: "Viagem A" });
    const s = await createSale(env.admin, exampleSale(other.id, env.supplier.id));
    await expect(linkSaleToTrip(env.admin, trip.id, s.id)).rejects.toThrow(/outro cliente/);
    await expect(createSale(env.admin, exampleSale(other.id, env.supplier.id, { tripId: trip.id }))).rejects.toThrow(/outro cliente/);
    const b = await makeCompany("Empresa B");
    await expect(getTrip(b.admin, trip.id)).rejects.toThrow(/não encontrada/);
  });
});

describe("excursões: vagas, custos e resultado", () => {
  let env: Env;
  let excId: string;
  beforeAll(async () => {
    env = await makeCompany("Excursões");
    excId = (await saveExcursion(env.admin, null, { name: "Serra Gaúcha", destination: "Gramado", startDate: "2027-02-01", endDate: "2027-02-04", seats: 5, pricePerSeatCents: 100000, status: "VENDAS_ABERTAS" })).id;
  });

  const reserve = (pax: number) =>
    createSale(env.seller, {
      ...exampleSale(env.client.id, env.supplier.id),
      excursionId: excId,
      passengerCount: pax,
      commission: { mode: "VALOR", amountCents: 0 },
      items: [{ productType: "EXCURSAO", commercialModel: "REVENDA", priceCents: 100000 * pax, costCents: 0 }],
      payments: [{ key: "u", dueDate: "2026-12-01", amountCents: 100000 * pax, method: "PIX" }],
    });

  it("controla vagas e calcula o resultado com os custos da operação", async () => {
    await reserve(3);
    await reserve(2);
    await expect(reserve(1)).rejects.toThrow(/vaga/);
    await addExcursionCost(env.admin, excId, { description: "Ônibus", supplierId: env.supplier.id, amountCents: 200000, dueDate: "2027-01-20" });
    const e = await getExcursion(env.admin, excId);
    expect(e.stats.booked).toBe(5);
    expect(e.stats.available).toBe(0);
    expect(e.stats.grossCents).toBe(500000);
    expect(e.stats.costCents).toBe(200000);
    expect(e.stats.resultCents).toBe(300000);
    const cost = await prisma.payable.findFirstOrThrow({ where: { excursionId: excId } });
    expect(cost.category).toBe("OPERACAO_PROPRIA");
  });

  it("vendedor não lança custos da excursão", async () => {
    await expect(addExcursionCost(env.seller, excId, { description: "X", amountCents: 1, dueDate: "2027-01-01" })).rejects.toThrow(/permissão/);
  });
});

describe("faturas de fornecedores: conferência e quitação sem duplicidade", () => {
  let env: Env;
  let invId: string;
  let payableIds: string[];

  beforeAll(async () => {
    env = await makeCompany("Faturas");
    const a = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id));
    const b = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id, { items: [{ productType: "HOTEL", supplierId: env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: 800000, costCents: 600000 }] }));
    payableIds = (await prisma.payable.findMany({ where: { saleId: { in: [a.id, b.id] }, origin: "CUSTO_VENDA" } })).map((p) => p.id);
    invId = await createInvoice(env.fin, { supplierId: env.supplier.id, number: "F-1", issueDate: "2026-11-04", dueDate: "2026-11-30", declaredCents: 1250000 + 3500 });
  });

  it("vincula custos, mostra divergência e impede conferir com diferença", async () => {
    await addPayablesToInvoice(env.fin, invId, payableIds);
    const inv = await getInvoice(env.fin, invId);
    expect(inv.systemCents).toBe(1250000);
    expect(inv.divergenceCents).toBe(3500);
    expect(inv.payables.every((p) => p.dueDate === "2026-11-30")).toBe(true);
    await expect(checkInvoice(env.fin, invId)).rejects.toThrow(/divergência/);
  });

  it("número de fatura repetido para o mesmo fornecedor é recusado", async () => {
    await expect(createInvoice(env.fin, { supplierId: env.supplier.id, number: "F-1", issueDate: "2026-11-04", dueDate: "2026-11-30", declaredCents: 1 })).rejects.toThrow(/já foi registrada/);
  });

  it("lançamento em fatura não pode ser baixado individualmente", async () => {
    await expect(settleEntry(env.fin, "payable", payableIds[0], { date: "2026-11-10", amountCents: 1000, accountId: env.account.id })).rejects.toThrow(/fatura/);
  });

  it("diferença registrada como ajuste, conferência e quitação única", async () => {
    const before = await prisma.payable.count({ where: { companyId: env.company.id } });
    await registerInvoiceDifference(env.fin, invId, "Taxa administrativa");
    await checkInvoice(env.fin, invId);
    const r = await payInvoice(env.fin, invId, { date: "2026-11-30", accountId: env.account.id });
    expect(r.amountCents).toBe(1253500);
    const inv = await getInvoice(env.fin, invId);
    expect(inv.status).toBe("PAGA");
    expect(inv.payables.every((p) => p.status === "PAGO")).toBe(true);
    // só o ajuste foi criado: a fatura não gera uma despesa paralela aos custos das vendas
    expect(await prisma.payable.count({ where: { companyId: env.company.id } })).toBe(before + 1);
    await expect(payInvoice(env.fin, invId, { date: "2026-11-30", accountId: env.account.id })).rejects.toThrow(/já está paga/);
  });

  it("estorno de uma baixa reabre a fatura como conferida", async () => {
    const s = await prisma.settlement.findFirstOrThrow({ where: { payableId: payableIds[0], reversedAt: null } });
    await reverseSettlement(env.fin, s.id, "Pagamento devolvido pelo banco");
    expect((await getInvoice(env.fin, invId)).status).toBe("CONFERIDA");
  });

  it("outra empresa não acessa nem usa a fatura", async () => {
    const b = await makeCompany("Empresa B faturas");
    await expect(getInvoice(b.fin, invId)).rejects.toThrow(/não encontrada/);
    const bInv = await createInvoice(b.fin, { supplierId: b.supplier.id, number: "X", issueDate: "2026-11-04", dueDate: "2026-11-30", declaredCents: 100 });
    await expect(addPayablesToInvoice(b.fin, bInv, [payableIds[1]])).rejects.toThrow(/inválido/);
  });

  it("alterar a venda mantém o vencimento da fatura", async () => {
    const env2 = await makeCompany("Faturas 2");
    const sale = await createSale(env2.admin, exampleSale(env2.client.id, env2.supplier.id));
    const p = await prisma.payable.findFirstOrThrow({ where: { saleId: sale.id, origin: "CUSTO_VENDA" } });
    const inv = await createInvoice(env2.fin, { supplierId: env2.supplier.id, number: "Z", issueDate: "2026-11-04", dueDate: "2026-12-20", declaredCents: 650000 });
    await addPayablesToInvoice(env2.fin, inv, [p.id]);
    await updateSale(env2.admin, sale.id, exampleSale(env2.client.id, env2.supplier.id, { destination: "Outro destino" }));
    expect((await prisma.payable.findUniqueOrThrow({ where: { id: p.id } })).dueDate).toBe("2026-12-20");
  });
});
