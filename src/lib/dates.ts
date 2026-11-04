// Datas de calendário como "YYYY-MM-DD" (sem horário), interpretadas no fuso da agência.

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Data de hoje no fuso horário informado. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

function toUTC(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: string, days: number): string {
  const d = toUTC(s);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/** Soma meses mantendo o dia quando possível (31/01 + 1 mês => 28 ou 29/02). */
export function addMonths(s: string, months: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return fromUTC(target);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86400000);
}

export function startOfMonth(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s: string): string {
  const [y, m] = s.split("-").map(Number);
  return fromUTC(new Date(Date.UTC(y, m, 0)));
}

/** Segunda-feira da semana da data. */
export function startOfWeek(s: string): string {
  const d = toUTC(s);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(s, -dow);
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]}/${String(y).slice(2)}`;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTime(d: Date | string | null | undefined, timezone = "America/Sao_Paulo"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(typeof d === "string" ? new Date(d) : d);
}

/** Converte "dd/mm/aaaa" em "aaaa-mm-dd" (usado na importação de CSV). */
export function parseBrDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return isIsoDate(iso) ? iso : null;
  }
  return isIsoDate(s.trim()) ? s.trim() : null;
}

export type Period = { from: string; to: string };

export function resolvePeriod(
  preset: string | undefined,
  today: string,
  from?: string,
  to?: string,
): Period & { preset: string } {
  switch (preset) {
    case "ultimo-mes": {
      const prev = addMonths(startOfMonth(today), -1);
      return { preset, from: prev, to: endOfMonth(prev) };
    }
    case "trimestre":
      return { preset, from: addMonths(startOfMonth(today), -2), to: endOfMonth(today) };
    case "ano":
      return { preset, from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case "12-meses":
      return { preset, from: addMonths(startOfMonth(today), -11), to: endOfMonth(today) };
    case "personalizado":
      if (isIsoDate(from) && isIsoDate(to) && from <= to) return { preset, from, to };
      return { preset: "mes", from: startOfMonth(today), to: endOfMonth(today) };
    default:
      return { preset: "mes", from: startOfMonth(today), to: endOfMonth(today) };
  }
}

/** Período anterior de mesma duração (para comparação). */
export function previousPeriod(p: Period): Period {
  const len = diffDays(p.to, p.from) + 1;
  // se for mês cheio, compara com mês anterior cheio
  if (p.from === startOfMonth(p.from) && p.to === endOfMonth(p.to)) {
    const months =
      (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 +
      Number(p.to.slice(5, 7)) -
      Number(p.from.slice(5, 7)) +
      1;
    const from = addMonths(p.from, -months);
    return { from, to: endOfMonth(addMonths(p.to, -months)) };
  }
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = startOfMonth(from);
  while (cur <= to) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}
