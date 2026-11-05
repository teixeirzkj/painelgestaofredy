"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { Card } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Ev = { id: string; date: string; kind: "in" | "out"; description: string; amountCents: number; paid: boolean; overdue: boolean; href: string };
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtDay(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Grade mensal: clique em um dia para ver os lançamentos; clique em outro para ver o período entre os dois. */
export function CalendarGrid({ month, today, events, holidays }: { month: string; today: string; events: Ev[]; holidays: Record<string, string> }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const initial = today.startsWith(month) ? today : iso(1);
  const [sel, setSel] = useState<{ from: string; to: string }>({ from: initial, to: initial });
  const byDay = useMemo(() => {
    const map = new Map<string, Ev[]>();
    for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [events]);
  const click = (d: string) => {
    if (sel.from === sel.to && d !== sel.from) setSel(d < sel.from ? { from: d, to: sel.from } : { from: sel.from, to: d });
    else setSel({ from: d, to: d });
  };
  const selected = events.filter((e) => e.date >= sel.from && e.date <= sel.to).sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const ins = selected.filter((e) => e.kind === "in").reduce((a, e) => a + e.amountCents, 0);
  const outs = selected.filter((e) => e.kind === "out").reduce((a, e) => a + e.amountCents, 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-brand-25 text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          {WEEK.map((w) => (
            <div key={w} className="py-2.5">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: lead }).map((_, i) => (
            <div key={`l${i}`} className="min-h-24 border-b border-r border-line bg-slate-50/50" />
          ))}
          {Array.from({ length: days }, (_, i) => i + 1).map((n) => {
            const d = iso(n);
            const evs = byDay.get(d) ?? [];
            const inSum = evs.filter((e) => e.kind === "in").reduce((a, e) => a + e.amountCents, 0);
            const outSum = evs.filter((e) => e.kind === "out").reduce((a, e) => a + e.amountCents, 0);
            const isSel = d >= sel.from && d <= sel.to;
            const weekend = (lead + n - 1) % 7 === 0 || (lead + n - 1) % 7 === 6;
            return (
              <button
                key={d}
                onClick={() => click(d)}
                className={cn("min-h-24 border-b border-r border-line p-2 text-left align-top transition-colors hover:bg-brand-25", weekend && "bg-slate-50/60", isSel && "bg-brand-50 hover:bg-brand-50")}
              >
                <div className="flex items-center gap-1.5">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", d === today ? "bg-brand-600 text-white" : "text-ink")}>{n}</span>
                  {holidays[d] && <span className="truncate rounded bg-violet-50 px-1 text-[10px] font-medium text-violet-700">{holidays[d]}</span>}
                </div>
                {inSum > 0 && <p className="mt-1.5 truncate text-[11px] font-medium text-success">+ {formatBRL(inSum)}</p>}
                {outSum > 0 && <p className="truncate text-[11px] font-medium text-danger">− {formatBRL(outSum)}</p>}
                {evs.some((e) => e.overdue) && <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-warning" title="Há pendências vencidas" />}
              </button>
            );
          })}
        </div>
        <p className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-muted">
          <Info className="h-3.5 w-3.5" /> Clique em outro dia para ver um período; clique de novo para voltar a um dia só.
        </p>
      </Card>
      <Card className="h-fit xl:sticky xl:top-20">
        <div className="border-b border-line px-5 py-4">
          <p className="font-semibold text-ink first-letter:uppercase">{sel.from === sel.to ? fmtDay(sel.from) : `${fmtDay(sel.from)} a ${fmtDay(sel.to)}`}</p>
          <p className="text-xs text-muted">{selected.length ? `${selected.length} lançamento(s)` : "Nenhum lançamento neste período"}</p>
        </div>
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {selected.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              <Link href={e.href} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", e.kind === "in" ? "bg-success" : "bg-danger")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{e.description}</span>
                  <span className="block text-[11px] text-muted">
                    {e.paid ? (e.kind === "in" ? "recebido" : "pago") : e.overdue ? "vencido" : "previsto"}
                    {sel.from !== sel.to && ` · ${e.date.split("-").reverse().slice(0, 2).join("/")}`}
                  </span>
                </span>
                <span className={cn("text-sm font-medium tabular", e.kind === "in" ? "text-success" : "text-danger")}>{formatBRL(e.amountCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-3 gap-2 border-t border-line px-5 py-3 text-xs">
          <div>
            <p className="font-semibold uppercase tracking-[0.08em] text-muted">Entradas</p>
            <p className="font-semibold text-success">{formatBRL(ins)}</p>
          </div>
          <div>
            <p className="font-semibold uppercase tracking-[0.08em] text-muted">Saídas</p>
            <p className="font-semibold text-danger">{formatBRL(outs)}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold uppercase tracking-[0.08em] text-muted">Saldo</p>
            <p className={cn("font-semibold", ins - outs < 0 ? "text-danger" : "text-success")}>{formatBRL(ins - outs)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
