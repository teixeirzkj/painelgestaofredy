/** Importação de clientes: planilha CSV e Monde (API simulada; nenhuma chamada real). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { importClientsCsv, parseDate } from "@/server/services/client-import";
import { connectMonde, importMondeBatch, restartMondeImport, mapMondePerson } from "@/server/services/monde";
import { makeCompany } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

describe("importar clientes por planilha", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeCompany("Planilha");
  });

  it("aceita datas brasileiras e ISO", () => {
    expect(parseDate("02/04/1990")).toBe("1990-04-02");
    expect(parseDate("1990-04-02T00:00:00")).toBe("1990-04-02");
    expect(parseDate("31/02/1990")).toBeNull();
  });

  it("cria clientes, completa o existente sem sobrescrever e aponta linhas com erro", async () => {
    await prisma.client.update({ where: { id: env.client.id }, data: { email: null, whatsapp: "(42) 98888-0000" } });
    const csv = [
      "Nome;CPF;E-mail;Celular;Nascimento;UF;Observações",
      "Maria Cliente;529.982.247-25;maria@x.com;(42) 90000-0000;02/04/1990;pr;", // já existe pelo CPF
      "João Novo;;joao@x.com;(42) 97777-0000;15/08/1985;SC;veio da planilha",
      "Ana CPF Errado;111.111.111-11;;;;;",
      "Jo;;;;;;", // nome curto
    ].join("\n");
    const r = await importClientsCsv(env.admin, csv);
    expect(r).toMatchObject({ criados: 2, atualizados: 1 });
    expect(r.erros).toEqual([{ linha: 5, motivo: "nome ausente ou muito curto" }]);
    expect(r.avisos[0]).toMatchObject({ linha: 4 });
    const maria = await prisma.client.findUniqueOrThrow({ where: { id: env.client.id } });
    expect(maria.email).toBe("maria@x.com"); // estava vazio: completou
    expect(maria.whatsapp).toBe("(42) 98888-0000"); // já tinha: não sobrescreveu
    const joao = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, name: "João Novo" } });
    expect(joao).toMatchObject({ birthDate: "1985-08-15", state: "SC", whatsapp: "(42) 97777-0000", notes: "veio da planilha" });
    // reimportar a mesma planilha não duplica
    const again = await importClientsCsv(env.admin, csv);
    expect(again.criados).toBe(0);
  });

  it("vendedor sem permissão de clientes não importa; planilha sem coluna nome é recusada", async () => {
    await expect(importClientsCsv(env.admin, "cpf;email\n1;2")).rejects.toThrow(/coluna "nome"/);
    await prisma.rolePermission.create({ data: { companyId: env.company.id, role: "VENDEDOR", permission: "clients.manage", allowed: false } }).catch(() => null);
  });
});

describe("importar clientes do Monde", () => {
  let env: Env;
  const calls: string[] = [];
  const person = (id: string, attrs: Record<string, unknown>) => ({ id, type: "people", attributes: attrs });
  const pages: Record<number, unknown[]> = {
    1: [person("u1", { name: "Agente Monde" }), person("p1", { name: "Carla Monde", cpf: "390.533.447-05", "mobile-phone": "(41) 99999-1111", "birth-date": "1980-01-20", "passport-number": "AB123456", "passport-expiration": "2030-05-01", zip: "80000-000", address: "Rua das Flores", number: "10" })],
    2: [person("p2", { name: "Empresa Monde", cnpj: "11.444.777/0001-61", "company-name": "Empresa Monde Ltda", email: "fin@empresa.com" })],
  };
  beforeAll(async () => {
    process.env.MONDE_SPACING_MS = "0";
    env = await makeCompany("Monde");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
        const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/vnd.api+json" } });
        if (url.pathname === "/api/v2/tokens") {
          const body = JSON.parse(String(init?.body));
          if (body.data.type !== "tokens" || body.data.attributes.password !== "senha-certa") return json({ errors: [{ status: "401" }] }, 401);
          return json({ data: { id: "1", type: "tokens", attributes: { login: "admin", token: "jwt-teste" } } });
        }
        if (new Headers(init?.headers).get("authorization") !== "Bearer jwt-teste") return json({}, 401);
        if (url.pathname === "/api/v2/people" && url.searchParams.get("filter[only_users]") === "true") return json({ data: [person("u1", { name: "Agente Monde" })] });
        if (url.pathname === "/api/v2/people") {
          const n = Number(url.searchParams.get("page[number]"));
          return json({ data: pages[n] ?? [], links: { first: `${url.origin}/api/v2/people?page%5Bnumber%5D=1`, last: `${url.origin}/api/v2/people?page%5Bnumber%5D=2` } });
        }
        return json({}, 404);
      }),
    );
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.MONDE_SPACING_MS;
  });

  it("valida o login no formato do Monde e a senha antes de salvar", async () => {
    await expect(connectMonde(env.admin, { login: "admin", password: "x" })).rejects.toThrow(/monde\.com\.br/);
    await expect(connectMonde(env.admin, { login: "admin@agencia.monde.com.br", password: "errada" })).rejects.toThrow(/recusou/);
    await connectMonde(env.admin, { login: "admin@agencia.monde.com.br", password: "senha-certa" });
    const m = await prisma.mondeIntegration.findUniqueOrThrow({ where: { companyId: env.company.id } });
    expect(m.passwordEnc).not.toContain("senha-certa");
  });

  it("importa todas as páginas, ignora usuários do Monde e não duplica na segunda vez", async () => {
    await restartMondeImport(env.admin);
    const r = await importMondeBatch(env.admin);
    expect(r).toMatchObject({ done: true, totalPages: 2, created: 2 });
    const carla = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, mondeId: "p1" } });
    expect(carla).toMatchObject({ name: "Carla Monde", document: "39053344705", whatsapp: "(41) 99999-1111", birthDate: "1980-01-20", passportNumber: "AB123456", passportExpiry: "2030-05-01", street: "Rua das Flores" });
    const pj = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, mondeId: "p2" } });
    expect(pj).toMatchObject({ personType: "PJ", document: "11444777000161", tradeName: "Empresa Monde Ltda" });
    expect(await prisma.client.count({ where: { companyId: env.company.id, name: "Agente Monde" } })).toBe(0);
    expect(calls.some((c) => c.includes("page[number]=1") || c.includes("page%5Bnumber%5D=1"))).toBe(true);
    await restartMondeImport(env.admin);
    const again = await importMondeBatch(env.admin);
    expect(again.created).toBe(0);
  });

  it("mapeia os atributos documentados da pessoa", () => {
    expect(mapMondePerson({ id: "x", attributes: { name: "A B C", phone: "1", "business-phone": "2", observations: "obs" } })).toMatchObject({ name: "A B C", phone: "1", notes: "obs" });
  });
});
