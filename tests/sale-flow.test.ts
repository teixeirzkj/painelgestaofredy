import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createSale, updateSale, cancelSale, syncConfirmedSale, getSale, listSales } from "@/server/services/sales";
import { settleEntry, reverseSettlement, cashflow, cancelEntry, updateEntry } from "@/server/services/finance";
import { getDashboard } from "@/server/services/dashboard";
import { makeCompany, exampleSale } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

async function snapshot(saleId: string) {
  const [rec, pay, comm, events, reservations, contract] = await Promise.all([
    prisma.receivable.findMany({ where: { saleId }, orderBy: { dueDate: "asc" } }),
    prisma.payable.findMany({ where: { saleId }, orderBy: { dueDate: "asc" } }),
    prisma.commission.findMany({ where: { saleId } }),
    prisma.automationEvent.findMany({ where: { entityId: saleId } }),
    prisma.reservation.findMany({ where: { saleId } }),
    prisma.contract.findMany({ where: { saleId } }),
  ]);
  return { rec, pay, comm, events, reservations, contract };
}

describe("cenário obrigatório: venda de pacote R$ 8.000 em 4 parcelas", () => {
  let env: Env;
  let saleId: string;

  beforeAll(async () => {
    env = await makeCompany("Cenário obrigatório");
    const r = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id));
    saleId = r.id;
    expect(r.code).toMatch(/^V-2026-0001$/);
  });

  it("registra a venda com os valores calculados", async () => {
    const s = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } });
    expect(s.status).toBe("CONFIRMADA");
    expect(s.grossCents).toBe(800000);
    expect(s.agencyRevenueCents).toBe(150000);
    expect(s.grossProfitCents).toBe(130000);
    expect(s.marginBps).toBe(1625);
  });

  it("cria 4 parcelas a receber, 1 conta ao fornecedor e 1 comissão (sem duplicar despesas)", async () => {
    const { rec, pay, comm, reservations, contract } = await snapshot(saleId);
    expect(rec).toHaveLength(4);
    expect(rec.every((r) => r.amountCents === 200000 && r.clientId === env.client.id && r.status === "PENDENTE")).toBe(true);
    const supplierPay = pay.filter((p) => p.origin === "CUSTO_VENDA");
    expect(supplierPay).toHaveLength(1);
    expect(supplierPay[0]).toMatchObject({ amountCents: 650000, supplierId: env.supplier.id, dueDate: "2026-12-10", category: "FORNECEDORES" });
    const commPay = pay.filter((p) => p.origin === "COMISSAO_VENDEDOR");
    expect(commPay).toHaveLength(1);
    expect(commPay[0]).toMatchObject({ amountCents: 20000, category: "COMISSOES", dueDate: "2026-12-05" });
    expect(comm).toHaveLength(1);
    expect(comm[0].amountCents).toBe(20000);
    // despesas totais = custo + comissão, nada a mais
    expect(pay.reduce((a, p) => a + p.amountCents, 0)).toBe(670000);
    expect(reservations).toHaveLength(1);
    // sem modelo cadastrado: contrato registrado como "não gerado", apontando a pendência
    expect(contract).toHaveLength(1);
    expect(contract[0].status).toBe("NAO_GERADO");
    expect(JSON.parse(contract[0].missingFieldsJson)).toContain("Modelo de contrato para o produto");
  });

  it("re-sincronizar não duplica lançamentos nem eventos (idempotência)", async () => {
    await prisma.$transaction((tx) => syncConfirmedSale(tx, env.seller, saleId));
    await prisma.$transaction((tx) => syncConfirmedSale(tx, env.seller, saleId));
    await updateSale(env.seller, saleId, exampleSale(env.client.id, env.supplier.id, { items: (await getSale(env.admin, saleId)).items.map((i) => ({ ...exampleSale(env.client.id, env.supplier.id).items[0], id: i.id })) }));
    const { rec, pay, comm, events } = await snapshot(saleId);
    expect(rec.filter((r) => r.status !== "CANCELADO")).toHaveLength(4);
    expect(pay.filter((p) => p.status !== "CANCELADO")).toHaveLength(2);
    expect(comm).toHaveLength(1);
    expect(events.filter((e) => e.type === "venda.confirmada")).toHaveLength(1);
  });

  it("aparece no dashboard com os indicadores corretos", async () => {
    const d = await getDashboard(env.admin, { from: "2026-11-01", to: "2026-11-30" });
    expect(d.kpis.grossCents).toBe(800000);
    expect(d.kpis.count).toBe(1);
    expect(d.kpis.agencyRevenueCents).toBe(150000);
    expect(d.kpis.grossProfitCents).toBe(130000);
    expect(d.kpis.marginBps).toBe(1625);
    expect(d.kpis.sellerCommissionCents).toBe(20000);
    expect(d.kpis.ticketCents).toBe(800000);
    expect(d.finance!.receivableCents).toBe(200000); // parcela de novembro
  });

  it("atualiza o fluxo de caixa (previsto) e permite baixa parcial e total", async () => {
    const before = await cashflow(env.fin, { from: "2026-11-01", to: "2027-02-28", granularity: "mes" });
    expect(before.totals.plannedIn).toBe(800000);
    expect(before.totals.plannedOut).toBe(670000);
    expect(before.openingBalance).toBe(100000);

    const first = (await snapshot(saleId)).rec[0];
    // baixa parcial
    const r1 = await settleEntry(env.fin, "receivable", first.id, { date: "2026-11-10", amountCents: 50000, accountId: env.account.id, method: "PIX" });
    expect(r1.status).toBe("PARCIAL");
    // não permite baixar acima do saldo
    await expect(settleEntry(env.fin, "receivable", first.id, { date: "2026-11-11", amountCents: 160000, accountId: env.account.id })).rejects.toThrow(/maior que o saldo/);
    // quita o restante
    const r2 = await settleEntry(env.fin, "receivable", first.id, { date: "2026-11-12", amountCents: 150000, accountId: env.account.id });
    expect(r2.status).toBe("PAGO");

    const after = await cashflow(env.fin, { from: "2026-11-01", to: "2027-02-28", granularity: "mes" });
    expect(after.totals.realizedIn).toBe(200000);
    expect(after.totals.plannedIn).toBe(600000); // previsto considera apenas o saldo em aberto
    expect(after.projectedBalance).toBe(before.projectedBalance); // nada somado em dobro

    const d = await getDashboard(env.admin, { from: "2026-11-01", to: "2026-11-30" });
    expect(d.finance!.receivedCents).toBe(200000);
    expect(d.finance!.receivableCents).toBe(0);
    const s = await getSale(env.admin, saleId);
    expect(s.financialStatus).toBe("PARCIAL");
    const ev = await prisma.automationEvent.count({ where: { companyId: env.company.id, type: "pagamento.identificado" } });
    expect(ev).toBe(2);
  });

  it("estorno de baixa reabre o saldo sem apagar o histórico", async () => {
    const first = (await snapshot(saleId)).rec[0];
    const settlements = await prisma.settlement.findMany({ where: { receivableId: first.id }, orderBy: { date: "asc" } });
    await expect(reverseSettlement(env.fin, settlements[1].id, "")).rejects.toThrow(/motivo/);
    await reverseSettlement(env.fin, settlements[1].id, "Pagamento devolvido pelo banco");
    const r = await prisma.receivable.findUniqueOrThrow({ where: { id: first.id } });
    expect(r.status).toBe("PARCIAL");
    expect(r.settledCents).toBe(50000);
    expect(await prisma.settlement.count({ where: { receivableId: first.id } })).toBe(2); // mantido
    await expect(reverseSettlement(env.fin, settlements[1].id, "de novo")).rejects.toThrow(/já foi estornada/);
  });

  it("pagamento ao fornecedor e da comissão atualizam status da comissão", async () => {
    const { pay } = await snapshot(saleId);
    const commPay = pay.find((p) => p.origin === "COMISSAO_VENDEDOR")!;
    await settleEntry(env.fin, "payable", commPay.id, { date: "2026-12-05", amountCents: 20000, accountId: env.account.id });
    const c = await prisma.commission.findUniqueOrThrow({ where: { saleId } });
    expect(c.status).toBe("PAGA");
  });
});

