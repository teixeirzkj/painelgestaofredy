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
  ChevronRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileStack,
  Activity,
  Landmark,
  GitCompareArrows,
  FileText,
  SlidersHorizontal,
  Gauge,
  PlaneTakeoff,
  Gift,
  Cake,
  FilePen,
  ClipboardCheck,
  CalendarDays,
  TriangleAlert,
  Target,
  Trophy,
  ListTodo,
  CalendarRange,
  MapPin,
  Tags,
  CreditCard,
  ScrollText,
  UserCircle,
  Coins,
  ArrowLeftRight,
  Megaphone,
  UsersRound,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/actions";

const ICONS = {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Wallet,
  Building2,
  FileSignature,
  BarChart3,
  Zap,
  Settings,
  Map,
  Bus,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileStack,
  Activity,
  Landmark,
  GitCompareArrows,
  FileText,
  SlidersHorizontal,
  Gauge,
  PlaneTakeoff,
  Gift,
  Cake,
  FilePen,
  ClipboardCheck,
  CalendarDays,
  TriangleAlert,
  Target,
  Trophy,
  ListTodo,
  CalendarRange,
  MapPin,
  Tags,
  CreditCard,
  ScrollText,
  UserCircle,
  Coins,
  ArrowLeftRight,
  Megaphone,
  UsersRound,
  Layers,
};
export type NavIcon = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon };
export type NavGroup = { label: string; icon: NavIcon; items: NavItem[] };
type User = { name: string; role: string; logo?: string | null };

function isActive(path: string, href: string) {
  const base = href.split("?")[0];
  return base === "/" ? path === "/" : path === base || path.startsWith(base + "/");
}

function Links({ groups, collapsed, onNavigate }: { groups: NavGroup[]; collapsed?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const activeGroup = groups.find((g) => g.items.some((i) => isActive(path, i.href)))?.label;
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g) => [g.label, g.label === activeGroup || g.items.length === 1])));
  useEffect(() => {
    if (activeGroup) setOpen((o) => ({ ...o, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3" aria-label="Menu principal">
      {groups.map((g) => {
        const GroupIcon = ICONS[g.icon];
        const single = g.items.length === 1;
        const isOpen = collapsed || open[g.label];
        if (single) {
          const i = g.items[0];
          const active = isActive(path, i.href);
          return (
            <Link
              key={g.label}
              href={i.href}
              onClick={onNavigate}
              data-tip={collapsed ? g.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg py-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] transition-colors",
                collapsed ? "justify-center px-0" : "px-2.5",
                active ? "bg-white/[0.12] text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              <GroupIcon className="h-4 w-4 shrink-0" />
              {!collapsed && g.label}
            </Link>
          );
        }
        return (
          <div key={g.label}>
            {!collapsed && (
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [g.label]: !o[g.label] }))}
                aria-expanded={!!isOpen}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] transition-colors",
                  g.label === activeGroup ? "text-white" : "text-white/60 hover:text-white",
                )}
              >
                <GroupIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{g.label}</span>
                <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
              </button>
            )}
            {collapsed && <div className="mx-auto my-2 h-px w-6 bg-white/10" />}
            {isOpen && (
              <div className={cn("flex flex-col gap-0.5", !collapsed && "mb-2 mt-0.5")}>
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
                        "flex items-center gap-3 rounded-lg py-[7px] text-[13.5px] transition-colors",
                        collapsed ? "justify-center px-0" : "pl-[30px] pr-2.5",
                        active ? "bg-white/[0.13] font-medium text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" : "text-white/75 hover:bg-white/[0.06] hover:text-white",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-white/55")} />
                      {!collapsed && <span className="truncate">{i.label}</span>}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ company, role, collapsed, logo }: { company: string; role: string; collapsed?: boolean; logo?: string | null }) {
  const name = company.replace(/\s*\(DEMONSTRAÇÃO\)\s*/i, "");
  return (
    <Link href="/" className={cn("flex items-center gap-3 border-b border-white/[0.08] py-5", collapsed ? "justify-center px-0" : "px-5")}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" className="h-10 w-10 shrink-0 rounded-full bg-white object-contain p-1 ring-2 ring-white/15" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-black/30 ring-2 ring-white/15">
          <Plane className="h-[18px] w-[18px] -rotate-12" />
        </span>
      )}
      {!collapsed && (
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold leading-tight text-white">{name}</span>
          <span className="mt-1 inline-block rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/75">{role}</span>
        </span>
      )}
    </Link>
  );
}

function Footer({ collapsed, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const item = cn("flex w-full items-center gap-3 rounded-lg py-2 text-[13.5px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white", collapsed ? "justify-center" : "px-2.5");
  return (
    <div className="border-t border-white/[0.08] p-3">
      {onToggle && (
        <button onClick={onToggle} data-tip={collapsed ? "Expandir menu" : undefined} className={item} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && "Recolher menu"}
        </button>
      )}
      <Link href="/minha-conta" className={item} data-tip={collapsed ? "Minha conta" : undefined}>
        <UserCircle className="h-4 w-4" />
        {!collapsed && "Minha conta"}
      </Link>
      <form action={logoutAction}>
        <button className={item} data-tip={collapsed ? "Sair" : undefined} aria-label="Sair">
          <LogOut className="h-4 w-4" />
          {!collapsed && "Sair"}
        </button>
      </form>
    </div>
  );
}

/** Estrutura principal: sidebar em gradiente (recolhível, preferência em cookie) + área de conteúdo. */
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
    <div className="min-h-screen" style={{ ["--sidebar-w" as string]: collapsed ? "72px" : "15rem" }}>
      <aside className={cn("no-print bg-sidebar-gradient fixed inset-y-0 left-0 z-30 hidden flex-col transition-[width] duration-200 lg:flex", collapsed ? "w-[72px]" : "w-60")}>
        <Brand company={company} role={user.role} collapsed={collapsed} logo={user.logo} />
        <Links groups={groups} collapsed={collapsed} />
        <Footer collapsed={collapsed} onToggle={toggle} />
      </aside>
      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-60")}>
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
        <div className="fixed inset-0 z-50 animate-fade-in bg-black/50 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="bg-sidebar-gradient flex h-full w-72 flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">
              <Brand company={company} role={user.role} logo={user.logo} />
              <button onClick={() => setOpen(false)} className="rounded-md p-2 text-white/80 hover:bg-white/10" aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Links groups={groups} onNavigate={() => setOpen(false)} />
            <Footer />
          </aside>
        </div>
      )}
    </>
  );
}
