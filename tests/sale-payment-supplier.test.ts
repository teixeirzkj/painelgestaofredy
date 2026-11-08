/** Venda: como a agência paga o fornecedor (cliente direto, faturado, cartão da agência, à vista). */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { cancelSale, createSale, duplicateSale, updateSale } from "@/server/services/sales";
import { cashflow, reverseSettlement, saveAccount, settleEntry } from "@/server/services/finance";
import { cardOptions } from "@/server/services/cards";
import { computeDre } from "@/server/services/dre";
import { normalizeSupplierPayment } from "@/lib/finance";
import { exampleSale, makeCompany } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

/** Venda de R$ 1.200 (custo R$ 900) paga pelo cliente em 1x. */
function sale(env: Env, item: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  return exampleSale(env.client.id, env.supplier.id, {
    saleDate: "2026-11-03",
    commission: { mode: "VALOR", amountCents: 0 },
    items: [{ productType: "HOTEL", description: "Hotel Azul", supplierId: env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: 120000, costCents: 90000, supplierCommissionCents: 0, ...item }],
    payments: [{ key: "p1", dueDate: "2026-11-10", amountCents: 120000, method: "PIX" }],
    ...overrides,
  });
}
const costPayable = (saleId: string) => prisma.payable.findFirstOrThrow({ where: { saleId, origin: "CUSTO_VENDA" }, include: { settlements: { orderBy: { createdAt: "asc" } } } });
const bills = (companyId: string) => prisma.payable.findMany({ where: { companyId, origin: "CARTAO", status: { not: "CANCELADO" } }, orderBy: { dueDate: "asc" } });
const itemsOf = (saleId: string) => prisma.saleItem.findMany({ where: { saleId }, orderBy: { sortOrder: "asc" } });

describe("normalizeSupplierPayment (função pura)", () => {
  it("deriva do modelo comercial e mantém os dois coerentes", () => {
    expect(normalizeSupplierPayment({ commercialModel: "COMISSAO" }).supplierPayment).toBe("CLIENTE_DIRETO");
    expect(normalizeSupplierPayment({ commercialModel: "INTERMEDIACAO" }).supplierPayment).toBe("FATURADO");
    expect(normalizeSupplierPayment({ commercialModel: "INTERMEDIACAO", supplierPayment: "CLIENTE_DIRETO" }).commercialModel).toBe("COMISSAO");
    // o modelo Comissão manda
    expect(normalizeSupplierPayment({ commercialModel: "COMISSAO", supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: "x" })).toMatchObject({
      supplierPayment: "CLIENTE_DIRETO",
      supplierCardAccountId: null,
    });
    // campos de outra forma de pagamento são zerados
    expect(normalizeSupplierPayment({ commercialModel: "REVENDA", supplierPayment: "FATURADO", supplierPayMethod: "PIX", supplierCardAccountId: "x", supplierCardInstallments: 3 })).toMatchObject({
      supplierPayMethod: null,
      supplierCardAccountId: null,
      supplierCardInstallments: 1,
    });
  });
});