describe("alterações e cancelamento de vendas", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeCompany("Alterações");
  });

  it("alteração de valores atualiza os lançamentos sem duplicar e preserva baixas", async () => {
    const { id } = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id));
    const recs = await prisma.receivable.findMany({ where: { saleId: id }, orderBy: { dueDate: "asc" } });
    await settleEntry(env.fin, "receivable", recs[0].id, { date: "2026-11-15", amountCents: 200000, accountId: env.account.id });

    const sale = await getSale(env.admin, id);
    // novo preço 9.000, custo 7.000, 1ª parcela (paga) mantida + 2 parcelas de 3.500
    const input = exampleSale(env.client.id, env.supplier.id, {
      items: [{ ...exampleSale(env.client.id, env.supplier.id).items[0], id: sale.items[0].id, priceCents: 900000, costCents: 700000 }],
      payments: [
        { key: "p1", dueDate: "2026-11-15", amountCents: 200000, method: "PIX" },
        { key: "n2", dueDate: "2026-12-20", amountCents: 350000, method: "BOLETO" },
        { key: "n3", dueDate: "2027-01-20", amountCents: 350000, method: "BOLETO" },
      ],
    });
    await updateSale(env.seller, id, input);
    const after = await prisma.receivable.findMany({ where: { saleId: id }, orderBy: { dueDate: "asc" } });
    const active = after.filter((r) => r.status !== "CANCELADO");
    expect(active.map((r) => r.amountCents).sort()).toEqual([200000, 350000, 350000]);
    expect(active.find((r) => r.id === recs[0].id)?.status).toBe("PAGO"); // baixa preservada
    expect(after.filter((r) => r.status === "CANCELADO")).toHaveLength(3); // p2..p4 canceladas, não apagadas
    const pay = await prisma.payable.findMany({ where: { saleId: id, origin: "CUSTO_VENDA" } });
    expect(pay).toHaveLength(1);
    expect(pay[0].amountCents).toBe(700000);
    const s = await prisma.sale.findUniqueOrThrow({ where: { id } });
    expect(s.grossProfitCents).toBe(180000);
  });

  it("bloqueia remover parcela que já tem baixa", async () => {
    const { id } = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id));
    const recs = await prisma.receivable.findMany({ where: { saleId: id }, orderBy: { dueDate: "asc" } });
    await settleEntry(env.fin, "receivable", recs[0].id, { date: "2026-11-15", amountCents: 100000, accountId: env.account.id });
    const sale = await getSale(env.admin, id);
    const input = exampleSale(env.client.id, env.supplier.id, {
      items: [{ ...exampleSale(env.client.id, env.supplier.id).items[0], id: sale.items[0].id }],
      payments: [{ key: "novo", dueDate: "2026-12-01", amountCents: 800000, method: "PIX" }],
    });
    await expect(updateSale(env.seller, id, input)).rejects.toThrow(/baixa registrada/);
    // nada mudou (transação revertida)
    expect(await prisma.receivable.count({ where: { saleId: id, status: { not: "CANCELADO" } } })).toBe(4);
  });

  it("não permite reduzir parcela abaixo do valor já recebido", async () => {
    const { id } = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id));
    const recs = await prisma.receivable.findMany({ where: { saleId: id }, orderBy: { dueDate: "asc" } });
    await settleEntry(env.fin, "receivable", recs[0].id, { date: "2026-11-15", amountCents: 150000, accountId: env.account.id });
    const sale = await getSale(env.admin, id);
    const input = exampleSale(env.client.id, env.supplier.id, {
      items: [{ ...exampleSale(env.client.id, env.supplier.id).items[0], id: sale.items[0].id }],
      payments: [
        { key: "p1", dueDate: "2026-11-15", amountCents: 100000, method: "PIX" },
        { key: "p2", dueDate: "2026-12-15", amountCents: 700000, method: "PIX" },
      ],
    });
    await expect(updateSale(env.seller, id, input)).rejects.toThrow(/não pode ser menor/);
  });

  it("lançamento gerado por venda não pode ser cancelado nem ter valor alterado pelo financeiro", async () => {
    const { id } = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id));
    const rec = await prisma.receivable.findFirstOrThrow({ where: { saleId: id } });
    await expect(cancelEntry(env.fin, "receivable", rec.id)).rejects.toThrow(/gerado por venda/);
    await expect(updateEntry(env.fin, "receivable", rec.id, { description: "x y", amountCents: 1, dueDate: rec.dueDate, category: "VENDAS" })).rejects.toThrow(/pela própria venda/);
  });

  it("cancelamento: cancela pendentes, encerra saldo de parciais e mantém o que foi pago", async () => {
    const { id } = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id));
    const recs = await prisma.receivable.findMany({ where: { saleId: id }, orderBy: { dueDate: "asc" } });
    await settleEntry(env.fin, "receivable", recs[0].id, { date: "2026-11-15", amountCents: 50000, accountId: env.account.id });

    await expect(cancelSale(env.seller, id, "Cliente desistiu")).rejects.toThrow(/permissão/); // vendedor não cancela venda confirmada
    const r = await cancelSale(env.admin, id, "Cliente desistiu");
    expect(r.warnings.length).toBe(1);
    const after = await prisma.receivable.findMany({ where: { saleId: id }, orderBy: { dueDate: "asc" } });
    expect(after[0]).toMatchObject({ status: "PAGO", amountCents: 50000, settledCents: 50000 });
    expect(after.slice(1).every((x) => x.status === "CANCELADO")).toBe(true);
    const pays = await prisma.payable.findMany({ where: { saleId: id } });
    expect(pays.every((p) => p.status === "CANCELADO")).toBe(true);
    expect((await prisma.commission.findUniqueOrThrow({ where: { saleId: id } })).status).toBe("CANCELADA");
    expect((await prisma.reservation.findFirstOrThrow({ where: { saleId: id } })).status).toBe("CANCELADA");
    await expect(updateSale(env.admin, id, exampleSale(env.client.id, env.supplier.id))).rejects.toThrow(/cancelada/);
  });

  it("rascunho não gera lançamentos; confirmação posterior gera uma única vez", async () => {
    const { id } = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { confirm: false }));
    expect(await prisma.receivable.count({ where: { saleId: id } })).toBe(0);
    expect(await prisma.payable.count({ where: { saleId: id } })).toBe(0);
    const sale = await getSale(env.admin, id);
    const input = exampleSale(env.client.id, env.supplier.id, { items: [{ ...exampleSale(env.client.id, env.supplier.id).items[0], id: sale.items[0].id }] });
    await updateSale(env.seller, id, input);
    await updateSale(env.seller, id, input);
    expect(await prisma.receivable.count({ where: { saleId: id } })).toBe(4);
    expect(await prisma.payable.count({ where: { saleId: id } })).toBe(2);
  });

  it("modelo comissão gera recebível do fornecedor e nenhuma conta a pagar de custo", async () => {
    const { id } = await createSale(
      env.seller,
      exampleSale(env.client.id, env.supplier.id, {
        items: [{ productType: "CRUZEIRO", supplierId: env.supplier.id, commercialModel: "COMISSAO", priceCents: 1000000, costCents: 0, supplierCommissionCents: 120000, supplierDueDate: "2027-02-10" }],
        payments: [],
        commission: { mode: "PERCENTUAL", bps: 1000 },
      }),
    );
    const rec = await prisma.receivable.findMany({ where: { saleId: id } });
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ origin: "COMISSAO_FORNECEDOR", amountCents: 120000, supplierId: env.supplier.id });
    const pays = await prisma.payable.findMany({ where: { saleId: id } });
    expect(pays.map((p) => p.origin)).toEqual(["COMISSAO_VENDEDOR"]);
    expect(pays[0].amountCents).toBe(12000);
  });

  it("valida parcelas que não fecham com o valor da venda", async () => {
    await expect(
      createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { payments: [{ key: "a", dueDate: "2026-11-15", amountCents: 100000, method: "PIX" }] })),
    ).rejects.toThrow(/soma das parcelas/);
  });

  it("vendedor só vê as próprias vendas e não vê margem", async () => {
    const own = await createSale(env.seller2, exampleSale(env.client.id, env.supplier.id));
    await expect(getSale(env.seller, own.id)).rejects.toThrow(/não encontrada/);
    const list = await listSales(env.seller, {});
    expect(list.items.every((s) => s.seller.id === env.seller.userId)).toBe(true);
    expect(list.items.every((s) => s.grossProfitCents === null)).toBe(true);
    const mine = await getSale(env.seller2, own.id);
    expect(mine.grossProfitCents).toBeNull();
    expect(mine.payables).toEqual([]);
    await expect(settleEntry(env.seller, "receivable", "x", {})).rejects.toThrow(/permissão/);
  });
});
