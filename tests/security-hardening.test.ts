/** Testes de invasão das proteções gerais: redirecionamento, CSV, SSRF, sessão antiga e escopo do vendedor. */
import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { safeNext } from "@/lib/safe-next";
import { csvEscape } from "@/lib/utils";
import { assertPublicHttpsUrl, isPrivateAddress } from "@/server/net-guard";
import { loadContext } from "@/server/context";
import { safeEqual } from "@/server/secrets";
import { upsertImportedClient } from "@/server/services/client-import";
import { makeCompany } from "./helpers";

describe("redirecionamento depois do login (?next=)", () => {
  it.each(["//evil.com", "/\\evil.com", "/\tevil.com", "/\t/evil.com", "https://evil.com", "javascript:alert(1)", "/\r\nSet-Cookie:x", " /x", "\\\\evil.com"])("recusa %j", (v) => {
    expect(safeNext(v)).toBe("/");
  });
  it("aceita caminhos internos", () => {
    expect(safeNext("/balcao?card=abc-123")).toBe("/balcao?card=abc-123");
    expect(safeNext("/vendas/cm123")).toBe("/vendas/cm123");
  });
});

describe("CSV sem fórmula do Excel", () => {
  it("neutraliza = + - @ no começo", () => {
    expect(csvEscape('=HYPERLINK("https://evil")')).toBe(`"'=HYPERLINK(""https://evil"")"`);
    expect(csvEscape("+1+1")).toBe(`"'+1+1"`);
    expect(csvEscape("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvEscape("-cmd|calc")).toBe(`"'-cmd|calc"`);
  });
  it("não mexe em texto e número comuns", () => {
    expect(csvEscape("Maria Silva")).toBe("Maria Silva");
    expect(csvEscape("-150,25")).toBe("-150,25");
    expect(csvEscape(42)).toBe("42");
  });
});

describe("webhook não alcança a rede interna (SSRF)", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("%s é interno", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it("8.8.8.8 é público", () => expect(isPrivateAddress("8.8.8.8")).toBe(false));
  it.each(["http://exemplo.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://[::1]/x", "https://169.254.169.254/latest", "https://exemplo.com:8080/x", "https://user:pass@exemplo.com/"])("recusa %s", async (u) => {
    await expect(assertPublicHttpsUrl(u)).rejects.toThrow();
  });
});

describe("segredos comparados sem erro", () => {
  it("acentos e tamanhos diferentes não derrubam o servidor", () => {
    expect(safeEqual("ééééé", "abcdefghij")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual(null, "abc")).toBe(false);
  });
});

describe("sessão antiga cai depois de trocar a senha", () => {
  it("token com versão anterior não vale mais", async () => {
    const env = await makeCompany("Sessão", { sellersSeeAllClients: false });
    const id = env.seller.userId;
    expect(await loadContext(id, 0)).not.toBeNull();
    await prisma.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    expect(await loadContext(id, 0)).toBeNull();
    expect(await loadContext(id, 1)).not.toBeNull();
  });
});

describe("importação de planilha respeita o vendedor", () => {
  it("vendedor não completa nem descobre cliente de outro vendedor", async () => {
    const env = await makeCompany("Importação escopo", { sellersSeeAllClients: false });
    const alheio = await prisma.client.create({ data: { companyId: env.company.id, name: "João de Outro Vendedor", email: "joao.alheio@teste.com", ownerId: env.seller2.userId } });
    await expect(
      prisma.$transaction((tx) => upsertImportedClient(tx, env.seller, { name: "João", email: "joao.alheio@teste.com", birthDate: "1990-01-01", notes: "invadido" } as never)),
    ).rejects.toThrow(/outro vendedor/);
    const depois = await prisma.client.findUniqueOrThrow({ where: { id: alheio.id } });
    expect(depois.birthDate).toBeNull();
    expect(depois.notes).toBeNull();
  });
});

describe("vendedor não 'puxa' cliente de outro vendedor criando venda", () => {
  it("venda para cliente fora do escopo é recusada; para cliente próprio funciona", async () => {
    const { createSale } = await import("@/server/services/sales");
    const env = await makeCompany("Escopo venda", { sellersSeeAllClients: false });
    const alheio = await prisma.client.create({ data: { companyId: env.company.id, name: "Cliente da Vendedor2", ownerId: env.seller2.userId } });
    const proprio = await prisma.client.create({ data: { companyId: env.company.id, name: "Cliente da Vendedora", ownerId: env.seller.userId } });
    const { exampleSale } = await import("./helpers");
    const draft = (clientId: string) => exampleSale(clientId, env.supplier.id, { confirm: false });
    await expect(createSale(env.seller, draft(alheio.id))).rejects.toThrow(/Cliente não encontrado/);
    await expect(createSale(env.seller, draft(proprio.id))).resolves.toBeTruthy();
  });
});
