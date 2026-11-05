"use client";
import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Ev = { date: string; kind: "Tarefa" | "Embarque" | "Aniversário" | "Crédito"; title: string; href: string | null; done?: boolean };

const KIND: Record<Ev["kind"], { dot: string; chip: string }> = {
  Tarefa: { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-700" },
  Embarque: { dot: "bg-brand-600", chip: "bg-brand-50 text-brand-700" },
  Aniversário: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800" },
  Crédito: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
};
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function CalendarGrid({ month, label, today, events }: { month: string; label: string; today: string; events: Ev[] }) {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const defaultDay = today.startsWith(month) ? today : `${month}-01`;
  const [selected, setSelected] = useState(defaultDay);
  const byDay = new Map<string, Ev[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const dayEvents = byDay.get(selected) ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold first-letter:uppercase">{label}</h2>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            {(Object.keys(KIND) as Ev["kind"][]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", KIND[k].dot)} /> {k}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-7 border-b border-line bg-brand-25 text-center text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          {WEEK.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="min-h-24 border-b border-r border-line/70 bg-slate-50/50" />;
            const evs = byDay.get(d) ?? [];
            const isToday = d === today;
            const isSel = d === selected;
            return (
              <button
                key={d}
                onClick={() => setSelected(d)}
                className={cn("min-h-24 border-b border-r border-line/70 p-1.5 text-left align-top transition-colors hover:bg-brand-25", isSel && "bg-brand-50/70")}
                aria-label={`Dia ${Number(d.slice(8))}${evs.length ? `, ${evs.length} evento(s)` : ""}`}
              >
                <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium", isToday ? "bg-brand-600 text-white" : "text-slate-700")}>{Number(d.slice(8))}</span>
                <div className="mt-1 space-y-0.5">
                  {evs.slice(0, 3).map((e, j) => (
                    <span key={j} className={cn("block truncate rounded px-1 py-0.5 text-[10.5px] font-medium", KIND[e.kind].chip, e.done && "line-through opacity-60")}>
                      {e.title}
                    </span>
                  ))}
                  {evs.length > 3 && <span className="block px-1 text-[10.5px] text-muted">+{evs.length - 3} mais</span>}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
      <Card className="h-fit">
        <div className="border-b border-line px-5 py-3.5">
          <p className="text-[15px] font-semibold first-letter:uppercase">{new Date(`${selected}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</p>
          <p className="text-xs text-muted">{dayEvents.length ? `${dayEvents.length} evento(s)` : "Nenhum evento neste dia"}</p>
        </div>
        {dayEvents.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">Clique em um dia para ver os eventos.</p>
        ) : (
          <ul className="divide-y divide-line">
            {dayEvents.map((e, i) => {
              const body = (
                <span className="flex items-start gap-3 px-5 py-3">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", KIND[e.kind].dot)} />
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-medium text-ink", e.done && "line-through opacity-60")}>{e.title}</span>
                    <span className="block text-xs text-muted">
                      {e.kind} · {formatDate(e.date)}
                    </span>
                  </span>
                </span>
              );
              return (
                <li key={i}>
                  {e.href ? (
                    <Link href={e.href} className="block transition-colors hover:bg-slate-50">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
