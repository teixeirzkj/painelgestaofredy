"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, ShoppingBag, Users, Wallet, Building2, FileSignature, BarChart3, Zap, Settings, Menu, X, Plane } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { LayoutDashboard, ShoppingBag, Users, Wallet, Building2, FileSignature, BarChart3, Zap, Settings };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };

function Links({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/15 text-white" : "text-blue-100/80 hover:bg-white/10 hover:text-white",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", active ? "text-white" : "text-blue-200/70")} />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ company }: { company: string }) {
  return (
    <div className="flex items-center gap-2.5 px-6 py-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-600 shadow">
        <Plane className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight text-white">Frédy Gestão</p>
        <p className="truncate text-[11px] text-blue-200/80">{company}</p>
      </div>
    </div>
  );
}

export function Sidebar({ items, company }: { items: NavItem[]; company: string }) {
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-900 lg:flex">
      <Brand company={company} />
      <Links items={items} />
      <div className="mt-auto px-6 py-4 text-[11px] text-blue-200/60">Módulo de gestão · v0.1 (MVP)</div>
    </aside>
  );
}

export function MobileNav({ items, company }: { items: NavItem[]; company: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-72 flex-col bg-brand-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">
              <Brand company={company} />
              <button onClick={() => setOpen(false)} className="p-2 text-blue-100" aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Links items={items} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
