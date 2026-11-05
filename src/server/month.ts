import { cookies } from "next/headers";
import { endOfMonth, todayIn } from "@/lib/dates";

/** Mês de trabalho escolhido no cabeçalho (cookie fg_mes = "YYYY-MM"); padrão: mês atual da agência. */
export type WorkMonth = { month: string; from: string; to: string; label: string; isCurrent: boolean; today: string };

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" });
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${y}`;
}

export async function workMonth(timezone: string): Promise<WorkMonth> {
  const today = todayIn(timezone);
  const jar = await cookies();
  const raw = jar.get("fg_mes")?.value;
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : today.slice(0, 7);
  const from = `${month}-01`;
  return { month, from, to: endOfMonth(from), label: monthLabel(month), isCurrent: month === today.slice(0, 7), today };
}

/** Período da tela: o preset escolhido é calculado a partir do mês de trabalho do cabeçalho. */
export async function pagePeriod(timezone: string, preset?: string, from?: string, to?: string) {
  const { resolvePeriod } = await import("@/lib/dates");
  const wm = await workMonth(timezone);
  const ref = wm.isCurrent ? wm.today : wm.from;
  return { ...resolvePeriod(preset, ref, from, to), workMonth: wm };
}
