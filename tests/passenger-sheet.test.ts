/** Ficha dos passageiros (popup): junta passageiros e cadastro, inclui o comprador, respeita o alcance e a permissão. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createSale } from "@/server/services/sales";
import { passengerSheet, searchSalesForSheet } from "@/server/services/passenger-sheet";
import { makeCompany, exampleSale } from "./helpers";

describe("ficha dos passageiros", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  let saleId: string;
  beforeAll(async () => {
    env = await makeCompany("Ficha", { sellersSeeAllClients: false });
    await prisma.client.update({ where: { id: env.client.id }, data: { ownerId: env.seller.userId } });
    const joao = await prisma.client.create({
      data: { companyId: env.company.id, name: "João Passageiro Silva", document: "39053344705", birthDate: "1990-05-10", gender: "M", rg: "1234567", passportNumber: "AB123456", passportExpiry: "2020-01-01", email: "joao@x.com", whatsapp: "42999990000", ownerId: env.seller.userId },
    });
    const s = await createSale(
      env.seller,
      exampleSale(env.client.id, env.supplier.id, {
        destination: "Lisboa",
        passengerCount: 3,
        passengers: [
          { name: "João Passageiro Silva", clientId: joao.id }, // dados vêm do cadastro
          { name: "Ana Sem Cadastro", document: "11144477735", birthDate: "2015-03-02" },
        ],
      }),
    );
    saleId = s.id;
  });

  it("mostra o comprador e os passageiros, completando com o cadastro, e aponta o que falta", async () => {
    const f = await passengerSheet(env.seller, saleId);
    expect(f.people.map((p) => [p.role, p.name])).toEqual([
      ["CLIENTE", "Maria Cliente"],
      ["PASSAGEIRO", "João Passageiro Silva"],
      ["PASSAGEIRO", "Ana Sem Cadastro"],
    ]);
    expect(f.people[1]).toMatchObject({ document: "39053344705", birthDate: "1990-05-10", gender: "M", rg: "1234567", passportNumber: "AB123456", passportExpiry: "2020-01-01", phone: "42999990000" });
    expect(f.people[2]).toMatchObject({ document: "11144477735", birthDate: "2015-03-02", passportNumber: null });
    expect(f.missingPassengers).toBe(1);
    expect(await prisma.auditLog.count({ where: { companyId: env.company.id, action: "passageiros.ficha_vista", entityId: saleId } })).toBe(1);
  });

  it("busca pela venda, cliente, passageiro ou CPF", async () => {
    const ids = async (q: string) => (await searchSalesForSheet(env.seller, q)).map((s) => s.id);
    expect(await ids("Maria")).toContain(saleId);
    expect(await ids("Ana Sem")).toContain(saleId);
    expect(await ids("111.444.777-35")).toContain(saleId);
    expect(await ids("nao-existe-xyz")).toEqual([]);
  });

  it("outro vendedor sem acesso às vendas dele não abre, e quem não cadastra clientes também não", async () => {
    await expect(passengerSheet(env.seller2, saleId)).rejects.toThrow();
    expect(await searchSalesForSheet(env.seller2, "Maria")).toEqual([]);
    await expect(passengerSheet(env.fin, saleId)).rejects.toThrow();
    const other = await makeCompany("Outra ficha");
    await expect(passengerSheet(other.admin, saleId)).rejects.toThrow(/não encontrada/);
  });
});
