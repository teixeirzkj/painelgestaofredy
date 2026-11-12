/**
 * Monitor de voos (módulo "monitor_voos", ligado por agência na plataforma).
 *
 * Uma vez por dia confere no AeroDataBox (API oficial, plano da plataforma) os voos dos clientes de hoje e
 * amanhã e grava a situação: cancelado, possível cancelamento, atraso, horário mudado pela companhia e desvio.
 * Cada voo é consultado no máximo 1 vez por dia (2 unidades do plano por consulta).
 * Os alertas ficam na Central da Viagem até alguém marcar como resolvidos.
 *
 * Endereços e campos conferidos na especificação oficial (doc.aerodatabox.com, OpenAPI v1):
 * GET {base}/flights/number/{voo}/{dataLocal}?dateLocalRole=Departure → FlightContract[]
 * (status, departure.scheduledTime.local, departure.revisedTime.local, departure.predictedTime.local,
 *  departure.terminal, departure.gate, arrival.airport.iata).
 */
import { prisma } from "../db";
import { assertCan, assertModule, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../secrets";
import { addDays } from "@/lib/dates";
import { saleScope } from "./sales";

export const MONITOR_MODULE = "monitor_voos";
const SETTINGS_KEY = "aerodatabox";
const USAGE_PREFIX = "aerodatabox.uso.";
const UNITS_PER_QUERY = 2;
export const DELAY_ALERT_MIN = 30;
const SCHEDULE_CHANGE_MIN = 15;

type Marketplace = "apimarket" | "rapidapi" | "direct";
type MonitorSettings = { keyEnc: string | null; marketplace: Marketplace; maxPerRun: number; lastError: string | null; lastRunAt: string | null };

const DEFAULTS: MonitorSettings = { keyEnc: null, marketplace: "apimarket", maxPerRun: 60, lastError: null, lastRunAt: null };

async function readSettings(): Promise<MonitorSettings> {
  const row = await prisma.platformSetting.findUnique({ where: { key: SETTINGS_KEY } });
  try {
    return { ...DEFAULTS, ...(row ? JSON.parse(row.value) : {}) };
  } catch {
    return DEFAULTS;
  }
}
async function writeSettings(patch: Partial<MonitorSettings>) {
  const value = JSON.stringify({ ...(await readSettings()), ...patch });
  await prisma.platformSetting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value }, update: { value } });
}
async function bump(key: string, units: number) {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  const value = String((Number(row?.value) || 0) + units);
  await prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
/** Conta o consumo do mês: total da plataforma e da agência. */
async function addUsage(units: number, companyId: string) {
  const month = new Date().toISOString().slice(0, 7);
  await bump(USAGE_PREFIX + month, units);
  await bump(`${USAGE_PREFIX}${companyId}.${month}`, units);
}

// ------------------------------ Chave própria da agência (opcional) ------------------------------

type CompanyMonitor = { keyEnc: string | null; marketplace: Marketplace; lastError: string | null; lastRunAt: string | null };
const companyKey = (companyId: string) => `${SETTINGS_KEY}.agencia.${companyId}`;

async function readCompanySettings(companyId: string): Promise<CompanyMonitor> {
  const row = await prisma.platformSetting.findUnique({ where: { key: companyKey(companyId) } });
  try {
    return { keyEnc: null, marketplace: "apimarket", lastError: null, lastRunAt: null, ...(row ? JSON.parse(row.value) : {}) };
  } catch {
    return { keyEnc: null, marketplace: "apimarket", lastError: null, lastRunAt: null };
  }
}
async function writeCompanySettings(companyId: string, patch: Partial<CompanyMonitor>) {
  const value = JSON.stringify({ ...(await readCompanySettings(companyId)), ...patch });
  await prisma.platformSetting.upsert({ where: { key: companyKey(companyId) }, create: { key: companyKey(companyId), value }, update: { value } });
}

/** Página da agência na plataforma: se tem chave própria, consumo do mês e último resultado. */
export async function companyMonitorStatus(companyId: string) {
  const c = await readCompanySettings(companyId);
  const month = new Date().toISOString().slice(0, 7);
  const units = Number((await prisma.platformSetting.findUnique({ where: { key: `${USAGE_PREFIX}${companyId}.${month}` } }))?.value) || 0;
  return { ownKey: !!c.keyEnc, marketplace: c.marketplace, lastError: c.lastError, lastRunAt: c.lastRunAt, month, unitsUsed: units, queries: units / UNITS_PER_QUERY };
}

/** Grava (ou remove) a chave do AeroDataBox só desta agência. Sem chave própria, ela usa a da plataforma. */
export async function saveCompanyMonitorKey(companyId: string, input: { key?: string | null; marketplace?: string; remove?: boolean }) {
  if (input.remove) return writeCompanySettings(companyId, { keyEnc: null, lastError: null });
  const patch: Partial<CompanyMonitor> = {};
  if (typeof input.key === "string" && input.key.trim()) {
    const k = input.key.trim();
    if (k.length < 10 || /s/.test(k)) throw new AppError("Chave do AeroDataBox inválida.");
    patch.keyEnc = encryptSecret(k);
    patch.lastError = null;
  }
  if (input.marketplace) {
    if (!["apimarket", "rapidapi", "direct"].includes(input.marketplace)) throw new AppError("Marketplace inválido.");
    patch.marketplace = input.marketplace as Marketplace;
  }
  await writeCompanySettings(companyId, patch);
}

/** Para o painel da plataforma: configuração (sem a chave) e consumo do mês. */
export async function monitorStatus() {
  const s = await readSettings();
  const month = new Date().toISOString().slice(0, 7);
  const usage = Number((await prisma.platformSetting.findUnique({ where: { key: USAGE_PREFIX + month } }))?.value) || 0;
  const companies = await prisma.company.findMany({ where: { active: true }, select: { modulesJson: true } });
  const enabled = companies.filter((c) => {
    try {
      return JSON.parse(c.modulesJson || "{}")[MONITOR_MODULE] === true;
    } catch {
      return false;
    }
  }).length;
  return { configured: !!s.keyEnc, marketplace: s.marketplace, maxPerRun: s.maxPerRun, lastError: s.lastError, lastRunAt: s.lastRunAt, month, unitsUsed: usage, queries: usage / UNITS_PER_QUERY, companiesEnabled: enabled };
}

/** Grava a chave do AeroDataBox (criptografada) e o limite de consultas por rodada. Só a plataforma chama. */
export async function saveMonitorSettings(input: { key?: string | null; marketplace?: string; maxPerRun?: number }) {
  const patch: Partial<MonitorSettings> = {};
  if (typeof input.key === "string" && input.key.trim()) {
    const k = input.key.trim();
    if (k.length < 10 || /\s/.test(k)) throw new AppError("Chave do AeroDataBox inválida.");
    patch.keyEnc = encryptSecret(k);
    patch.lastError = null;
  }
  if (input.marketplace) {
    if (!["apimarket", "rapidapi", "direct"].includes(input.marketplace)) throw new AppError("Marketplace inválido.");
    patch.marketplace = input.marketplace as Marketplace;
  }
  if (input.maxPerRun !== undefined) {
    const n = Math.floor(Number(input.maxPerRun));
    if (!Number.isFinite(n) || n < 1 || n > 2000) throw new AppError("Limite por rodada entre 1 e 2000 consultas.");
    patch.maxPerRun = n;
  }
  await writeSettings(patch);
}

// ------------------------------ Cliente AeroDataBox ------------------------------

export type AdbFlight = {
  status?: string;
  departure?: { airport?: { iata?: string }; scheduledTime?: { local?: string }; revisedTime?: { local?: string }; predictedTime?: { local?: string }; terminal?: string; gate?: string };
  arrival?: { airport?: { iata?: string } };
};

class SubscriptionError extends AppError {}

async function queryFlight(s: Pick<MonitorSettings, "keyEnc" | "marketplace">, flight: string, date: string, companyId: string): Promise<AdbFlight[]> {
  const key = decryptSecret(s.keyEnc!);
  const base = s.marketplace === "rapidapi" ? "https://aerodatabox.p.rapidapi.com" : s.marketplace === "direct" ? "https://api.aerodatabox.com" : "https://prod.api.market/api/v1/aedbx/aerodatabox";
  const headers: Record<string, string> =
    s.marketplace === "rapidapi" ? { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" } : s.marketplace === "direct" ? { "X-Api-Key": key } : { "x-api-market-key": key };
  const res = await fetch(`${base}/flights/number/${encodeURIComponent(flight)}/${date}?dateLocalRole=Departure&withAircraftImage=false&withLocation=false`, {
    headers: { ...headers, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  await addUsage(UNITS_PER_QUERY, companyId);
  if (res.status === 204 || res.status === 404) return [];
  const text = await res.text();
  if (!res.ok) {
    const msg = (() => {
      try {
        return JSON.parse(text).message as string;
      } catch {
        return text.slice(0, 120);
      }
    })();
    // sem assinatura, cota acabou ou chave errada: para a rodada inteira
    if ([400, 401, 403, 429].includes(res.status)) throw new SubscriptionError(`AeroDataBox recusou (${res.status}): ${msg}`);
    throw new AppError(`AeroDataBox respondeu ${res.status}: ${msg}`);
  }
  if (!text) return [];
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [];
}

// ------------------------------ Conferência ------------------------------

const minutes = (s?: string | null) => (s ? Date.parse(String(s).slice(0, 16).replace(" ", "T") + ":00Z") / 60000 : NaN);
const local = (s?: string | null) => (s ? String(s).slice(0, 16).replace(" ", "T") : null);

/** Compara a resposta do AeroDataBox com o voo da venda e devolve os alertas. Função pura (testada). */
export function detectAlerts(seg: { departureAt: string }, f: AdbFlight) {
  const out: { kind: string; newTimeAt: string | null; detail: string | null; dedupe: string }[] = [];
  const dep = f.departure ?? {};
  const scheduled = local(dep.scheduledTime?.local);
  const revised = local(dep.revisedTime?.local ?? dep.predictedTime?.local);
  const gate = [dep.terminal ? `Terminal ${dep.terminal}` : null, dep.gate ? `Portão ${dep.gate}` : null].filter(Boolean).join(" · ") || null;
  if (f.status === "Canceled") out.push({ kind: "CANCELADO", newTimeAt: null, detail: gate, dedupe: "CANCELADO" });
  else if (f.status === "CanceledUncertain") out.push({ kind: "POSSIVEL_CANCELAMENTO", newTimeAt: null, detail: gate, dedupe: "POSSIVEL" });
  if (f.status === "Diverted") out.push({ kind: "DESVIADO", newTimeAt: null, detail: f.arrival?.airport?.iata ? `Desviado para ${f.arrival.airport.iata}` : null, dedupe: "DESVIADO" });
  if (scheduled && Math.abs(minutes(scheduled) - minutes(seg.departureAt)) >= SCHEDULE_CHANGE_MIN) out.push({ kind: "HORARIO", newTimeAt: scheduled, detail: gate, dedupe: `HORARIO:${scheduled}` });
  if (f.status !== "Canceled" && scheduled && revised && minutes(revised) - minutes(scheduled) >= DELAY_ALERT_MIN) out.push({ kind: "ATRASO", newTimeAt: revised, detail: gate, dedupe: `ATRASO:${revised}` });
  else if (f.status === "Delayed" && !out.some((a) => a.kind === "ATRASO")) out.push({ kind: "ATRASO", newTimeAt: revised, detail: gate, dedupe: `ATRASO:${revised ?? "sem-horario"}` });
  return { alerts: out, scheduled, revised, terminal: dep.terminal ?? null, gate: dep.gate ?? null };
}

/**
 * Confere os voos de hoje e amanhã de uma agência (no máximo 1 consulta por voo por dia e o limite por rodada).
 * Devolve o resumo. Sem chave configurada ou com o módulo desligado, não consulta nada.
 */
export async function checkCompanyFlights(companyId: string) {
  const s = await readSettings();
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, timezone: true, active: true, modulesJson: true } });
  if (!company?.active) return { skipped: "agência inativa" };
  const on = (() => {
    try {
      return JSON.parse(company.modulesJson || "{}")[MONITOR_MODULE] === true;
    } catch {
      return false;
    }
  })();
  if (!on) return { skipped: "módulo desligado" };
  // chave própria da agência, se houver; senão a da plataforma
  const own = await readCompanySettings(companyId);
  const key = own.keyEnc ? { keyEnc: own.keyEnc, marketplace: own.marketplace } : { keyEnc: s.keyEnc, marketplace: s.marketplace };
  if (!key.keyEnc) return { skipped: "chave do AeroDataBox não configurada" };
  const t = today(company);
  const flights = await prisma.flightSegment.findMany({
    where: {
      companyId,
      departureAt: { gte: t, lt: addDays(t, 2) },
      OR: [{ lastCheckedOn: null }, { lastCheckedOn: { not: t } }],
      sale: { status: { in: ["CONFIRMADA", "CONCLUIDA"] } },
    },
    orderBy: { departureAt: "asc" },
    take: s.maxPerRun,
  });
  const result = { checked: 0, alerts: 0, notFound: 0, error: null as string | null };
  for (const seg of flights) {
    let list: AdbFlight[];
    try {
      list = await queryFlight(key, `${seg.airline}${seg.flightNumber}`, seg.departureAt.slice(0, 10), companyId);
    } catch (e) {
      result.error = (e as Error).message;
      if (e instanceof SubscriptionError) break;
      continue;
    }
    result.checked++;
    const f = list.find((x) => x?.departure?.airport?.iata === seg.origin) ?? list[0];
    if (!f) {
      result.notFound++;
      await prisma.flightSegment.update({ where: { id: seg.id }, data: { liveStatus: "NAO_ENCONTRADO", lastCheckedOn: t, lastCheckedAt: new Date() } });
      continue;
    }
    const d = detectAlerts(seg, f);
    await prisma.flightSegment.update({
      where: { id: seg.id },
      data: { liveStatus: f.status ?? "Unknown", liveScheduledAt: d.scheduled, liveRevisedAt: d.revised, liveTerminal: d.terminal, liveGate: d.gate, lastCheckedOn: t, lastCheckedAt: new Date() },
    });
    for (const a of d.alerts) {
      const dedupeKey = `${seg.id}:${a.dedupe}`;
      const exists = await prisma.flightChange.findUnique({ where: { companyId_dedupeKey: { companyId, dedupeKey } } });
      if (exists) continue;
      await prisma.flightChange.create({
        data: { companyId, saleId: seg.saleId, flightSegmentId: seg.id, kind: a.kind, flight: `${seg.airline} ${seg.flightNumber} ${seg.origin} → ${seg.destination}`, departureAt: seg.departureAt, newTimeAt: a.newTimeAt, detail: a.detail, dedupeKey },
      });
      result.alerts++;
    }
  }
  const stamp = { lastRunAt: new Date().toISOString(), lastError: result.error };
  await writeCompanySettings(companyId, stamp);
  if (!own.keyEnc) await writeSettings(stamp); // erro da chave geral aparece também no quadro da plataforma
  return result;
}

/** Rodada diária (cron): todas as agências com o módulo ligado. */
export async function runFlightMonitor() {
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true, modulesJson: true } });
  const out: Record<string, unknown> = {};
  for (const c of companies) {
    let on = false;
    try {
      on = JSON.parse(c.modulesJson || "{}")[MONITOR_MODULE] === true;
    } catch {
      on = false;
    }
    if (!on) continue;
    try {
      out[c.id] = await checkCompanyFlights(c.id);
    } catch (e) {
      out[c.id] = { error: (e as Error).message };
    }
  }
  return out;
}