describe("como a agência paga o fornecedor", () => {
  let env: Env;
  let cardId: string;
  beforeAll(async () => {
    env = await makeCompany("Fornecedor no cartão");
    cardId = await saveAccount(env.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
  });

  it("compatibilidade: sem o campo, sai do modelo comercial; cliente direto vira Comissão sem custo", async () => {
    const a = await createSale(env.seller, sale(env, { commercialModel: "COMISSAO", costCents: 0, supplierCommissionCents: 10000 }, { payments: [], confirm: false }));
    expect((await itemsOf(a.id))[0].supplierPayment).toBe("CLIENTE_DIRETO");
    const b = await createSale(env.seller, sale(env, {}, { confirm: false }));
    expect((await itemsOf(b.id))[0].supplierPayment).toBe("FATURADO");
    const c = await createSale(env.seller, sale(env, { supplierPayment: "CLIENTE_DIRETO", supplierCommissionCents: 10000 }, { payments: [], confirm: false }));
    expect((await itemsOf(c.id))[0]).toMatchObject({ commercialModel: "COMISSAO", costCents: 0, supplierPayment: "CLIENTE_DIRETO" });
  });

  it("faturado: conta a pagar pendente com boleto no vencimento informado", async () => {
    const r = await createSale(env.seller, sale(env, { supplierPayment: "FATURADO", supplierDueDate: "2026-12-01" }));
    const p = await costPayable(r.id);
    expect(p).toMatchObject({ status: "PENDENTE", method: "BOLETO", dueDate: "2026-12-01", amountCents: 90000 });
  });

  it("à vista: exige a forma; com PIX a conta fica pendente com PIX e sem baixa", async () => {
    await expect(createSale(env.seller, sale(env, { supplierPayment: "A_VISTA" }))).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: ["items", 0, "supplierPayMethod"] })]),
    });
    const r = await createSale(env.seller, sale(env, { supplierPayment: "A_VISTA", supplierPayMethod: "PIX" }));
    const p = await costPayable(r.id);
    expect(p).toMatchObject({ status: "PENDENTE", method: "PIX", dueDate: "2026-11-03" });
    expect(p.settlements).toHaveLength(0);
  });

  it("vendedor lança no cartão em 3x: conta paga, 3 faturas, fora do caixa e custo uma vez só", async () => {
    const own = await makeCompany("Cartão DRE");
    const card = await saveAccount(own.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
    const r = await createSale(own.seller, sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card, supplierCardInstallments: 3 }));
    expect(r.warnings).toEqual([]);
    const item = (await itemsOf(r.id))[0];
    const p = await costPayable(r.id);
    expect(p).toMatchObject({ status: "PAGO", method: "CARTAO_CREDITO" });
    expect(p.settlements).toHaveLength(1);
    expect(p.settlements[0]).toMatchObject({ accountId: card, cardInstallments: 3, autoKey: `venda-cartao:${item.id}`, amountCents: 90000 });
    const b = await bills(own.company.id);
    expect(b.map((x) => x.sourceKey)).toEqual(["2026-11", "2026-12", "2027-01"].map((m) => `cartao:${card}:${m}`));
    expect(b.every((x) => x.amountCents === 30000)).toBe(true);
    const cf = await cashflow(own.fin, { from: "2026-11-01", to: "2026-11-30", granularity: "month" as never });
    expect(cf.totals.realizedOut).toBe(0);
    const dre = await computeDre(own.company.id, { from: "2026-01-01", to: "2027-12-31" });
    expect(dre.lines.find((l) => l.key === "intermediacao")!.amountCents).toBe(30000);
    expect(dre.lines.find((l) => l.key === "despesas")!.amountCents).toBe(0);
    const log = await prisma.auditLog.findFirst({ where: { companyId: own.company.id, action: "venda.fornecedor_pago_cartao" } });
    expect(log?.userId).toBe(own.seller.userId);
  });

  it("rascunho sem cartão salva; confirmar sem cartão, com cartão de outra agência ou com conta bancária falha", async () => {
    const draft = await createSale(env.seller, sale(env, { supplierPayment: "CARTAO_AGENCIA" }, { confirm: false }));
    expect(draft.id).toBeTruthy();
    await expect(createSale(env.seller, sale(env, { supplierPayment: "CARTAO_AGENCIA" }))).rejects.toThrow(/Escolha qual cartão da agência foi usado/);
    await expect(createSale(env.seller, sale(env, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: env.account.id }))).rejects.toThrow(/Cartão da agência inválido/);
    const other = await makeCompany("Outra agência");
    const otherCard = await saveAccount(other.fin, null, { name: "Cartão de lá", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
    await expect(createSale(env.seller, sale(env, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: otherCard }))).rejects.toThrow(/Cartão da agência inválido/);
    await expect(createSale(env.seller, sale(env, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: cardId, costCents: 0 }))).rejects.toThrow(/Informe o custo/);
  });

  it("venda antiga: parcela 3 de 8 a partir da fatura escolhida", async () => {
    const own = await makeCompany("Venda antiga");
    const card = await saveAccount(own.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 13 });
    const r = await createSale(
      own.admin,
      sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card, supplierCardInstallments: 8, supplierCardStartInstallment: 3, supplierCardFirstBillMonth: "2026-11", costCents: 100000, priceCents: 120000, supplierDueDate: "2026-08-20" }),
    );
    const p = await costPayable(r.id);
    expect(p.status).toBe("PAGO");
    expect(p.settlements[0]).toMatchObject({ cardStartInstallment: 3, cardFirstBillMonth: "2026-11", date: "2026-08-20" });
    const b = await bills(own.company.id);
    expect(b).toHaveLength(6);
    expect(b[0].sourceKey).toBe(`cartao:${card}:2026-11`);
    expect(b.every((x) => x.amountCents === 12500)).toBe(true);
  });
});

