/** Módulos por agência e monitor de voos (AeroDataBox simulado; nenhuma chamada real). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { loadContext, today, type Ctx } from "@/server/context";
import { addDays } from "@/lib/dates";
import { enabledModules, moduleForPath } from "@/lib/modules";
import { createSale } from "@/server/services/sales";
import { saveFlight } from "@/server/services/flights";
import { checkCompanyFlights, detectAlerts, monitorStatus, openFlightAlerts, resolveFlightAlert, saveMonitorSettings, checkNow } from "@/server/services/flight-monitor";
import { setCompanyModule } from "@/server/platform";
import { clientMessage } from "@/lib/flight-alerts";
import { makeCompany, exampleSale } from "./helpers";

vi.mock("server-only", () => ({}));

describe("módulos por agência", () => {
  it("padrão, sobrescrita e caminho de cada módulo", () => {
    const def = enabledModules("{}");
    expect(def.has("clientes")).toBe(true);
    expect(def.has("monitor_voos")).toBe(false);
    const custom = enabledModules(JSON.stringify({ clientes: false, monitor_voos: true }));
    expect(custom.has("clientes")).toBe(false);
    expect(custom.has("monitor_voos")).toBe(true);
    expect(enabledModules("lixo").has("vendas")).toBe(true);
    expect(moduleForPath("/clientes/abc")?.key).toBe("clientes");
    expect(moduleForPath("/configuracoes/categorias")?.key).toBe("financeiro");
    expect(moduleForPath("/configuracoes")).toBeNull();
    expect(moduleForPath("/")).toBeNull();
  });

  it("a plataforma liga e desliga e o contexto do usuário acompanha", async () => {
    const env = await makeCompany("Módulos");
    const p = { id: "plataforma-teste", name: "Equipe", email: "x@x.com" } as never;
    await setCompanyModule(p, env.company.id, "clientes", false);
    let ctx = (await loadContext(env.admin.userId)) as Ctx;
    expect(ctx.modules.has("clientes")).toBe(false);
    await setCompanyModule(p, env.company.id, "clientes", true);
    ctx = (await loadContext(env.admin.userId)) as Ctx;
    expect(ctx.modules.has("clientes")).toBe(true);
    await expect(setCompanyModule(p, env.company.id, "nao-existe", true)).rejects.toThrow(/desconhecido/);
  });
});

describe("monitor de voos", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  let t: string;
  let saleId: string;
  const calls: string[] = [];
  let mode: "ok" | "sem-assinatura" = "ok";
  const answers: Record<string, unknown[]> = {};
  beforeAll(async () => {
    env = await makeCompany("Monitor de voos");
    t = today(env.company);
    const s = await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { saleDate: t, tripStart: t, tripEnd: addDays(t, 5), confirm: true }));
    saleId = s.id;
    await saveFlight(env.seller, saleId, null, { airline: "LA", flightNumber: "8084", origin: "GRU", destination: "MAD", departureAt: `${t}T10:00` });
    await saveFlight(env.seller, saleId, null, { airline: "G3", flightNumber: "1234", origin: "CGH", destination: "SDU", departureAt: `${t}T13:00` });
    await saveFlight(env.seller, saleId, null, { airline: "TP", flightNumber: "88", origin: "GRU", destination: "LIS", departureAt: `${addDays(t, 1)}T21:00` });
    await saveFlight(env.seller, saleId, null, { airline: "AD", flightNumber: "4000", origin: "VCP", destination: "REC", departureAt: `${addDays(t, 1)}T09:00` });
    answers["LA8084"] = [{ status: "Canceled", departure: { airport: { iata: "GRU" }, scheduledTime: { local: `${t} 10:00-03:00` }, gate: "B12" } }];
    answers["G31234"] = [{ status: "Delayed", departure: { airport: { iata: "CGH" }, scheduledTime: { local: `${t} 13:00-03:00` }, revisedTime: { local: `${t} 14:20-03:00` }, terminal: "1", gate: "7" } }];
    answers["TP88"] = [{ status: "Expected", departure: { airport: { iata: "GRU" }, scheduledTime: { local: `${addDays(t, 1)} 22:30-03:00` } } }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push(url);
        if (mode === "sem-assinatura") return new Response(JSON.stringify({ message: "No active Subscription found." }), { status: 400 });
        if (new Headers(init?.headers).get("x-api-market-key") !== "chave-de-teste-123") return new Response("{}", { status: 401 });
        const flight = decodeURIComponent(url.split("/flights/number/")[1].split("/")[0]);
        return answers[flight] ? new Response(JSON.stringify(answers[flight]), { status: 200 }) : new Response(null, { status: 204 });
      }),
    );
  });
  afterAll(() => vi.unstubAllGlobals());

  it("compara a resposta do AeroDataBox com o voo da venda", () => {
    const seg = { departureAt: "2026-11-12T13:00" };
    expect(detectAlerts(seg, { status: "Expected", departure: { scheduledTime: { local: "2026-11-12 13:05-03:00" } } }).alerts).toEqual([]);
    expect(detectAlerts(seg, { status: "Canceled", departure: { scheduledTime: { local: "2026-11-12 13:00-03:00" } } }).alerts.map((a) => a.kind)).toEqual(["CANCELADO"]);
    expect(detectAlerts(seg, { status: "Delayed", departure: { scheduledTime: { local: "2026-11-12 13:00-03:00" }, revisedTime: { local: "2026-11-12 13:40-03:00" } } }).alerts.map((a) => [a.kind, a.newTimeAt])).toEqual([["ATRASO", "2026-11-12T13:40"]]);
    expect(detectAlerts(seg, { status: "Expected", departure: { scheduledTime: { local: "2026-11-12 15:00-03:00" } } }).alerts.map((a) => a.kind)).toEqual(["HORARIO"]);
  });

  it("não consulta nada com o módulo desligado ou sem chave", async () => {
    expect(await checkCompanyFlights(env.company.id)).toMatchObject({ skipped: "módulo desligado" });
    await prisma.company.update({ where: { id: env.company.id }, data: { modulesJson: JSON.stringify({ monitor_voos: true }) } });
    await prisma.platformSetting.deleteMany({ where: { key: "aerodatabox" } });
    expect(await checkCompanyFlights(env.company.id)).toMatchObject({ skipped: "chave do AeroDataBox não configurada" });
    expect(calls).toHaveLength(0);
  });

  it("confere os voos de hoje e amanhã, cria os alertas e não consulta o mesmo voo duas vezes no dia", async () => {
    await saveMonitorSettings({ key: "chave-de-teste-123", marketplace: "apimarket", maxPerRun: 60 });
    expect((await prisma.platformSetting.findUniqueOrThrow({ where: { key: "aerodatabox" } })).value).not.toContain("chave-de-teste-123");
    const r = await checkCompanyFlights(env.company.id);
    expect(r).toMatchObject({ checked: 4, alerts: 3, notFound: 1, error: null });
    expect(calls[0]).toContain("https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/LA8084/");
    const ctx = (await loadContext(env.admin.userId)) as Ctx;
    const alerts = await openFlightAlerts(ctx);
    expect(alerts.map((a) => a.kind).sort()).toEqual(["ATRASO", "CANCELADO", "HORARIO"]);
    const seg = await prisma.flightSegment.findFirstOrThrow({ where: { saleId, flightNumber: "1234" } });
    expect(seg).toMatchObject({ liveStatus: "Delayed", liveRevisedAt: `${t}T14:20`, liveGate: "7", lastCheckedOn: t });
    // de novo no mesmo dia: nenhuma consulta nova
    const before = calls.length;
    expect(await checkCompanyFlights(env.company.id)).toMatchObject({ checked: 0 });
    expect(calls.length).toBe(before);
    expect((await monitorStatus()).queries).toBeGreaterThanOrEqual(4);
    // mensagem pronta para o cliente
    const cancel = alerts.find((a) => a.kind === "CANCELADO")!;
    expect(clientMessage(cancel, "Maria Cliente", "Azul Viagens")).toMatch(/^Oi, Maria! O voo LA 8084 GRU → MAD do dia .* foi cancelado/);
    // resolver tira da lista
    await resolveFlightAlert(ctx, cancel.id);
    expect((await openFlightAlerts(ctx)).map((a) => a.kind)).not.toContain("CANCELADO");
  });

  it("para a rodada quando o plano recusa (sem assinatura ou cota)", async () => {
    await prisma.flightSegment.updateMany({ where: { saleId }, data: { lastCheckedOn: null } });
    mode = "sem-assinatura";
    const before = calls.length;
    const r = await checkCompanyFlights(env.company.id);
    expect((r as { error: string | null }).error).toMatch(/No active Subscription/);
    expect(calls.length - before).toBe(1);
    expect((await monitorStatus()).lastError).toMatch(/No active Subscription/);
    mode = "ok";
  });

  it("o botão da Central exige o módulo ligado", async () => {
    const other = await makeCompany("Sem monitor");
    await expect(checkNow(other.admin)).rejects.toThrow(/não está disponível/);
    expect(await openFlightAlerts(other.admin)).toEqual([]);
  });
});
