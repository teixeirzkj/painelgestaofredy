/** Importação de clientes: planilha CSV (o Monde está em monde.test.ts). */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { importClientsCsv, parseDate } from "@/server/services/client-import";
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
