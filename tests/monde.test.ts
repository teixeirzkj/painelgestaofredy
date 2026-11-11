/** Monde (API v3): conexão, clientes e vendas com o financeiro. API simulada; nenhuma chamada real. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { connectMonde, importMondeBatch, importMondeSalesBatch, mapMondePerson, mapPaymentMethod, restartMondeImport, restartMondeSalesImport, IMPORT_ACCOUNT_NAME } from "@/server/services/monde";
import { makeCompany } from "./helpers";

const TOKEN = "credencial-de-teste-1234567890";
const people: Record<string, object> = {
  "p-cli": { id: "p-cli", person_kind: "individual", name: "Carla Monde", cpf_cnpj: "39053344705", birthdate: "1980-01-20", gender: "female", mobile_number: "(41) 99999-1111", email: "carla@x.com", passport_number: "AB123456", passport_expiration_date: "2030-05-01", address: { street: "Rua das Flores", street_number: "10", postal_code: "80000000", city: { id: "c1" } } },
  "p-sell": { id: "p-sell", person_kind: "individual", name: "Vendedora" },
  "p-air": { id: "p-air", person_kind: "company", name: "Gol", legal_name: "Gol Linhas Aéreas", airline: { code: "G3" } },
  "p-op": { id: "p-op", person_kind: "company", name: "Operadora Monde", legal_name: "Operadora Monde Ltda", cpf_cnpj: "11444777000161" },
  "p-for": { id: "p-for", person_kind: "individual", name: "John Smith", foreigner: true, foreign_identity_document: "V123456-7", passport_number: "X1234567" },
};
const bills: Record<string, object> = {
  b1: { id: "b1", amount: 2500, due_date: "2026-10-05", settlement_date: "2026-10-05", canceled: false, payment_method: { id: "pm-pix" } },
  b2: { id: "b2", amount: 2500, due_date: "2026-11-10", settlement_date: null, canceled: false, payment_method: { id: "pm-cc" } },
  b3: { id: "b3", amount: 1100, due_date: "2026-12-01", settlement_date: null, canceled: false, payment_method: { id: "pm-pix" } },
  vb1: { id: "vb1", amount: 4500, due_date: "2026-11-30", settlement_date: "2026-11-01", canceled: false },
};
const sales: Record<string, object> = {
  v1: {
    id: "v1",
    sale_number: 101,
    sale_date: "2026-10-01",
    departure_date: "2026-12-10",
    return_date: "2026-12-20",
    status: "closed",
    seller: { id: "s1" },
    payer: { id: "p-cli" },
    travel_packages: [
      { id: "pp1", status: "active", package_name: "Disney", begin_date: "2026-12-10", currency: "BRL", commission_amount: 500, over: 0, totals: { customer_amount: 5000 }, supplier: { id: "p-op" }, passengers: [{ person: { id: "p-cli" } }, { person: { id: "p-for" } }] },
    ],
    airline_tickets: [
      {
        id: "pa1",
        status: "active",
        locator: "ABC123",
        currency: "BRL",
        commission_amount: 0,
        totals: { customer_amount: 1200, rav_fee: 100 },
        supplier: { id: "p-air" },
        segments: [{ airline_code: "LA", flight_number: "8084", origin: "CWB", destination: "MCO", departure_date: "2026-12-10T08:00:00", arrival_date: "2026-12-10T16:30:00" }],
        passengers: [{ person: { id: "p-cli" } }],
      },
    ],
    payments: { agency: { bills: [{ id: "b1" }, { id: "b2" }] }, vendor: { credit_card: [{ id: "vc1", products: [{ sale_product: { id: "pa1" }, amount: 1200 }] }] } },
    commissions: [{ amount: 150, balance: 0, person: { id: "p-sell" } }],
    financial: { vendor_items: [{ kind: "invoice", amount: 4500, due_date: "2026-11-30", sale_product: { id: "pp1" }, bill: { id: "vb1" } }] },
  },
  v2: { id: "v2", sale_number: 102, sale_date: "2026-10-02", payer: { id: "p-cli" }, hotels: [{ id: "h1", status: "canceled", totals: { customer_amount: 900 } }] },
  v3: {
    id: "v3",
    sale_number: 103,
    sale_date: "2026-10-03",
    payer: { id: "p-cli" },
    travel_packages: [{ id: "pp3", status: "active", package_name: "Gramado", totals: { customer_amount: 1000 }, commission_amount: 100, supplier: { id: "p-op" } }],
    payments: { agency: { bills: [{ id: "b3" }] } },
  },
  v4: { id: "v4", sale_number: 104, sale_date: "2026-10-04", travel_packages: [{ id: "pp4", status: "active", totals: { customer_amount: 700 } }] },
};

function fakeMonde() {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const page = (data: unknown[], next: string | null = null) => json({ data, pagination: { size: 20, has_next_page: !!next, next_cursor: next } });
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (new Headers(init?.headers).get("content-type") !== "application/json") return json({ errors: ["O cabeçalho Content-Type da requisição especificou um tipo de mídia que não é suportado pela API."] }, 415);
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN}`) return json({ errors: ["Credencial inválida"] }, 401);
    const path = url.pathname.replace("/api/v3", "");
    const cursor = url.searchParams.get("cursor");
    if (path === "/companies") return page([{ id: "e1", name: "Agência Monde" }]);
    if (path === "/sellers") return page([{ id: "s1", person: { id: "p-sell" } }]);
    if (path === "/payment_methods") return page([{ id: "pm-pix", name: "PIX" }, { id: "pm-cc", name: "Cartão de Crédito" }]);
    if (path === "/cities/c1") return json({ id: "c1", name: "Curitiba", state: { acronym: "PR" } });
    if (path === "/people") return cursor ? page([people["p-for"]]) : page([people["p-cli"], people["p-sell"], people["p-air"]], "pg2");
    if (path.startsWith("/people/")) return people[path.slice(8)] ? json(people[path.slice(8)]) : json({ errors: ["não encontrado"] }, 404);
    if (path.startsWith("/bills/")) return bills[path.slice(7)] ? json(bills[path.slice(7)]) : json({ errors: ["não encontrado"] }, 404);
    if (path === "/sales") return cursor ? page([{ id: "v3", sale_number: 103 }, { id: "v4", sale_number: 104 }]) : page([{ id: "v1", sale_number: 101 }, { id: "v2", sale_number: 102 }], "pg2");
    if (path.startsWith("/sales/")) return sales[path.slice(7)] ? json(sales[path.slice(7)]) : json({ errors: ["não encontrado"] }, 404);
    return json({ errors: ["rota não simulada"] }, 404);
  });
}

describe("Monde (API v3)", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  beforeAll(async () => {
    env = await makeCompany("Monde v3");
    process.env.MONDE_SPACING_MS = "0";
    vi.stubGlobal("fetch", fakeMonde());
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.MONDE_SPACING_MS;
  });

  it("valida a credencial antes de salvar e guarda criptografada", async () => {
    await expect(connectMonde(env.admin, { token: "curta" })).rejects.toThrow(/credencial/i);
    await expect(connectMonde(env.admin, { token: "credencial-errada-1234567890" })).rejects.toThrow(/recusou a credencial/);
    await expect(connectMonde(env.seller, { token: TOKEN })).rejects.toThrow();
    await connectMonde(env.admin, { token: `Bearer ${TOKEN}` });
    const m = await prisma.mondeIntegration.findUniqueOrThrow({ where: { companyId: env.company.id } });
    expect(m.passwordEnc).not.toContain(TOKEN);
    expect(m.login).toContain("Agência Monde");
  });

  it("importa clientes de todas as páginas, sem vendedores nem companhias aéreas, e não duplica", async () => {
    await restartMondeImport(env.admin);
    const r = await importMondeBatch(env.admin);
    expect(r).toMatchObject({ done: true, created: 2 });
    const carla = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, mondeId: "p-cli" } });
    expect(carla).toMatchObject({ name: "Carla Monde", document: "39053344705", gender: "F", city: "Curitiba", state: "PR", street: "Rua das Flores", passportNumber: "AB123456" });
    const john = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, mondeId: "p-for" } });
    expect(john).toMatchObject({ foreigner: true, rne: "V123456-7" });
    expect(await prisma.client.count({ where: { companyId: env.company.id, mondeId: { in: ["p-sell", "p-air"] } } })).toBe(0);
    await restartMondeImport(env.admin);
    expect((await importMondeBatch(env.admin)).created).toBe(0);
  });

  it("importa as vendas com parcelas, fornecedores e comissão, e dá baixa no que já está pago", async () => {
    await restartMondeSalesImport(env.admin);
    const r = await importMondeSalesBatch(env.admin);
    expect(r).toMatchObject({ done: true, created: 2, skipped: 1, failed: 1 });

    const s1 = await prisma.sale.findFirstOrThrow({ where: { companyId: env.company.id, externalRef: "monde:v1" }, include: { items: { orderBy: { sortOrder: "asc" } }, passengers: true, seller: true } });
    expect(s1).toMatchObject({ origin: "MONDE", status: "CONFIRMADA", saleDate: "2026-10-01", tripStart: "2026-12-10", tripEnd: "2026-12-20", clientPayableCents: 500000, sellerCommissionCents: 15000 });
    expect(s1.seller.name).toBe("Vendedora");
    expect(s1.notes).toContain("venda nº 101");
    expect(await prisma.flightSegment.findMany({ where: { saleId: s1.id }, select: { airline: true, flightNumber: true, origin: true, destination: true, departureAt: true, arrivalAt: true, source: true } })).toEqual([
      { airline: "LA", flightNumber: "8084", origin: "CWB", destination: "MCO", departureAt: "2026-12-10T08:00", arrivalAt: "2026-12-10T16:30", source: "MONDE" },
    ]);
    expect(s1.passengers.map((p) => p.name).sort()).toEqual(["Carla Monde", "John Smith"]);
    const pkg = s1.items.find((i) => i.productType === "PACOTE");
    const air = s1.items.find((i) => i.productType === "AEREO");
    expect(pkg).toMatchObject({ productType: "PACOTE", commercialModel: "INTERMEDIACAO", priceCents: 500000, costCents: 450000, supplierPayment: "FATURADO" });
    expect(air).toMatchObject({ productType: "AEREO", commercialModel: "COMISSAO", priceCents: 110000, ravCents: 10000, locator: "ABC123", supplierPayment: "CLIENTE_DIRETO" });

    // parcelas: a paga no Monde entra paga, na conta das baixas importadas
    const recs = await prisma.receivable.findMany({ where: { saleId: s1.id, origin: "VENDA" }, orderBy: { dueDate: "asc" } });
    expect(recs.map((x) => [x.amountCents, x.status, x.method])).toEqual([
      [250000, "PAGO", "PIX"],
      [250000, "PENDENTE", "CARTAO_CREDITO"],
    ]);
    const account = await prisma.financialAccount.findFirstOrThrow({ where: { companyId: env.company.id, name: IMPORT_ACCOUNT_NAME } });
    expect(await prisma.settlement.count({ where: { accountId: account.id, receivableId: recs[0].id, date: "2026-10-05" } })).toBe(1);
    // fornecedor do pacote liquidado no Monde; comissão do vendedor com saldo zero
    const cost = await prisma.payable.findFirstOrThrow({ where: { saleId: s1.id, origin: "CUSTO_VENDA" }, include: { supplier: true } });
    expect(cost).toMatchObject({ amountCents: 450000, status: "PAGO" });
    expect(cost.supplier).toMatchObject({ name: "Operadora Monde", mondeId: "p-op" });
    expect((await prisma.payable.findFirstOrThrow({ where: { sourceKey: `comissao:${s1.id}` } })).status).toBe("PAGO");
    // RAV do aéreo (cliente pagou direto à cia) continua a receber
    expect((await prisma.receivable.findFirstOrThrow({ where: { saleId: s1.id, origin: "COMISSAO_FORNECEDOR" } })).status).toBe("PENDENTE");
    // venda importada não gera contrato nem evento para integrações
    expect(await prisma.contract.count({ where: { saleId: s1.id } })).toBe(0);
    expect(await prisma.automationEvent.count({ where: { companyId: env.company.id, type: "venda.confirmada" } })).toBe(0);

    // parcelas maiores que os produtos: a diferença vira taxa da venda
    const s3 = await prisma.sale.findFirstOrThrow({ where: { companyId: env.company.id, externalRef: "monde:v3" } });
    expect(s3).toMatchObject({ feesCents: 10000, clientPayableCents: 110000 });
    expect(s3.notes).toMatch(/Ajuste de taxa/);

    const m = await prisma.mondeIntegration.findUniqueOrThrow({ where: { companyId: env.company.id } });
    const errors = JSON.parse(m.salesErrorsJson);
    expect(errors.find((e: { numero: number }) => e.numero === 104).motivo).toMatch(/pagante/);
    expect(errors.find((e: { numero: number }) => e.numero === 102).motivo).toMatch(/ignorada/);
  });

  it("importar de novo não duplica", async () => {
    await restartMondeSalesImport(env.admin);
    const r = await importMondeSalesBatch(env.admin);
    expect(r).toMatchObject({ done: true, created: 0 });
    expect(await prisma.sale.count({ where: { companyId: env.company.id, origin: "MONDE" } })).toBe(2);
  });

  it("traduz formas de pagamento e pessoas", () => {
    expect(["Pix", "Boleto Bancário", "Cartão de Crédito", "Cartão de Débito", "Transferência", "Dinheiro", "Débito em conta", "Vale-viagem"].map(mapPaymentMethod)).toEqual([
      "PIX",
      "BOLETO",
      "CARTAO_CREDITO",
      "CARTAO_DEBITO",
      "TRANSFERENCIA",
      "DINHEIRO",
      "DEBITO_CONTA",
      "OUTRO",
    ]);
    expect(mapMondePerson({ id: "x", person_kind: "company", name: "Fantasia", legal_name: "Razão Ltda" })).toMatchObject({ name: "Razão Ltda", tradeName: "Fantasia", foreigner: false });
  });
});
