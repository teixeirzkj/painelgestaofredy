"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { Search, Plus, Bell, ChevronRight, ShoppingBag, User, Map, Building2, Bus, Receipt, Loader2, CornerDownLeft, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { globalSearchAction } from "@/app/actions";
import type { SearchHit } from "@/server/services/search";
import type { Alert } from "@/server/services/dashboard";

// ------------------------------ Trilha de navegação ------------------------------
const LABELS: Record<string, string> = {
  vendas: "Vendas",
  nova: "Nova",
  editar: "Editar",
  clientes: "Clientes",
  viagens: "Viagens",
  excursoes: "Excursões",
  financeiro: "Financeiro",
  receber: "Contas a receber",
  pagar: "Contas a pagar",
  fluxo: "Fluxo de caixa",
  contas: "Contas financeiras",
  conciliacao: "Conciliação",
  faturas: "Faturas de fornecedores",
  fornecedores: "Fornecedores",
  contratos: "Contratos",
  modelos: "Modelos",
  relatorios: "Relatórios",
  automacoes: "Automações",
  configuracoes: "Configurações",
};

export function Breadcrumbs() {
  const path = usePathname();
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ href: "/", label: "Início" }, ...parts.map((p, i) => ({ href: "/" + parts.slice(0, i + 1).join("/"), label: LABELS[p] ?? "Detalhe" }))];
  return (
    <nav aria-label="Trilha de navegação" className="hidden min-w-0 items-center gap-1 text-[13px] xl:flex">
      {crumbs.map((c, i) => (
        <Fragment key={c.href}>
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
          {i === crumbs.length - 1 ? (
            <span className="truncate font-medium text-ink">{c.label}</span>
          ) : (
            <Link href={c.href} className="truncate text-muted transition-colors hover:text-brand-600">
              {c.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

// ------------------------------ Busca global ------------------------------
const HIT_ICON = { venda: ShoppingBag, cliente: User, viagem: Map, fornecedor: Building2, excursao: Bus, fatura: Receipt };
const HIT_LABEL = { venda: "Venda", cliente: "Cliente", viagem: "Viagem", fornecedor: "Fornecedor", excursao: "Excursão", fatura: "Fatura" };

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      start(async () => {
        const r = await globalSearchAction(term);
        if (r.ok) {
          setHits(r.data);
          setActive(0);
        }
      });
    }, 220);
    return () => clearTimeout(id);
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (hits[active]) go(hits[active].href);
            else if (q.trim()) go(`/vendas?q=${encodeURIComponent(q.trim())}`);
          } else if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
        placeholder="Buscar vendas, clientes, viagens, localizadores…"
        aria-label="Busca global"
        role="combobox"
        aria-expanded={open && q.trim().length >= 2}
        aria-controls="global-search-results"
        className="h-9 w-full rounded-lg border border-line bg-slate-50/80 pl-9 pr-14 text-sm placeholder:text-subtle transition-colors hover:border-line-strong focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100"
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-line bg-white px-1.5 py-0.5 text-[10px] font-medium text-subtle sm:flex">
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Ctrl K"}
      </span>
      {open && q.trim().length >= 2 && (
        <div id="global-search-results" role="listbox" className="absolute left-0 right-0 top-11 z-50 max-h-[70vh] animate-pop-in overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]">
          {hits.length === 0 && !pending && <p className="px-3 py-6 text-center text-sm text-muted">Nada encontrado para “{q.trim()}”.</p>}
          {hits.map((h, i) => {
            const Icon = HIT_ICON[h.type];
            return (
              <button
                key={`${h.type}-${h.id}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h.href)}
                className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left", i === active ? "bg-brand-50" : "hover:bg-slate-50")}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", i === active ? "bg-white text-brand-600" : "bg-slate-100 text-slate-500")}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{h.title}</span>
                  <span className="block truncate text-xs text-muted">{h.subtitle}</span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-subtle">{HIT_LABEL[h.type]}</span>
              </button>
            );
          })}
          {hits.length > 0 && (
            <p className="flex items-center gap-1 border-t border-line px-3 pb-1 pt-2 text-[11px] text-subtle">
              <CornerDownLeft className="h-3 w-3" /> abrir · ↑↓ navegar · Esc fechar
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------ Notificações (alertas reais do sistema) ------------------------------
export function Notifications({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const urgent = alerts.filter((a) => a.severity !== "info").length;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink"
        aria-label={`Notificações${alerts.length ? ` (${alerts.length})` : ""}`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {alerts.length > 0 && (
          <span className={cn("absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ring-2 ring-white", urgent ? "bg-danger" : "bg-brand-600")}>
            {alerts.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-[340px] max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-line bg-white shadow-[var(--shadow-pop)]">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Pendências</p>
            <p className="text-xs text-muted">Calculadas a partir dos dados atuais da agência.</p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5">
            {alerts.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">Nenhuma pendência no momento.</p>}
            {alerts.map((a) => (
              <Link key={a.key} href={a.href} className="flex gap-3 rounded-lg px-2.5 py-2.5 hover:bg-slate-50">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", a.severity === "danger" ? "bg-danger" : a.severity === "warning" ? "bg-warning" : "bg-brand-500")} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{a.title}</span>
                  <span className="block text-xs text-muted">
                    {a.detail}
                    {a.amountCents ? ` · ${formatBRL(a.amountCents)}` : ""}
                  </span>
                </span>
                <span className="mt-0.5 text-xs font-semibold text-slate-500">{a.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function NewSaleButton() {
  const path = usePathname();
  if (path.startsWith("/vendas/nova") || path.endsWith("/editar")) return null;
  return (
    <Link
      href="/vendas/nova"
      className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white shadow-sm shadow-brand-600/20 transition-colors hover:bg-brand-700"
    >
      <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nova venda</span>
    </Link>
  );
}

export function DemoPill() {
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 md:inline-flex"
      title="Ambiente de demonstração: todos os clientes, vendas e valores são fictícios."
    >
      <FlaskConical className="h-3 w-3" /> Demonstração
    </span>
  );
}
