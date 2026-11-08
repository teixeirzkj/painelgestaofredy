/** Contrato da viagem: um contrato só para as vendas confirmadas da mesma viagem. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { cancelSale, createSale, getSale, listSales, updateSale } from "@/server/services/sales";
import { createTrip, getTrip, linkSaleToTrip } from "@/server/services/trips";
import {
  applySignatureCallback,
  cancelContract,
  createSuggestedTemplates,
  effectiveContract,
  generateTripContract,
  getContract,
  issueContract,
  listContracts,
  prepareContractForSale,
  refreshContract,
  reopenContract,
  splitTripContract,
  tripContractCovers,
} from "@/server/services/contracts";
import { contractPdf } from "@/server/services/contract-pdf";
import { attachSale, loadFlow, markFlow, startFlow } from "@/server/services/balcao";
import { setAutomationEnabled } from "@/server/services/automations";
import { sendContractToZapSign, syncZapSignDocument } from "@/server/services/zapsign";
import type { Ctx } from "@/server/context";
import { formatBRL } from "@/lib/money";
import { exampleSale, makeCompany } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>> & { hotel: { id: string }; seguradora: { id: string } };

async function setup(name: string): Promise<Env> {
  const env = await makeCompany(name);
  await createSuggestedTemplates(env.admin);
  const hotel = await prisma.supplier.create({ data: { companyId: env.company.id, name: "Hotel Mar Azul", category: "HOTEL" } });
  const seguradora = await prisma.supplier.create({ data: { companyId: env.company.id, name: "Seguros Bem", category: "OUTROS" } });
  return { ...env, hotel, seguradora };
}

type Opts = { tripId?: string | null; saleDate?: string; productType?: string; supplierId?: string; price?: number; passengers?: { name: string; document?: string }[]; destination?: string; confirm?: boolean };

function saleInput(env: Env, o: Opts = {}) {
  const price = o.price ?? 100000;
  return exampleSale(env.client.id, env.supplier.id, {
    saleDate: o.saleDate ?? "2026-11-01",
    tripId: o.tripId ?? null,
    destination: o.destination ?? "Lisboa",
    commission: { mode: "VALOR", amountCents: 0 },
    passengerCount: o.passengers?.length || 1,
    items: [{ productType: o.productType ?? "AEREO", description: `Produto ${o.productType ?? "AEREO"}`, supplierId: o.supplierId ?? env.supplier.id, commercialModel: "INTERMEDIACAO", priceCents: price, costCents: Math.round(price * 0.8), supplierCommissionCents: 0, supplierDueDate: "2026-12-10" }],
    payments: [{ key: "p1", dueDate: "2026-11-20", amountCents: price, method: "PIX" }],
    passengers: o.passengers ?? [],
    confirm: o.confirm ?? true,
  });
}

const mkSale = async (env: Env, ctx: Ctx, o: Opts) => (await createSale(ctx, saleInput(env, o))).id;
const tripContractOf = (env: Env, tripId: string) => prisma.contract.findUnique({ where: { companyId_tripId: { companyId: env.company.id, tripId } } });
const ownContracts = (saleId: string) => prisma.contract.findMany({ where: { saleId, tripId: null } });

async function tripWith3(env: Env, ctx: Ctx = env.admin) {
  const trip = await createTrip(ctx, { clientId: env.client.id, title: "Férias em Portugal", destination: "Portugal" });
  const s1 = await mkSale(env, ctx, { tripId: trip.id, saleDate: "2026-11-01", productType: "AEREO", price: 300000, passengers: [{ name: "Maria Cliente", document: "52998224725" }, { name: "João Filho" }] });
  const s2 = await mkSale(env, ctx, { tripId: trip.id, saleDate: "2026-11-02", productType: "HOTEL", supplierId: env.hotel.id, price: 200000, passengers: [{ name: "Maria Cliente", document: "52998224725" }] });
  const s3 = await mkSale(env, ctx, { tripId: trip.id, saleDate: "2026-11-03", productType: "SEGURO", supplierId: env.seguradora.id, price: 50000, passengers: [{ name: "João Filho" }] });
  return { trip, s1, s2, s3 };
}

describe("gerar o contrato da viagem", () => {
  let env: Env;
  beforeAll(async () => {
    env = await setup("Contrato da viagem");
  });

  it("junta 3 vendas de produtos e fornecedores diferentes em um contrato só", async () => {
    const { trip, s1, s2, s3 } = await tripWith3(env);
    // antes: cada venda tem o contrato próprio
    expect((await ownContracts(s2)).length).toBe(1);
    const { id } = await generateTripContract(env.admin, trip.id);
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ tripId: trip.id, saleId: s1, status: "EM_PREPARACAO" });
    expect(JSON.parse(c.saleIdsJson)).toEqual([s1, s2, s3]);
    expect(await ownContracts(s2)).toHaveLength(0);
    expect(await ownContracts(s3)).toHaveLength(0);
    const text = c.content!;
    for (const name of ["Operadora X", "Hotel Mar Azul", "Seguros Bem"]) expect(text).toContain(name);
    expect(text).toContain(formatBRL(550000));
    expect(text).toContain("Passagem aérea:");
    expect(text).toContain("Hospedagem:");
    expect(text).toContain("Seguro viagem:"); // seguro usa as cláusulas de "Outros serviços"
    expect(text.match(/- Maria Cliente/g)).toHaveLength(1); // passageiros sem repetição
    expect(text.match(/- João Filho/g)).toHaveLength(1);
    expect(text).toMatch(/Venda V-\d{4}-\d{4} \(Hospedagem\):/);
    // os contratos que saíram ficam guardados na auditoria, com o texto
    const logs = await prisma.auditLog.findMany({ where: { companyId: env.company.id, action: "contrato.substituido_pela_viagem" } });
    expect(logs).toHaveLength(3); // as 3 vendas tinham contrato próprio (a base também ganha o da viagem)
    expect(JSON.parse(logs[0].dataJson!).content).toBeTruthy();
    // telas
    const t = await getTrip(env.admin, trip.id);
    expect(t.tripContract?.id).toBe(id);
    expect(t.coveredSaleIds.sort()).toEqual([s1, s2, s3].sort());
    expect(t.canGenerateTripContract).toBe(false);
    const sale2 = await getSale(env.admin, s2);
    expect(sale2.contracts).toHaveLength(0);
    expect(sale2.trip?.contracts[0]?.id).toBe(id);
    const list = await listSales(env.admin, { tripId: trip.id });
    expect(list.items.find((x) => x.id === s2)).toMatchObject({ contractStatus: "EM_PREPARACAO", inTripContract: true });
    // não gera duas vezes
    await expect(generateTripContract(env.admin, trip.id)).rejects.toThrow(/já tem contrato/);
  });

  it("recusa com menos de 2 vendas confirmadas", async () => {
    const trip = await createTrip(env.admin, { clientId: env.client.id, title: "Só uma venda" });
    await mkSale(env, env.admin, { tripId: trip.id });
    await mkSale(env, env.admin, { tripId: trip.id, confirm: false }); // rascunho não conta
    await expect(generateTripContract(env.admin, trip.id)).rejects.toThrow(/pelo menos 2 vendas confirmadas/);
  });

  it("venda com contrato já enviado fica de fora e mantém o contrato dela", async () => {
    const { trip, s1, s2, s3 } = await tripWith3(env);
    const own3 = (await ownContracts(s3))[0];
    await refreshContract(env.admin, own3.id);
    await issueContract(env.admin, own3.id);
    await applySignatureCallback({ companyId: env.company.id, contractId: own3.id, externalId: "ext-1", provider: "TESTE", event: "sent" });
    const { id } = await generateTripContract(env.admin, trip.id);
    const c = await getContract(env.admin, id);
    expect(JSON.parse(c.saleIdsJson)).toEqual([s1, s2]);
    expect(c.tripSales.outside.map((s) => s.id)).toEqual([s3]);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: own3.id } })).status).toBe("ENVIADO");
  });
});

describe("permissões do contrato da viagem", () => {
  let env: Env;
  beforeAll(async () => {
    env = await setup("Contrato da viagem - permissões");
  });

  it("vendedor não gera com venda de outro vendedor; quem tem venda na viagem vê o contrato; os outros não", async () => {
    const trip = await createTrip(env.seller, { clientId: env.client.id, title: "Viagem dividida" });
    await mkSale(env, env.seller, { tripId: trip.id, saleDate: "2026-11-01" });
    await mkSale(env, env.seller2, { tripId: trip.id, saleDate: "2026-11-02", productType: "HOTEL" });
    await expect(generateTripContract(env.seller, trip.id)).rejects.toThrow(/outro vendedor/);
    const { id } = await generateTripContract(env.admin, trip.id);
    // vendedor2 é dono da venda que não é a base e enxerga o contrato inteiro
    expect((await getContract(env.seller2, id)).tripId).toBe(trip.id);

    const trip2 = await createTrip(env.seller, { clientId: env.client.id, title: "Só da vendedora" });
    await mkSale(env, env.seller, { tripId: trip2.id, saleDate: "2026-11-01" });
    await mkSale(env, env.seller, { tripId: trip2.id, saleDate: "2026-11-02", productType: "HOTEL" });
    const r = await generateTripContract(env.seller, trip2.id);
    await expect(getContract(env.seller2, r.id)).rejects.toThrow(/não encontrado/);
  });
});

describe("contrato da viagem acompanha as vendas", () => {
  let env: Env;
  beforeAll(async () => {
    env = await setup("Contrato da viagem - sincronia");
  });

  it("venda nova entra no contrato em preparação; emitido fica desatualizado; enviado: venda nova tem contrato próprio", async () => {
    const { trip, s1, s2 } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    const s4 = await mkSale(env, env.admin, { tripId: trip.id, saleDate: "2026-11-04", productType: "TRANSFER", price: 10000 });
    expect(await ownContracts(s4)).toHaveLength(0);
    let c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    const code4 = (await prisma.sale.findUniqueOrThrow({ where: { id: s4 } })).code;
    expect(c.content).toContain(code4);
    expect(JSON.parse(c.saleIdsJson)).toHaveLength(4);

    await issueContract(env.admin, id);
    const s5 = await mkSale(env, env.admin, { tripId: trip.id, saleDate: "2026-11-05", productType: "PASSEIO", price: 10000 });
    expect(await ownContracts(s5)).toHaveLength(0);
    c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ status: "AGUARDANDO_ENVIO", outdated: true, saleId: s1 });

    // atualizar e emitir de novo inclui a venda 5
    await refreshContract(env.admin, id);
    await issueContract(env.admin, id);
    c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ version: 2, outdated: false });
    expect(JSON.parse(c.saleIdsJson)).toHaveLength(5);

    await applySignatureCallback({ companyId: env.company.id, contractId: id, externalId: "ext-v", provider: "TESTE", event: "sent" });
    const s6 = await mkSale(env, env.admin, { tripId: trip.id, saleDate: "2026-11-06", productType: "LOCACAO", price: 10000 });
    expect(await ownContracts(s6)).toHaveLength(1);
    c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c.outdated).toBe(false); // a venda 6 ficou de fora: o contrato enviado continua valendo para as outras
    // venda que está no contrato enviado e é alterada: continua nele, que fica desatualizado (não ganha contrato próprio)
    await updateSale(env.admin, s2, saleInput(env, { tripId: trip.id, saleDate: "2026-11-02", productType: "HOTEL", supplierId: env.hotel.id, price: 210000 }));
    expect(await ownContracts(s2)).toHaveLength(0);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).outdated).toBe(true);
  });

  it("tirar a venda-base da viagem: a base passa para a próxima e ela volta a ter contrato próprio", async () => {
    const { trip, s1, s2, s3 } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    await linkSaleToTrip(env.admin, null, s1);
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c.saleId).toBe(s2);
    expect(JSON.parse(c.saleIdsJson)).toEqual([s2, s3]);
    const code1 = (await prisma.sale.findUniqueOrThrow({ where: { id: s1 } })).code;
    expect(c.content).not.toContain(code1);
    expect(await ownContracts(s1)).toHaveLength(1);
    // e volta para a viagem: entra de novo no contrato da viagem
    await linkSaleToTrip(env.admin, trip.id, s1);
    expect(await ownContracts(s1)).toHaveLength(0);
    expect(JSON.parse((await prisma.contract.findUniqueOrThrow({ where: { id } })).saleIdsJson)).toEqual([s1, s2, s3]);
  });

  it("cancelar a venda-base não cancela o contrato da viagem; cancelar todas tira o contrato", async () => {
    const { trip, s1, s2, s3 } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    await issueContract(env.admin, id);
    await cancelSale(env.admin, s1, "cliente desistiu do aéreo");
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ status: "AGUARDANDO_ENVIO", saleId: s2, outdated: true });
    await cancelSale(env.admin, s2, "desistiu");
    await cancelSale(env.admin, s3, "desistiu");
    // nunca foi enviado ao cliente: some, com o texto na auditoria
    expect(await tripContractOf(env, trip.id)).toBeNull();
    expect(await prisma.auditLog.count({ where: { companyId: env.company.id, action: "contrato_viagem.removido", entityId: trip.id } })).toBe(1);
  });

  it("venda coberta trocada de viagem na edição: o contrato da viagem antiga é refeito sem ela", async () => {
    const { trip, s1, s2, s3 } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    const other = await createTrip(env.admin, { clientId: env.client.id, title: "Outra viagem" });
    await updateSale(env.admin, s3, saleInput(env, { tripId: other.id, saleDate: "2026-11-03", productType: "SEGURO", supplierId: env.seguradora.id, price: 50000 }));
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(c.saleIdsJson)).toEqual([s1, s2]);
    expect(await ownContracts(s3)).toHaveLength(1);
  });
});

describe("ações no contrato da viagem", () => {
  let env: Env;
  beforeAll(async () => {
    env = await setup("Contrato da viagem - ações");
  });

  it("atualizar, emitir, cancelar e reabrir funcionam; PDF usa o código da viagem", async () => {
    const { trip } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    await refreshContract(env.admin, id);
    await issueContract(env.admin, id);
    const pdf = await contractPdf(env.admin, id);
    const tripCode = (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).code;
    expect(pdf.fileName).toBe(`Contrato ${tripCode} - Maria Cliente.pdf`);
    await cancelContract(env.admin, id);
    await reopenContract(env.admin, id);
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c.status).toBe("EM_PREPARACAO");
    expect(c.tripId).toBe(trip.id);
  });

  it("separar em contratos por venda; não separa depois de enviado", async () => {
    const { trip, s1, s2, s3 } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    await splitTripContract(env.admin, id);
    const base = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(base).toMatchObject({ tripId: null, saleId: s1, status: "EM_PREPARACAO" });
    expect(await ownContracts(s2)).toHaveLength(1);
    expect(await ownContracts(s3)).toHaveLength(1);
    expect(await tripContractOf(env, trip.id)).toBeNull();

    const again = await tripWith3(env);
    const r = await generateTripContract(env.admin, again.trip.id);
    await issueContract(env.admin, r.id);
    await applySignatureCallback({ companyId: env.company.id, contractId: r.id, externalId: "ext-s", provider: "TESTE", event: "sent" });
    await expect(splitTripContract(env.admin, r.id)).rejects.toThrow(/já foi enviado/);
  });

  it("venda rápida: venda coberta (não base) usa o contrato da viagem e a etapa 5 fica feita depois de emitir", async () => {
    const { trip, s2 } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    const flow = await startFlow(env.admin, { clientId: env.client.id });
    await attachSale(env.admin, flow.id, s2);
    let d = await loadFlow(env.admin, flow.id);
    expect(d.contract?.id).toBe(id);
    expect(d.tripContract?.code).toMatch(/^VG-/);
    expect(d.done[4]).toBe(false);
    await issueContract(env.admin, id);
    d = await loadFlow(env.admin, flow.id);
    expect(d.done[4]).toBe(true);
  });

  it("venda rápida oferece juntar quando a viagem tem outras vendas confirmadas", async () => {
    const trip = await createTrip(env.admin, { clientId: env.client.id, title: "Oferta" });
    const a = await mkSale(env, env.admin, { tripId: trip.id, saleDate: "2026-11-01" });
    await mkSale(env, env.admin, { tripId: trip.id, saleDate: "2026-11-02", productType: "HOTEL" });
    const flow = await startFlow(env.admin, { clientId: env.client.id });
    await attachSale(env.admin, flow.id, a);
    const d = await loadFlow(env.admin, flow.id);
    expect(d.tripOffer?.codes).toHaveLength(2);
  });
});

describe("botão Preparar contrato com a automação desligada", () => {
  it("prepara mesmo com a automação de contrato desligada (pedido na mão)", async () => {
    const env = await setup("Preparar contrato");
    await setAutomationEnabled(env.admin, "venda_confirmada.contrato", false);
    const s = await mkSale(env, env.admin, {});
    expect(await ownContracts(s)).toHaveLength(0);
    await prisma.$transaction((tx) => prepareContractForSale(tx, env.company.id, s));
    expect(await ownContracts(s)).toHaveLength(0); // automático: continua respeitando a automação
    await prisma.$transaction((tx) => prepareContractForSale(tx, env.company.id, s, { force: true, ctx: env.admin }));
    expect((await ownContracts(s))[0]?.status).toBe("EM_PREPARACAO");
  });
});

describe("contrato da viagem na ZapSign", () => {
  let docs: { name: string; metadata: { key: string; value: string }[] }[] = [];
  let settingsBefore: string[] = [];
  beforeAll(async () => {
    settingsBefore = (await prisma.platformSetting.findMany({ select: { key: true } })).map((x) => x.key);
    process.env.APP_URL = "https://gestao.exemplo.com.br";
    process.env.ZAPSIGN_API_TOKEN = "zs_token_teste";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        const json = (d: unknown) => Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } }));
        if (url.hostname === "arquivos.zapsign.test") return Promise.resolve(new Response(Buffer.from("%PDF-1.4 assinado"), { status: 200 }));
        if (url.pathname === "/api/v1/user/company/webhook/") return json({ id: 1 });
        if (url.pathname === "/api/v1/docs/" && method === "POST") {
          docs.push(JSON.parse(String(init!.body)));
          return json({ token: "trip-doc-1", status: "pending", signers: [{ token: "s1", sign_url: "https://app.zapsign.com.br/verificar/s1", status: "new", name: "Maria" }] });
        }
        if (url.pathname === "/api/v1/docs/trip-doc-1/") return json({ token: "trip-doc-1", status: "signed", signed_file: "https://arquivos.zapsign.test/a.pdf", signers: [] });
        return json({});
      }),
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.APP_URL;
    delete process.env.ZAPSIGN_API_TOKEN;
    docs = [];
    // o webhook registrado aqui não pode valer para os outros testes da ZapSign
    await prisma.platformSetting.deleteMany({ where: { key: { notIn: settingsBefore } } });
  });

  it("documento com o código da viagem; PDF assinado vai para os documentos da viagem", async () => {
    const env = await setup("Contrato da viagem - ZapSign");
    await prisma.client.update({ where: { id: env.client.id }, data: { email: "maria@cliente.com" } });
    const { trip } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    await issueContract(env.admin, id);
    await sendContractToZapSign(env.admin, id);
    const code = (await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).code;
    expect(docs[0].name).toBe(`Contrato ${code} v1 - Maria Cliente`);
    expect(docs[0].metadata).toContainEqual({ key: "saleCode", value: code });
    await syncZapSignDocument("trip-doc-1");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).status).toBe("ASSINADO");
    const att = await prisma.attachment.findMany({ where: { companyId: env.company.id, mimeType: "application/pdf" } });
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ tripId: trip.id, saleId: null, fileName: `Contrato assinado ${code}.pdf` });
  });
});

describe("correções do contrato da viagem", () => {
  let env: Env;
  beforeAll(async () => {
    env = await setup("Contrato da viagem - correções");
  });

  it("effectiveContract: contrato da viagem enviado só cobre as vendas do texto", () => {
    const tc = { id: "t", status: "ENVIADO", saleIdsJson: JSON.stringify(["a"]) };
    expect(effectiveContract({ id: "a", status: "CONFIRMADA", contracts: [], trip: { contracts: [tc] } })).toBe(tc);
    expect(effectiveContract({ id: "b", status: "CONFIRMADA", contracts: [], trip: { contracts: [tc] } })).toBeNull();
    const open = { ...tc, status: "EM_PREPARACAO" };
    expect(effectiveContract({ id: "b", status: "CONFIRMADA", contracts: [], trip: { contracts: [open] } })).toBe(open);
    expect(tripContractCovers({ status: "CANCELADO", saleIdsJson: JSON.stringify(["a"]) }, "a")).toBe(false);
  });

  it("automação desligada e contrato da viagem enviado: venda nova ganha contrato próprio e o enviado não fica desatualizado", async () => {
    const own = await setup("Contrato da viagem - automação desligada");
    const { trip } = await tripWith3(own);
    const { id } = await generateTripContract(own.admin, trip.id);
    await issueContract(own.admin, id);
    await applySignatureCallback({ companyId: own.company.id, contractId: id, externalId: "ext-off", provider: "TESTE", event: "sent" });
    await setAutomationEnabled(own.admin, "venda_confirmada.contrato", false);
    const s4 = await mkSale(own, own.admin, { tripId: trip.id, saleDate: "2026-11-04", productType: "TRANSFER", price: 10000 });
    expect(await ownContracts(s4)).toHaveLength(1);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).outdated).toBe(false);
    const row = (await listSales(own.admin, { tripId: trip.id })).items.find((r) => r.id === s4);
    expect(row?.inTripContract).toBe(false);
  });

  it("contrato da viagem cancelado: Preparar contrato cria o contrato próprio e a viagem não mostra a venda como coberta", async () => {
    const { trip, s2 } = await tripWith3(env);
    const { id } = await generateTripContract(env.admin, trip.id);
    await cancelContract(env.admin, id);
    expect((await getTrip(env.admin, trip.id)).coveredSaleIds).toEqual([]);
    await prisma.$transaction((tx) => prepareContractForSale(tx, env.company.id, s2, { force: true, ctx: env.admin }));
    const mine = await ownContracts(s2);
    expect(mine).toHaveLength(1);
    expect(["EM_PREPARACAO", "NAO_GERADO"]).toContain(mine[0].status);
  });

  it("contrato próprio mandado pela venda rápida não é apagado ao gerar o da viagem; o atendimento volta a ter o envio pendente", async () => {
    const { trip, s1, s2, s3 } = await tripWith3(env);
    // s1: contrato próprio emitido e marcado como enviado na venda rápida
    const own1 = (await ownContracts(s1))[0];
    await refreshContract(env.admin, own1.id);
    await issueContract(env.admin, own1.id);
    const f1 = await startFlow(env.admin, { clientId: env.client.id });
    await attachSale(env.admin, f1.id, s1);
    await markFlow(env.admin, f1.id, "sent");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: own1.id } })).sentAt).not.toBeNull();
    // s2: atendimento com envio marcado, mas o contrato dele vai ser trocado pelo da viagem
    const f2 = await prisma.balcaoFlow.create({ data: { companyId: env.company.id, userId: env.admin.userId, clientId: env.client.id, saleId: s2, contractSent: true } });

    const { id } = await generateTripContract(env.admin, trip.id);
    expect(JSON.parse((await prisma.contract.findUniqueOrThrow({ where: { id } })).saleIdsJson)).toEqual([s2, s3]);
    expect(await prisma.contract.findUnique({ where: { id: own1.id } })).not.toBeNull();
    expect((await prisma.balcaoFlow.findUniqueOrThrow({ where: { id: f2.id } })).contractSent).toBe(false);
    expect((await prisma.balcaoFlow.findUniqueOrThrow({ where: { id: f1.id } })).contractSent).toBe(true);
  });

  it("vendedor: vê o contrato da viagem só com venda no texto; não muda contrato com venda de outro vendedor", async () => {
    const trip = await createTrip(env.admin, { clientId: env.client.id, title: "Mista" });
    await mkSale(env, env.seller, { tripId: trip.id, saleDate: "2026-11-01" });
    await mkSale(env, env.seller2, { tripId: trip.id, saleDate: "2026-11-02", productType: "HOTEL" });
    const { id } = await generateTripContract(env.admin, trip.id);
    expect((await getContract(env.seller, id)).id).toBe(id);
    await expect(splitTripContract(env.seller, id)).rejects.toThrow(/outro vendedor/);
    await expect(cancelContract(env.seller, id)).rejects.toThrow(/outro vendedor/);
    await expect(issueContract(env.seller, id)).rejects.toThrow(/outro vendedor/);
    await expect(refreshContract(env.seller, id)).rejects.toThrow(/outro vendedor/);
    await splitTripContract(env.admin, id);

    // vendedor2 com venda na viagem, mas fora do texto (contrato próprio já enviado): não vê
    const trip2 = await createTrip(env.admin, { clientId: env.client.id, title: "Fora do texto" });
    const out = await mkSale(env, env.seller2, { tripId: trip2.id, saleDate: "2026-11-01" });
    await prisma.contract.updateMany({ where: { saleId: out }, data: { sentAt: new Date() } });
    expect(await ownContracts(out)).toHaveLength(1);
    await mkSale(env, env.seller, { tripId: trip2.id, saleDate: "2026-11-02" });
    await mkSale(env, env.seller, { tripId: trip2.id, saleDate: "2026-11-03", productType: "HOTEL" });
    const r = await generateTripContract(env.seller, trip2.id);
    await expect(getContract(env.seller2, r.id)).rejects.toThrow(/não encontrado/);
    expect((await listContracts(env.seller2)).some((c) => c.id === r.id)).toBe(false);
    expect((await listContracts(env.seller)).some((c) => c.id === r.id)).toBe(true);
  });
});