/** Botão "Conferir agora" da Central (respeita 1 consulta por voo por dia). */
export async function checkNow(ctx: Ctx) {
  assertModule(ctx, MONITOR_MODULE);
  assertCan(ctx, "sales.view_all");
  return checkCompanyFlights(ctx.companyId);
}

/** Alertas em aberto, no alcance do usuário. */
export async function openFlightAlerts(ctx: Ctx) {
  if (!ctx.modules.has(MONITOR_MODULE)) return [];
  return prisma.flightChange.findMany({
    where: { companyId: ctx.companyId, resolvedAt: null, sale: saleScope(ctx) },
    include: { sale: { select: { id: true, code: true, passengerCount: true, client: { select: { name: true, whatsapp: true, phone: true } } } } },
    orderBy: { detectedAt: "desc" },
    take: 100,
  });
}

export async function resolveFlightAlert(ctx: Ctx, id: string) {
  assertModule(ctx, MONITOR_MODULE);
  const a = await prisma.flightChange.findFirst({ where: { id, companyId: ctx.companyId, sale: saleScope(ctx) } });
  if (!a) throw new AppError("Alerta não encontrado.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.flightChange.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: ctx.userId } });
    await audit(tx, ctx, "voo.alerta_resolvido", "Sale", a.saleId, { voo: a.flight, tipo: a.kind });
  });
}
