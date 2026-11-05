/** Assinatura online pela ZapSign: a API é simulada (fetch falso); nenhum documento real é criado. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { createSale } from "@/server/services/sales";
import { issueContract, refreshContract } from "@/server/services/contracts";
import { sendContractToZapSign, syncZapSignDocument, refuseZapSignDocument, checkWebhookSecret, zapsignWebhookSecret, contractToMarkdown } from "@/server/services/zapsign";
import { makeCompany, exampleSale } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;
type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let docStatus: Record<string, string> = {};
let n = 0;

function fakeZapSign(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url: url.pathname, body });
  const json = (d: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } }));
  if (url.hostname === "arquivos.zapsign.test") return Promise.resolve(new Response(Buffer.from("%PDF-1.4 assinado"), { status: 200 }));
  if (new Headers(init?.headers).get("authorization") !== "Bearer zs_token_teste") return json({ detail: "forbidden" }, 403);
  if (url.pathname === "/api/v1/user/company/webhook/" && method === "POST") return json({ id: 77 });
  if (url.pathname === "/api/v1/docs/" && method === "POST") {
    const token = `doc-${++n}`;
    docStatus[token] = "pending";
    return json({ token, status: "pending", signers: [{ token: "s1", sign_url: "https://app.zapsign.com.br/verificar/s1", status: "new", name: "Maria" }] });
  }
  const m = url.pathname.match(/^\/api\/v1\/docs\/([^/]+)\/$/);
  if (m && method === "GET") return json({ token: m[1], status: docStatus[m[1]], signed_file: docStatus[m[1]] === "signed" ? "https://arquivos.zapsign.test/a.pdf" : null, signers: [] });
  return json({ error: "rota não simulada" }, 500);
}

async function issuedContract(env: Env) {
  const s = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id));
  const c = await prisma.contract.findFirstOrThrow({ where: { saleId: s.id } });
  await refreshContract(env.admin, c.id);
  await issueContract(env.admin, c.id);
  return c.id;
}

describe("assinatura online pela ZapSign", () => {
  let env: Env;
  beforeAll(async () => {
    process.env.APP_URL = "https://gestao.exemplo.com.br";
    vi.stubGlobal("fetch", vi.fn(fakeZapSign));
    env = await makeCompany("ZapSign");
    await prisma.client.update({ where: { id: env.client.id }, data: { email: "maria@cliente.com", whatsapp: "5542999990000" } });
    await prisma.company.update({ where: { id: env.company.id }, data: { responsibleName: "Helena Dona", contactEmail: "contato@agencia.com" } });
    await prisma.contractTemplate.create({ data: { companyId: env.company.id, name: "Pacote", productType: "PACOTE", body: "CONTRATO de {{cliente.nome}}\n\n1. OBJETO\nVenda {{venda.codigo}} *teste*\n___________", clauses: "" } });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.APP_URL;
    delete process.env.ZAPSIGN_API_TOKEN;
  });

  it("sem o token da ZapSign, avisa que a assinatura online não está ativada", async () => {
    const id = await issuedContract(env);
    await expect(sendContractToZapSign(env.admin, id)).rejects.toThrow(/ZAPSIGN_API_TOKEN/);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).status).toBe("AGUARDANDO_ENVIO");
  });

  it("envia o contrato emitido: cliente e agência assinam, registra o envio e lança R$ 1,00 em Sistemas", async () => {
    process.env.ZAPSIGN_API_TOKEN = "zs_token_teste";
    const id = await issuedContract(env);
    calls = [];
    const r = await sendContractToZapSign(env.admin, id, { whatsapp: true });
    expect(r.signUrl).toBe("https://app.zapsign.com.br/verificar/s1");
    const hook = calls.find((c) => c.url === "/api/v1/user/company/webhook/")!;
    expect(hook.body).toMatchObject({ url: "https://gestao.exemplo.com.br/api/integracoes/zapsign/webhook", headers: [{ name: "X-Fredy-Webhook-Secret", value: zapsignWebhookSecret() }] });
    const doc = calls.find((c) => c.url === "/api/v1/docs/" && c.method === "POST")!.body as { external_id: string; signers: Record<string, unknown>[]; markdown_text: string };
    expect(doc.external_id).toBe(id);
    expect(doc.signers[0]).toMatchObject({ name: "Maria Cliente", email: "maria@cliente.com", send_automatic_email: true, phone_country: "55", phone_number: "42999990000", send_automatic_whatsapp: true });
    expect(doc.signers[1]).toMatchObject({ name: "Helena Dona", email: "contato@agencia.com" });
    expect(doc.markdown_text).toContain("\\*teste\\*");
    const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ status: "ENVIADO", signatureProvider: "ZAPSIGN", externalId: "doc-1", signUrl: "https://app.zapsign.com.br/verificar/s1" });
    const pay = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, sourceKey: "assinatura:doc-1" } });
    expect(pay).toMatchObject({ amountCents: 100, category: "SISTEMAS", status: "PENDENTE" });
    expect(await prisma.signatureRequest.count({ where: { companyId: env.company.id } })).toBe(1);
    await expect(sendContractToZapSign(env.admin, id)).rejects.toThrow(/Emita o contrato/); // não reenvia o mesmo
    // segundo contrato reutiliza o webhook já registrado
    calls = [];
    await sendContractToZapSign(env.admin, await issuedContract(env));
    expect(calls.some((x) => x.url === "/api/v1/user/company/webhook/")).toBe(false);
  });

  it("só marca como assinado quando a ZapSign confirma o documento inteiro; arquiva o PDF na venda", async () => {
    const c = await prisma.contract.findFirstOrThrow({ where: { companyId: env.company.id, externalId: "doc-1" } });
    await syncZapSignDocument("doc-1"); // ainda pendente (um signatário assinou)
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ENVIADO");
    docStatus["doc-1"] = "signed";
    await syncZapSignDocument("doc-1");
    await syncZapSignDocument("doc-1"); // repetido: sem duplicar anexo
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ASSINADO");
    expect(await prisma.attachment.count({ where: { saleId: c.saleId, mimeType: "application/pdf" } })).toBe(1);
    expect(await prisma.automationEvent.count({ where: { companyId: env.company.id, type: "contrato.assinado" } })).toBe(1);
  });

  it("recusa do cliente cancela o contrato; documento desconhecido é ignorado", async () => {
    await refuseZapSignDocument("doc-2");
    const c = await prisma.contract.findFirstOrThrow({ where: { companyId: env.company.id, externalId: "doc-2" } });
    expect(c.status).toBe("CANCELADO");
    expect(await syncZapSignDocument("nao-existe")).toEqual({ found: false });
  });

  it("webhook só aceita o segredo correto", () => {
    expect(checkWebhookSecret(zapsignWebhookSecret())).toBe(true);
    expect(checkWebhookSecret("errado")).toBe(false);
    expect(checkWebhookSecret(null)).toBe(false);
  });

  it("converte o texto do contrato preservando as linhas", () => {
    expect(contractToMarkdown("A\nB\n\nC_D")).toBe("A  \nB  \n\nC\\_D  ");
  });
});