describe("editar e cancelar venda com fornecedor no cartão", () => {
  let env: Env;
  let cardId: string;
  beforeAll(async () => {
    env = await makeCompany("Edição cartão");
    cardId = await saveAccount(env.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
  });
  const cardItem = (extra: Record<string, unknown> = {}) => ({ supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: cardId, supplierCardInstallments: 3, ...extra });
  const activeBillsTotal = async () => (await bills(env.company.id)).reduce((t, b) => t + b.amountCents, 0);

  it("muda custo e parcelas, troca para faturado e é idempotente", async () => {
    const r = await createSale(env.admin, sale(env, cardItem()));
    const [item] = await itemsOf(r.id);
    const input = (extra: Record<string, unknown>, price = 120000) =>
      sale(env, { id: item.id, ...cardItem(), ...extra, priceCents: price }, { payments: [{ key: "p1", dueDate: "2026-11-10", amountCents: price, method: "PIX" }] });

    // salvar de novo sem mudar nada não refaz a compra
    await updateSale(env.admin, r.id, input({}));
    await updateSale(env.admin, r.id, input({}));
    let p = await costPayable(r.id);
    expect(p.settlements).toHaveLength(1);
    expect(p.settlements[0].reversedAt).toBeNull();

    // custo 900 → 1.200: estorna e lança de novo
    await updateSale(env.admin, r.id, input({ costCents: 120000 }, 150000));
    p = await costPayable(r.id);
    expect(p.settlements.filter((s) => s.reversedAt)).toHaveLength(1);
    expect(p.settlements.filter((s) => !s.reversedAt).map((s) => s.amountCents)).toEqual([120000]);
    expect(await activeBillsTotal()).toBe(120000);

    // 3x → 1x: tudo numa fatura
    await updateSale(env.admin, r.id, input({ costCents: 120000, supplierCardInstallments: 1 }, 150000));
    expect((await bills(env.company.id)).map((b) => b.amountCents)).toEqual([120000]);

    // para faturado: estorna e a conta fica pendente com boleto
    await updateSale(env.admin, r.id, input({ costCents: 120000, supplierPayment: "FATURADO" }, 150000));
    p = await costPayable(r.id);
    expect(p).toMatchObject({ status: "PENDENTE", method: "BOLETO", settledCents: 0 });
    expect(await bills(env.company.id)).toHaveLength(0);
  });

  it("baixa manual parcial antes: o cartão recebe só o saldo e a baixa manual fica", async () => {
    const r = await createSale(env.admin, sale(env, { supplierPayment: "FATURADO" }));
    const p0 = await costPayable(r.id);
    await settleEntry(env.fin, "payable", p0.id, { date: "2026-11-04", amountCents: 20000, accountId: env.account.id });
    const [item] = await itemsOf(r.id);
    await updateSale(env.admin, r.id, sale(env, { id: item.id, ...cardItem({ supplierCardInstallments: 1 }) }));
    const p = await costPayable(r.id);
    expect(p.status).toBe("PAGO");
    expect(p.settlements.map((s) => [s.accountId, s.amountCents, s.reversedAt])).toEqual([
      [env.account.id, 20000, null],
      [cardId, 70000, null],
    ]);
    // reverte para não atrapalhar os próximos testes
    await updateSale(env.admin, r.id, sale(env, { id: item.id, supplierPayment: "FATURADO" }));
    expect((await costPayable(r.id)).settledCents).toBe(20000);
  });

  it("fatura já paga: editar o custo falha e nada muda; venda nova fica pendente com aviso", async () => {
    const own = await makeCompany("Fatura paga");
    const card = await saveAccount(own.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
    const r = await createSale(own.admin, sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card }));
    const [bill] = await bills(own.company.id);
    await settleEntry(own.fin, "payable", bill.id, { date: "2026-11-12", amountCents: bill.amountCents, accountId: own.account.id });
    const [item] = await itemsOf(r.id);
    await expect(
      updateSale(own.admin, r.id, sale(own, { id: item.id, supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card, costCents: 80000 })),
    ).rejects.toThrow(/já foi paga/);
    expect((await itemsOf(r.id))[0].costCents).toBe(90000);
    expect((await costPayable(r.id)).settlements.filter((s) => !s.reversedAt)).toHaveLength(1);

    // nova venda que cairia na mesma fatura (paga): não falha, fica pendente e avisa
    const r2 = await createSale(own.seller, sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card }));
    expect(r2.warnings.join(" ")).toMatch(/nov\/2026 do cartão "Izabel" já está paga/);
    const p2 = await costPayable(r2.id);
    expect(p2).toMatchObject({ status: "PENDENTE", method: "CARTAO_CREDITO" });
    expect(p2.settlements).toHaveLength(0);
  });

  it("produto removido na edição: a compra sai do cartão e a conta é cancelada", async () => {
    const r = await createSale(env.admin, {
      ...sale(env, cardItem()),
      items: [
        { productType: "HOTEL", description: "Hotel", supplierId: env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: 120000, costCents: 90000, supplierCommissionCents: 0, ...cardItem() },
        { productType: "SEGURO", description: "Seguro", supplierId: env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: 10000, costCents: 5000, supplierCommissionCents: 0 },
      ],
      payments: [{ key: "p1", dueDate: "2026-11-10", amountCents: 130000, method: "PIX" }],
    });
    const [hotel, seguro] = await itemsOf(r.id);
    const hotelPayable = await prisma.payable.findFirstOrThrow({ where: { sourceKey: `item:${hotel.id}:custo` } });
    expect(hotelPayable.status).toBe("PAGO");
    await updateSale(env.admin, r.id, {
      ...sale(env),
      items: [{ id: seguro.id, productType: "SEGURO", description: "Seguro", supplierId: env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: 10000, costCents: 5000, supplierCommissionCents: 0 }],
      payments: [{ key: "p1", dueDate: "2026-11-10", amountCents: 10000, method: "PIX" }],
    });
    const after = await prisma.payable.findUniqueOrThrow({ where: { id: hotelPayable.id }, include: { settlements: true } });
    expect(after.status).toBe("CANCELADO");
    expect(after.settlements.every((s) => s.reversedAt)).toBe(true);
    expect(await bills(env.company.id)).toHaveLength(0);
  });

  it("conta já numa fatura de fornecedor: mudar para cartão dá erro claro", async () => {
    const r = await createSale(env.admin, sale(env, { supplierPayment: "FATURADO" }));
    const p = await costPayable(r.id);
    const inv = await prisma.supplierInvoice.create({ data: { companyId: env.company.id, supplierId: env.supplier.id, number: `F-${r.id.slice(-4)}`, issueDate: "2026-11-05", dueDate: "2026-12-10", status: "ABERTA", declaredCents: p.amountCents } });
    await prisma.payable.update({ where: { id: p.id }, data: { invoiceId: inv.id } });
    const [item] = await itemsOf(r.id);
    await expect(updateSale(env.admin, r.id, sale(env, { id: item.id, ...cardItem() }))).rejects.toThrow(/já está na fatura do fornecedor/);
    expect((await itemsOf(r.id))[0].supplierPayment).toBe("FATURADO");
  });

  it("cancelar: sem a opção mantém a compra; com a opção tira do cartão", async () => {
    const keep = await createSale(env.admin, sale(env, cardItem()));
    const k = await cancelSale(env.admin, keep.id, "cliente desistiu");
    expect(k.warnings.join(" ")).toMatch(/compra no cartão Izabel mantida na fatura/);
    expect((await costPayable(keep.id)).status).toBe("PAGO");
    expect(await activeBillsTotal()).toBe(90000);

    const out = await createSale(env.admin, sale(env, cardItem()));
    expect(await activeBillsTotal()).toBe(180000);
    await cancelSale(env.admin, out.id, "fornecedor estornou", { reverseCardCharges: true });
    const p = await costPayable(out.id);
    expect(p.status).toBe("CANCELADO");
    expect(p.settlements.every((s) => s.reversedAt)).toBe(true);
    expect(await activeBillsTotal()).toBe(90000);
  });

  it("cancelar com a opção, mas fatura paga: compra mantida e aviso de reembolso", async () => {
    const own = await makeCompany("Cancelar fatura paga");
    const card = await saveAccount(own.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
    const r = await createSale(own.admin, sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card }));
    const [bill] = await bills(own.company.id);
    await settleEntry(own.fin, "payable", bill.id, { date: "2026-11-12", amountCents: bill.amountCents, accountId: own.account.id });
    const c = await cancelSale(own.admin, r.id, "desistiu", { reverseCardCharges: true });
    expect(c.warnings.join(" ")).toMatch(/fatura paga e foi mantida\. Lance o reembolso/);
    expect((await costPayable(r.id)).status).toBe("PAGO");
  });

  it("estorno manual no financeiro: o produto passa a faturado e não volta para o cartão", async () => {
    const r = await createSale(env.admin, sale(env, cardItem()));
    const p = await costPayable(r.id);
    await reverseSettlement(env.fin, p.settlements[0].id, "lançado no cartão errado");
    const [item] = await itemsOf(r.id);
    expect(item.supplierPayment).toBe("FATURADO");
    await updateSale(env.admin, r.id, sale(env, { id: item.id, supplierPayment: "FATURADO" }));
    expect(await costPayable(r.id)).toMatchObject({ status: "PENDENTE", method: "BOLETO" });
  });

  it("duplicar copia a forma de pagar e a cópia nasce rascunho, sem baixa", async () => {
    const r = await createSale(env.admin, sale(env, cardItem()));
    const d = await duplicateSale(env.admin, r.id);
    const [item] = await itemsOf(d.id);
    expect(item).toMatchObject({ supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: cardId, supplierCardInstallments: 3 });
    expect(await prisma.payable.count({ where: { saleId: d.id } })).toBe(0);
  });

  it("cardOptions: vendedor vê só nome e dias dos cartões ativos", async () => {
    await prisma.financialAccount.create({ data: { companyId: env.company.id, name: "Sem dias", type: "CARTAO_CREDITO" } });
    const opts = await cardOptions(env.seller);
    expect(opts.map((o) => [o.name, o.ready])).toEqual([
      ["Izabel", true],
      ["Sem dias", false],
    ]);
    expect(Object.keys(opts[0]).sort()).toEqual(["closingDay", "dueDay", "id", "name", "ready"]);
  });
});

