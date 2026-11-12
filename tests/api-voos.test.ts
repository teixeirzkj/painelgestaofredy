/** API de voos para automações (n8n): só com a chave da agência, só vendas confirmadas, só da própria agência. */
import { beforeAll, describe, expect, it } from "vitest";
import { today } from "@/server/context";
import { addDays } from "@/lib/dates";
import { createSale, cancelSale } from "@/server/services/sales";
import { saveFlight } from "@/server/services/flights";
import { rotateApiKey } from "@/server/services/settings";
import { GET } from "@/app/api/v1/voos/route";
import { makeCompany, exampleSale } from "./helpers";

const call = (key: string | null, q = "") => GET(new Request(`http://localhost/api/v1/voos${q}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }));

describe("API de voos (n8n)", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  let key: string;
  let t: string;
  beforeAll(async () => {
    env = await makeCompany("API voos");
    key = await rotateApiKey(env.admin);
    t = today(env.company);
    const s = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { saleDate: t, tripStart: t, tripEnd: addDays(t, 5), confirm: true }));
    await saveFlight(env.seller, s.id, null, { airline: "LA", flightNumber: "8084", origin: "GRU", destination: "MAD", departureAt: `${t}T10:00`, arrivalAt: `${t}T23:00` });
    await saveFlight(env.seller, s.id, null, { airline: "IB", flightNumber: "3106", origin: "MAD", destination: "LIS", departureAt: `${addDays(t, 3)}T00:10` });
    const cancelada = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { saleDate: t, tripStart: t, tripEnd: addDays(t, 2), confirm: true }));
    await saveFlight(env.seller, cancelada.id, null, { airline: "G3", flightNumber: "1000", origin: "CWB", destination: "GRU", departureAt: `${t}T08:00` });
    await cancelSale(env.admin, cancelada.id, "teste");
    // voo de outra agência não pode aparecer
    const other = await makeCompany("Outra agência voos");
    const o = await createSale(other.seller, exampleSale(other.client.id, other.supplier.id, { saleDate: t, tripStart: t, tripEnd: addDays(t, 2), confirm: true }));
    await saveFlight(other.seller, o.id, null, { airline: "AD", flightNumber: "4000", origin: "VCP", destination: "REC", departureAt: `${t}T09:00` });
  });

  it("exige a chave da agência", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("fg_chave_errada")).status).toBe(401);
  });

  it("lista os voos de hoje e amanhã da agência, sem venda cancelada", async () => {
    const r = await call(key);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data).toEqual([
      expect.objectContaining({ voo: "LA8084", origem: "GRU", destino: "MAD", partida: `${t}T10:00`, cliente: "Maria Cliente", passageiros: 2 }),
    ]);
  });

  it("aceita até 7 dias", async () => {
    const body = await (await call(key, "?dias=7")).json();
    expect(body.data.map((f: { voo: string }) => f.voo)).toEqual(["LA8084", "IB3106"]);
    const limit = await (await call(key, "?dias=99")).json();
    expect(limit.data.length).toBe(2);
  });
});
