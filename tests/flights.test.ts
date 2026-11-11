/** Central da Viagem: voos da venda, permissões e a visão do dia. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { today } from "@/server/context";
import { addDays } from "@/lib/dates";
import { createSale } from "@/server/services/sales";
import { deleteFlight, listSaleFlights, saveFlight, travelCenter } from "@/server/services/flights";
import { makeCompany, exampleSale } from "./helpers";

describe("Central da Viagem", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  let t: string;
  let saleId: string;
  let missingId: string;
  beforeAll(async () => {
    env = await makeCompany("Central da Viagem");
    t = today(env.company);
    const s = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { saleDate: t, tripStart: t, tripEnd: addDays(t, 5), destination: "Lisboa", confirm: true }));
    saleId = s.id;
    const aereo = exampleSale(env.client.id, env.supplier.id, { saleDate: t, tripStart: addDays(t, 3), tripEnd: addDays(t, 9), destination: "Santiago", confirm: true });
    (aereo.items[0] as { productType: string }).productType = "AEREO";
    missingId = (await createSale(env.seller, aereo)).id;
  });

  it("cadastra voos validando companhia, aeroportos e horário", async () => {
    await expect(saveFlight(env.seller, saleId, null, { airline: "LATAM", flightNumber: "8084", origin: "GRU", destination: "MAD", departureAt: `${t}T10:00` })).rejects.toThrow();
    await expect(saveFlight(env.seller, saleId, null, { airline: "LA", flightNumber: "8084", origin: "GRU", destination: "GRU", departureAt: `${t}T10:00` })).rejects.toThrow();
    await saveFlight(env.seller, saleId, null, { airline: "la", flightNumber: "8084", origin: "gru", destination: "mad", departureAt: `${t}T10:00`, arrivalAt: `${t}T23:00` });
    await saveFlight(env.seller, saleId, null, { airline: "IB", flightNumber: "3106", origin: "MAD", destination: "LIS", departureAt: `${addDays(t, 1)}T00:10`, arrivalAt: `${addDays(t, 1)}T00:30` });
    const list = await listSaleFlights(env.seller, saleId);
    expect(list.map((f) => `${f.airline}${f.flightNumber} ${f.origin}-${f.destination}`)).toEqual(["LA8084 GRU-MAD", "IB3106 MAD-LIS"]);
  });

  it("só o vendedor da venda ou quem edita todas mexe nos voos", async () => {
    const [f] = await listSaleFlights(env.seller, saleId);
    await expect(saveFlight(env.seller2, saleId, f.id, { airline: "LA", flightNumber: "1", origin: "GRU", destination: "MAD", departureAt: `${t}T10:00` })).rejects.toThrow();
    await expect(deleteFlight(env.seller2, saleId, f.id)).rejects.toThrow();
    const other = await makeCompany("Outra agência");
    await expect(listSaleFlights(other.admin, saleId)).resolves.toEqual([]);
    await expect(saveFlight(other.admin, saleId, null, { airline: "LA", flightNumber: "1", origin: "GRU", destination: "MAD", departureAt: `${t}T10:00` })).rejects.toThrow(/não encontrada/);
  });

  it("mostra quem está viajando, os voos do dia, conexão curta e embarque sem voo", async () => {
    const c = await travelCenter(env.admin);
    expect(c.traveling.map((s) => s.id)).toContain(saleId);
    expect(c.flightsToday.map((f) => f.flightNumber)).toEqual(["8084"]);
    expect(c.flightsTomorrow.map((f) => f.flightNumber)).toEqual(["3106"]);
    expect(c.connections).toEqual([expect.objectContaining({ saleId, airport: "MAD", minutes: 70 })]);
    expect(c.missing.map((s) => s.id)).toEqual([missingId]);
    expect(c.destinations.find((d) => d.destination === "Lisboa")?.passengers).toBe(2);
    // vendedor sem "ver todas as vendas" vê só as dele
    const c2 = await travelCenter(env.seller2);
    expect(c2.flightsToday.length).toBe(env.seller2.permissions.has("sales.view_all") ? 1 : 0);
  });

  it("venda cancelada some da central e não aceita voo", async () => {
    await prisma.sale.update({ where: { id: saleId }, data: { status: "CANCELADA" } });
    const c = await travelCenter(env.admin);
    expect(c.flightsToday).toEqual([]);
    await expect(saveFlight(env.seller, saleId, null, { airline: "LA", flightNumber: "1", origin: "GRU", destination: "MAD", departureAt: `${t}T10:00` })).rejects.toThrow(/cancelada/);
  });
});
