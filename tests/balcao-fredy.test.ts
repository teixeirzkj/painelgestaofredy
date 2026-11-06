/** Envio do contrato pela conversa do Frédy (venda rápida): API WTS simulada, nenhum acesso real. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { encryptSecret } from "@/server/secrets";
import { sendFileToClientChat } from "@/server/services/fredy";
import { makeCompany } from "./helpers";

const CONTACT = "33333333-3333-3333-3333-333333333333";
const SESSION = "55555555-5555-5555-5555-555555555555";
type Call = { method: string; url: string; query: string; body: unknown };
let calls: Call[] = [];
let sessions: unknown[] = [];

function fakeWts(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const isJson = typeof init?.body === "string";
  calls.push({ method, url: url.origin + url.pathname, query: url.search, body: isJson ? JSON.parse(String(init!.body)) : init?.body ? "<binário>" : undefined });
  const json = (d: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } }));
  const p = url.pathname;
  if (url.host === "upload.exemplo.com") return Promise.resolve(new Response(null, { status: 200 }));
  if (p === "/chat/v2/session") return json({ hasMorePages: false, items: sessions });
  if (p === "/core/v2/file" && method === "GET") return json({ tempFileId: "tmp-1", urlUpload: "https://upload.exemplo.com/put?sig=1" });
  if (p === "/core/v2/file" && method === "POST") return json({ id: "file-1" });
  if (p === `/chat/v1/session/${SESSION}/message`) return json({ id: "msg-1", status: "QUEUED" });
  if (p.startsWith("/core/v1/contact/phonenumber/")) return json({ error: "x" }, 404);
  return json({ error: "rota não simulada " + p }, 500);
}

describe("contrato pela conversa do Frédy", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  const file = { bytes: new Uint8Array([37, 80, 68, 70, 45]), name: "Contrato V-1.pdf", mimeType: "application/pdf", type: "PDF" as const };
  beforeAll(async () => {
    vi.stubGlobal("fetch", vi.fn(fakeWts));
    env = await makeCompany("Envio Frédy");
    await prisma.fredyIntegration.create({ data: { companyId: env.company.id, tokenEnc: encryptSecret("pn_teste"), tokenLast4: "este", webhookKey: randomBytes(12).toString("hex") } });
  });
  afterAll(() => vi.unstubAllGlobals());

  it("sobe o PDF e manda na conversa aberta mais recente do contato", async () => {
    calls = [];
    sessions = [
      { id: "antiga", status: "PENDING", lastInteractionDate: "2026-11-01T10:00:00Z", windowStatus: "ACTIVE" },
      { id: SESSION, status: "IN_PROGRESS", lastInteractionDate: "2026-11-06T10:00:00Z", windowStatus: "ACTIVE", previewUrl: "https://app.wts.chat/s/1" },
    ];
    const r = await sendFileToClientChat(env.admin, { contactId: CONTACT }, file, "Segue o contrato");
    expect(r).toMatchObject({ sessionId: SESSION, previewUrl: "https://app.wts.chat/s/1", contactId: CONTACT });
    const seq = calls.map((c) => `${c.method} ${c.url.replace("https://api.wts.chat", "")}`);
    expect(seq).toEqual(["GET /chat/v2/session", "GET /core/v2/file", "PUT https://upload.exemplo.com/put", "POST /core/v2/file", `POST /chat/v1/session/${SESSION}/message`]);
    expect(calls[0].query).toContain(`ContactId=${CONTACT}`);
    expect(calls[0].query).toContain("Status=IN_PROGRESS");
    expect(calls[1].query).toContain("Type=PDF");
    expect(calls[3].body).toEqual({ tempFileId: "tmp-1" });
    expect(calls[4].body).toEqual({ text: "Segue o contrato", fileId: "file-1" });
  });

  it("sem atendimento aberto, avisa o atendente e não sobe nada", async () => {
    calls = [];
    sessions = [];
    await expect(sendFileToClientChat(env.admin, { contactId: CONTACT }, file, "x")).rejects.toThrow(/não tem atendimento aberto/);
    expect(calls.some((c) => c.url.includes("/v2/file"))).toBe(false);
  });

  it("janela de 24 horas fechada também avisa", async () => {
    sessions = [{ id: SESSION, status: "PENDING", windowStatus: "EXPIRED" }];
    await expect(sendFileToClientChat(env.admin, { contactId: CONTACT }, file, "x")).rejects.toThrow(/24 horas/);
  });

  it("sem contato no Frédy e telefone desconhecido, explica o que fazer", async () => {
    await expect(sendFileToClientChat(env.admin, { phone: "42999990000" }, file, "x")).rejects.toThrow(/Não achei este cliente no Frédy/);
  });
});
