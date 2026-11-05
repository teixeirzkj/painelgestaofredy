"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function label(month: string) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" });
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} de ${y}`;
}

/** Seletor do mês de trabalho: vale para dashboard, financeiro, DRE, comissões e demais telas mensais. */
export function MonthPicker({ month, current, compact }: { month: string; current: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const pick = (m: string) => {
    document.cookie = `fg_mes=${m}; path=/; max-age=31536000; samesite=lax`;
    setOpen(false);
    start(() => router.refresh());
  };
  const shift = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    pick(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div ref={ref} className="relative flex items-center">
      {!compact && (
        <button onClick={() => shift(-1)} className="hidden h-9 w-7 items-center justify-center rounded-l-xl text-muted hover:text-ink md:flex" aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={() => {
          setYear(Number(month.slice(0, 4)));
          setOpen((v) => !v);
        }}
        className="flex h-9 items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 text-sm font-semibold text-ink transition-colors hover:border-brand-200"
        aria-label="Mês de referência"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : <CalendarDays className="h-4 w-4 text-brand-600" />}
        <span className="hidden sm:inline">{label(month)}</span>
        <span className="sm:hidden">{MONTHS[Number(month.slice(5, 7)) - 1]}/{month.slice(2, 4)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {!compact && (
        <button onClick={() => shift(1)} className="hidden h-9 w-7 items-center justify-center rounded-r-xl text-muted hover:text-ink md:flex" aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 animate-pop-in rounded-xl border border-line bg-white p-3 shadow-[var(--shadow-pop)]">
          <div className="mb-2 flex items-center justify-between">
            <button onClick={() => setYear(year - 1)} className="rounded-lg p-1.5 text-muted hover:bg-brand-25 hover:text-ink" aria-label="Ano anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold">{year}</span>
            <button onClick={() => setYear(year + 1)} className="rounded-lg p-1.5 text-muted hover:bg-brand-25 hover:text-ink" aria-label="Próximo ano">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {MONTHS.map((name, i) => {
              const m = `${year}-${String(i + 1).padStart(2, "0")}`;
              return (
                <button
                  key={m}
                  onClick={() => pick(m)}
                  className={cn(
                    "rounded-lg py-2 text-sm capitalize transition-colors",
                    m === month ? "bg-brand-600 font-semibold text-white" : m === current ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-brand-25",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {month !== current && (
            <button onClick={() => pick(current)} className="mt-2 w-full rounded-lg py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-25">
              Voltar para o mês atual
            </button>
          )}
        </div>
      )}
    </div>
  );
}