describe("correções: fornecedor no cartão e forma prevista", () => {
  const setupCard = async (name: string) => {
    const own = await makeCompany(name);
    const card = await saveAccount(own.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
    return { own, card };
  };

  it("venda cancelada mantendo a compra e estornada depois no financeiro: a conta é cancelada, não reaberta", async () => {
    const { own, card } = await setupCard("Estorno de venda cancelada");
    const r = await createSale(own.admin, sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card }));
    await cancelSale(own.admin, r.id, "cliente desistiu");
    const p = await costPayable(r.id);
    expect(p.status).toBe("PAGO");
    await reverseSettlement(own.fin, p.settlements[0].id, "fornecedor estornou no cartão");
    const after = await costPayable(r.id);
    expect(after.status).toBe("CANCELADO");
    expect(await bills(own.company.id)).toHaveLength(0);
    expect((await itemsOf(r.id))[0].supplierPayment).toBe("CARTAO_AGENCIA");
  });

  it("produto no cartão sem data: a data da compra fica gravada e mudar só a data da venda não refaz nem trava", async () => {
    const { own, card } = await setupCard("Data da compra no cartão");
    const r = await createSale(own.admin, sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card }));
    const [item] = await itemsOf(r.id);
    expect(item.supplierDueDate).toBe("2026-11-03");
    const [bill] = await bills(own.company.id);
    await settleEntry(own.fin, "payable", bill.id, { date: "2026-11-12", amountCents: bill.amountCents, accountId: own.account.id });
    await updateSale(
      own.admin,
      r.id,
      sale(own, { id: item.id, supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card, supplierDueDate: item.supplierDueDate }, { saleDate: "2026-10-28" }),
    );
    const p = await costPayable(r.id);
    expect(p.settlements).toHaveLength(1);
    expect(p.settlements[0].reversedAt).toBeNull();
  });

  it("duplicar venda com cartão desativado: a cópia nasce sem cartão", async () => {
    const { own, card } = await setupCard("Duplicar cartão desativado");
    const r = await createSale(own.admin, sale(own, { supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: card }));
    await prisma.financialAccount.update({ where: { id: card }, data: { active: false } });
    const d = await duplicateSale(own.admin, r.id);
    const [item] = await itemsOf(d.id);
    expect(item).toMatchObject({ supplierPayment: "CARTAO_AGENCIA", supplierCardAccountId: null });
  });

  it("forma prevista ajustada pelo financeiro fica; muda só quando a forma de pagar o fornecedor muda na venda", async () => {
    const own = await makeCompany("Forma prevista");
    const r = await createSale(own.admin, sale(own, { supplierPayment: "FATURADO" }));
    const p = await costPayable(r.id);
    expect(p.method).toBe("BOLETO");
    await prisma.payable.update({ where: { id: p.id }, data: { method: "PIX" } });
    const [item] = await itemsOf(r.id);
    await updateSale(own.admin, r.id, sale(own, { id: item.id, supplierPayment: "FATURADO" }, { locator: "NOVO01" }));
    expect((await costPayable(r.id)).method).toBe("PIX");
    await updateSale(own.admin, r.id, sale(own, { id: item.id, supplierPayment: "A_VISTA", supplierPayMethod: "DEBITO_CONTA" }, { locator: "NOVO01" }));
    expect((await costPayable(r.id)).method).toBe("DEBITO_CONTA");
  });
});
