"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Formulário de filtros via URL (GET). Aplica automaticamente ao alterar selects/datas
 * e ao pressionar Enter em campos de texto — os filtros ficam compartilháveis no link.
 */
export function FilterForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => {
    const fd = new FormData(ref.current!);
    const params = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v !== "") params.set(k, v);
    router.push(`${pathname}?${params.toString()}`);
  };
  return (
    <form
      ref={ref}
      className={cn("flex flex-wrap items-end gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onChange={(e) => {
        const t = e.target as HTMLInputElement;
        if (t.tagName === "SELECT" || t.type === "date" || t.type === "checkbox") submit();
      }}
    >
      {children}
    </form>
  );
}

/** Mostra campos de data quando o período é "personalizado". */
export function PeriodSelect({ preset, from, to }: { preset: string; from: string; to: string }) {
  const sp = useSearchParams();
  const current = sp.get("periodo") ?? preset;
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted">Período</span>
        <select name="periodo" defaultValue={current} className="h-9 rounded-lg border border-line bg-white px-3 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] transition-colors hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100">
          <option value="mes">Este mês</option>
          <option value="ultimo-mes">Mês passado</option>
          <option value="trimestre">Últimos 3 meses</option>
          <option value="ano">Este ano</option>
          <option value="12-meses">Últimos 12 meses</option>
          <option value="personalizado">Personalizado</option>
        </select>
      </label>
      {current === "personalizado" && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted">De</span>
            <input type="date" name="de" defaultValue={from} className="h-9 rounded-lg border border-line bg-white px-2 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] transition-colors hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted">Até</span>
            <input type="date" name="ate" defaultValue={to} className="h-9 rounded-lg border border-line bg-white px-2 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] transition-colors hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100" />
          </label>
        </>
      )}
    </>
  );
}

export function FilterSelect({ name, label, value, options, all = "Todos" }: { name: string; label: string; value?: string; options: { value: string; label: string }[]; all?: string | null }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="max-w-52 h-9 rounded-lg border border-line bg-white px-3 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] transition-colors hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100">
        {all !== null && <option value="">{all}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterSearch({ name = "q", value, placeholder }: { name?: string; value?: string; placeholder: string }) {
  return (
    <label className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-xs">
      <span className="text-[11px] font-medium text-muted">Busca</span>
      <input name={name} defaultValue={value} placeholder={placeholder} className="h-9 rounded-lg border border-line bg-white px-3 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] transition-colors hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 placeholder:text-subtle" />
    </label>
  );
}

/** Painel de filtros secundários (recolhível); abre automaticamente quando algum está ativo. */
export function MoreFilters({ active, children }: { active: number; children: React.ReactNode }) {
  return (
    <details className="group w-full" open={active > 0}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Mais filtros</span>
        <span className="hidden group-open:inline">Menos filtros</span>
        {active > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{active}</span>}
      </summary>
      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-3">{children}</div>
    </details>
  );
}
