"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Wallet,
  Building2,
  FileSignature,
  BarChart3,
  Zap,
  Settings,
  Menu,
  X,
  Plane,
  Map,
  Bus,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/actions";

const ICONS = { LayoutDashboard, ShoppingBag, Users, Wallet, Building2, FileSignature, BarChart3, Zap, Settings, Map, Bus };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS };
export type NavGroup = { label: string; items: NavItem[] };
type User = { name: string; role: string };

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Links({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-2" aria-label="Menu principal">
      {groups.map((g) => (
        <div key={g.label}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
          ) : (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-200/40">{g.label}</p>
          )}
          <div className="flex flex-col gap-0.5">
            {g.items.map((i) => {
              const Icon = ICONS[i.icon];
              const active = isActive(path, i.href);
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  onClick={onNavigate}
                  data-tip={collapsed ? i.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg py-2 text-[13.5px] font-medium transition-colors",
                    collapsed ? "justify-center px-0" : "px-3",
                    active ? "bg-white/[0.09] text-white" : "text-blue-100/70 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400" />}
                  <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-brand-300" : "text-blue-200/50 group-hover:text-blue-100")} />
                  {!collapsed && <span className="truncate">{i.label}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({ company, collapsed }: { company: string; collapsed?: boolean }) {
  return (
    <Link href="/" className={cn("flex items-center gap-3 py-5", collapsed ? "justify-center px-0" : "px-5")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-900/40">
        <Plane className="h-[18px] w-[18px] -rotate-12" />
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block font-display text-[15px] font-semibold leading-tight text-white">Frédy Gestão</span>
          <span className="block truncate text-[11px] text-blue-200/60">{company}</span>
        </span>
      )}
    </Link>
  );
}

function UserBlock({ user, collapsed }: { user: User; collapsed?: boolean }) {
  return (
    <div className={cn("border-t border-white/[0.06] p-3", collapsed && "px-2")}>
      <div className={cn("flex items-center gap-3 rounded-lg p-2", collapsed && "justify-center p-1")}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-xs font-semibold text-brand-200 ring-1 ring-brand-400/30" data-tip={collapsed ? `${user.name} · ${user.role}` : undefined}>
          {initials(user.name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{user.name}</span>
              <span className="block text-[11px] text-blue-200/50">{user.role}</span>
            </span>
            <form action={logoutAction}>
              <button className="rounded-md p-1.5 text-blue-200/50 transition-colors hover:bg-white/10 hover:text-white" aria-label="Sair" title="Sair">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/** Estrutura principal: sidebar (recolhível, preferência salva em cookie) + área de conteúdo. */
export function AppShell({
  groups,
  company,
  user,
  initialCollapsed,
  header,
  children,
}: {
  groups: NavGroup[];
  company: string;
  user: User;
  initialCollapsed: boolean;
  header: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `fg_sidebar=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };
  return (
    <div className="min-h-screen" style={{ ["--sidebar-w" as string]: collapsed ? "72px" : "16rem" }}>
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-[72px]" : "w-64",
        )}
      >
        <Brand company={company} collapsed={collapsed} />
        <Links groups={groups} collapsed={collapsed} />
        <div className={cn("px-3 pb-1", collapsed && "px-2")}>
          <button
            onClick={toggle}
            data-tip={collapsed ? "Expandir menu" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg py-2 text-[13px] text-blue-200/50 transition-colors hover:bg-white/[0.05] hover:text-white",
              collapsed ? "justify-center" : "px-3",
            )}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            {!collapsed && "Recolher menu"}
          </button>
        </div>
        <UserBlock user={user} collapsed={collapsed} />
      </aside>
      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-64")}>
        {header}
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function MobileNav({ groups, company, user }: { groups: NavGroup[]; company: string; user: User }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 animate-fade-in bg-slate-900/50 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="flex h-full w-72 flex-col bg-sidebar shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">
              <Brand company={company} />
              <button onClick={() => setOpen(false)} className="rounded-md p-2 text-blue-100 hover:bg-white/10" aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Links groups={groups} onNavigate={() => setOpen(false)} />
            <UserBlock user={user} />
          </aside>
        </div>
      )}
    </>
  );
}
