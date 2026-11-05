/** Integração com o CRM Frédy: a API WTS é simulada (fetch falso); nenhum acesso real ao Frédy. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { encryptSecret, decryptSecret } from "@/server/secrets";
import { connectFredy, saveFredyMapping, getFredyIntegration, handleFredyWebhook } from "@/server/services/fredy";
import { updateSale } from "@/server/services/sales";
import { dispatchPendingEvents } from "@/server/services/automations";
import { makeCompany } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;
type Call = { method: string; url: string; body: unknown };

const PANEL = "11111111-1111-1111-1111-111111111111";
const OTHER_PANEL = "99999999-9999-9999-9999-999999999999";
const STEP_WON = "22222222-2222-2222-2222-222222222222";
const CONTACT = "33333333-3333-3333-3333-333333333333";
const AGENT = "44444444-4444-4444-4444-444444444444";

let calls: Call[] = [];
let cards: Record<string, Record<string, unknown>> = {};
let sellerEmail = "";

function fakeWts(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url: url.pathname, body });
  const auth = new Headers(init?.headers).get("authorization");
  const json = (d: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } }));
  if (auth !== "Bearer pn_token_de_teste_123") return json({ error: "unauthorized" }, 401);
  const p = url.pathname;
  if (p === "/crm/v2/panel")
    return json({ hasMorePages: false, items: [{ id: PANEL, title: "Vendas", type: "SALES", archived: false, steps: [{ id: STEP_WON, title: "Fechado", position: 3, isInitial: false, isFinal: true, archived: false }] }] });
  if (p === `/crm/v1/panel/${PANEL}`) return json({ id: PANEL, title: "Vendas", type: "SALES", archived: false, steps: [{ id: STEP_WON, title: "Fechado", position: 3, isInitial: false, isFinal: true, archived: false }] });
  if (p === `/crm/v1/panel/${PANEL}/custom-fields`)
    return json([
      { id: "f1", key: "destino", name: "Destino", type: "STRING" },
      { id: "f2", key: "data-ida", name: "Data de ida", type: "DATE" },
      { id: "f3", key: "pax", name: "Passageiros", type: "INTEGER" },
    ]);
  if (p === "/core/v1/webhook/subscription" && method === "GET") return json([]);
  if (p === "/core/v1/webhook/subscription" && method === "POST") return json({ id: "sub-1" });
  if (p.startsWith("/crm/v2/panel/card/")) return json(cards[p.split("/").pop()!] ?? {}, cards[p.split("/").pop()!] ? 200 : 404);
  if (p === `/core/v1/contact/${CONTACT}`) return json({ id: CONTACT, name: "João do CRM", phoneNumber: "5542999990000", email: "joao@cliente.com" });
  if (p === `/core/v1/agent/${AGENT}`) return json({ id: AGENT, email: sellerEmail.toUpperCase() });
  if (p.endsWith("/note") && method === "POST") return json({ id: "note" });
  if (p.startsWith("/crm/v3/panel/card/") && method === "PUT") return json({ id: "ok" });
  return json({ error: "rota não simulada " + p }, 500);
}

describe("integração Frédy CRM", () => {
  let env: Env;
  let key = "";
  beforeAll(async () => {
    process.env.APP_URL = "https://gestao.exemplo.com.br";
    vi.stubGlobal("fetch", vi.fn(fakeWts));
    env = await makeCompany("Frédy");
    sellerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: env.seller.userId } })).email;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.APP_URL;
  });

  it("criptografa o token e não o devolve para a tela", async () => {
    const enc = encryptSecret("pn_abc");
    expect(enc).not.toContain("pn_abc");
    expect(decryptSecret(enc)).toBe("pn_abc");
    await expect(connectFredy(env.admin, "pn_token_errado_000")).rejects.toThrow(/recusou o token/);
    await connectFredy(env.admin, "pn_token_de_teste_123");
    const v = await getFredyIntegration(env.admin);
    expect(v.connected).toBe(true);
    expect(JSON.stringify(v)).not.toContain("pn_token_de_teste_123");
    expect(JSON.stringify(v)).not.toContain("tokenEnc");
    expect(JSON.stringify(v)).not.toContain("webhookKey");
  });

  it("vendedor não pode configurar a integração", async () => {
    await expect(connectFredy(env.seller, "pn_token_de_teste_123")).rejects.toThrow();
  });

  it("salvar o mapeamento registra o webhook no Frédy com os eventos de card e contato", async () => {
    calls = [];
    const r = await saveFredyMapping(env.admin, { salesPanelId: PANEL, wonStepId: STEP_WON, fieldMap: { destination: "destino", tripStart: "data-ida", passengerCount: "pax" } });
    expect(r.webhook).toBe(true);
    const post = calls.find((c) => c.url === "/core/v1/webhook/subscription" && c.method === "POST")!;
    key = (await prisma.fredyIntegration.findUniqueOrThrow({ where: { companyId: env.company.id } })).webhookKey;
    expect(post.body).toMatchObject({ url: `https://gestao.exemplo.com.br/api/integracoes/fredy/webhook/${key}`, events: ["PANEL_CARD_UPDATE", "PANEL_CARD_STEP_CHANGE", "CONTACT_UPDATE"] });
    await expect(saveFredyMapping(env.admin, { salesPanelId: PANEL, wonStepId: "etapa-de-outro-painel" })).rejects.toThrow(/Etapa/);
  });

  it("card ganho vira venda em rascunho, com cliente vinculado e vendedor pelo e-mail; sem duplicar", async () => {
    cards["c-1"] = {
      id: "c-1",
      panelId: PANEL,
      stepId: "outra",
      title: "Pacote Gramado",
      number: 7,
      monetaryAmount: 5400.5,
      status: "WON",
      responsibleUserId: AGENT,
      contactIds: [CONTACT],
      customFields: { destino: "Gramado - RS", "data-ida": "2027-02-10T00:00:00Z", pax: 3 },
    };
    expect(await handleFredyWebhook(key, { eventType: "PANEL_CARD_UPDATE", content: { id: "c-1" } })).toBe(true);
    expect(await handleFredyWebhook(key, { eventType: "PANEL_CARD_STEP_CHANGE", content: { id: "c-1" } })).toBe(true);
    const sales = await prisma.sale.findMany({ where: { companyId: env.company.id, externalRef: "fredy:c-1" }, include: { client: true, items: true } });
    expect(sales).toHaveLength(1);
    const s = sales[0];
    expect(s).toMatchObject({ status: "ORCAMENTO", origin: "FREDY", destination: "Gramado - RS", tripStart: "2027-02-10", passengerCount: 3, sellerId: env.seller.userId, grossCents: 540050 });
    expect(s.client).toMatchObject({ name: "João do CRM", fredyContactId: CONTACT, email: "joao@cliente.com", whatsapp: "5542999990000" });
    expect(calls.some((c) => c.url === "/crm/v1/panel/card/c-1/note")).toBe(true);
    expect(await prisma.fredyWebhookEvent.count({ where: { companyId: env.company.id, status: "PROCESSADO", saleId: s.id } })).toBe(1);
  });

  it("card aberto, de outro painel ou chave errada não cria venda", async () => {
    cards["c-2"] = { id: "c-2", panelId: PANEL, stepId: "x", title: "Aberto", status: "OPEN" };
    cards["c-3"] = { id: "c-3", panelId: OTHER_PANEL, stepId: "x", title: "Outro", status: "WON" };
    await handleFredyWebhook(key, { eventType: "PANEL_CARD_UPDATE", content: { id: "c-2" } });
    await handleFredyWebhook(key, { eventType: "PANEL_CARD_UPDATE", content: { id: "c-3" } });
    expect(await prisma.sale.count({ where: { companyId: env.company.id, externalRef: { in: ["fredy:c-2", "fredy:c-3"] } } })).toBe(0);
    expect(await handleFredyWebhook("chave-que-nao-existe-123456", { eventType: "PANEL_CARD_UPDATE", content: { id: "c-1" } })).toBe(false);
  });

  it("chegar na etapa de ganho cria a venda; card sem valor só avisa (uma vez) e cria quando o valor chega", async () => {
    cards["c-4"] = { id: "c-4", panelId: PANEL, stepId: STEP_WON, title: "Cruzeiro", status: "OPEN", monetaryAmount: 0 };
    calls = [];
    await handleFredyWebhook(key, { eventType: "PANEL_CARD_STEP_CHANGE", content: { id: "c-4" } });
    await handleFredyWebhook(key, { eventType: "PANEL_CARD_UPDATE", content: { id: "c-4" } });
    expect(await prisma.sale.count({ where: { companyId: env.company.id, externalRef: "fredy:c-4" } })).toBe(0);
    expect(calls.filter((c) => c.url === "/crm/v1/panel/card/c-4/note")).toHaveLength(1);
    expect(await prisma.fredyWebhookEvent.count({ where: { companyId: env.company.id, entityId: "c-4", status: "IGNORADO" } })).toBe(1);
    cards["c-4"].monetaryAmount = 12000;
    await handleFredyWebhook(key, { eventType: "PANEL_CARD_UPDATE", content: { id: "c-4" } });
    const s = await prisma.sale.findFirstOrThrow({ where: { companyId: env.company.id, externalRef: "fredy:c-4" } });
    expect(s.sellerId).toBe(env.admin.userId); // sem responsável → primeiro administrador
    expect(s.grossCents).toBe(1200000);
  });

  it("contato atualizado no Frédy atualiza o cliente vinculado", async () => {
    await handleFredyWebhook(key, { eventType: "CONTACT_UPDATE", content: { id: CONTACT, name: "João Silva", email: "JOAO.NOVO@cliente.com", phonenumber: "+55|42988887777" } });
    const c = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, fredyContactId: CONTACT } });
    expect(c).toMatchObject({ name: "João Silva", email: "joao.novo@cliente.com", whatsapp: "5542988887777" });
  });

  it("venda confirmada na gestão marca o card como ganho no Frédy, com valor e nota", async () => {
    const s = await prisma.sale.findFirstOrThrow({ where: { companyId: env.company.id, externalRef: "fredy:c-1" }, include: { items: true } });
    const it0 = s.items[0];
    calls = [];
    await updateSale(env.admin, s.id, {
      saleDate: s.saleDate,
      clientId: s.clientId,
      sellerId: s.sellerId,
      destination: s.destination,
      tripStart: s.tripStart,
      passengerCount: s.passengerCount,
      commission: { mode: "VALOR", amountCents: 0 },
      items: [{ productType: it0.productType, description: it0.description, priceCents: 600000, costCents: 0, commercialModel: "INTERMEDIACAO", supplierCommissionCents: 0 }],
      payments: [{ key: "p1", dueDate: "2026-11-20", amountCents: 600000, method: "PIX" }],
      passengers: [],
      confirm: true,
    });
    await dispatchPendingEvents(env.company.id);
    const put = calls.find((c) => c.url === "/crm/v3/panel/card/c-1" && c.method === "PUT");
    expect(put?.body).toMatchObject({ status: "WON", monetaryAmount: 6000, stepId: STEP_WON });
    expect((put?.body as { fields: string[] }).fields).toEqual(expect.arrayContaining(["Status", "MonetaryAmount", "StepId"]));
    expect(calls.some((c) => c.url === "/crm/v1/panel/card/c-1/note" && JSON.stringify(c.body).includes(s.code))).toBe(true);
    // o eco do Frédy (card ganho) não cria outra venda
    await handleFredyWebhook(key, { eventType: "PANEL_CARD_UPDATE", content: { id: "c-1" } });
    expect(await prisma.sale.count({ where: { companyId: env.company.id, externalRef: "fredy:c-1" } })).toBe(1);
  });
});
