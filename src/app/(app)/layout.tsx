import { cookies } from "next/headers";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { AppShell, MobileNav, type NavGroup } from "@/components/shell/nav";
import { Breadcrumbs, DemoPill, GlobalSearch, NewSaleButton, Notifications } from "@/components/shell/topbar";
import { getAlerts } from "@/server/services/dashboard";
import { ROLES } from "@/lib/constants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const [jar, alerts] = await Promise.all([cookies(), getAlerts(ctx, today(ctx), can(ctx, "dashboard.financeiro"))]);
  const groups: NavGroup[] = [
    { label: "Visão geral", items: [{ href: "/", label: "Dashboard", icon: "LayoutDashboard" }] },
    {
      label: "Comercial",
      items: [
        { href: "/vendas", label: "Vendas", icon: "ShoppingBag" },
        { href: "/viagens", label: "Viagens", icon: "Map" },
        { href: "/excursoes", label: "Excursões e grupos", icon: "Bus" },
        { href: "/clientes", label: "Clientes", icon: "Users" },
      ],
    },
    {
      label: "Operação e financeiro",
      items: [
        ...(can(ctx, "finance.view") ? [{ href: "/financeiro", label: "Financeiro", icon: "Wallet" } as const] : []),
        ...(can(ctx, "suppliers.view") ? [{ href: "/fornecedores", label: "Fornecedores", icon: "Building2" } as const] : []),
        ...(can(ctx, "contracts.manage") ? [{ href: "/contratos", label: "Contratos", icon: "FileSignature" } as const] : []),
      ],
    },
    {
      label: "Gestão",
      items: [
        ...(can(ctx, "reports.commercial") || can(ctx, "reports.financial") ? [{ href: "/relatorios", label: "Relatórios", icon: "BarChart3" } as const] : []),
        ...(can(ctx, "automations.manage") ? [{ href: "/automacoes", label: "Automações", icon: "Zap" } as const] : []),
        ...(can(ctx, "settings.manage") ? [{ href: "/configuracoes", label: "Configurações", icon: "Settings" } as const] : []),
      ],
    },
  ].filter((g) => g.items.length > 0) as NavGroup[];
  const user = { name: ctx.userName, role: ROLES.label(ctx.role) };

  const header = (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNav groups={groups} company={ctx.companyName} user={user} />
        <div className="flex min-w-0 flex-1 items-center gap-6">
          <Breadcrumbs />
          <GlobalSearch />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {ctx.isDemo && <DemoPill />}
          <Notifications alerts={alerts} />
          {can(ctx, "sales.create") && <NewSaleButton />}
        </div>
      </div>
    </header>
  );

  return (
    <AppShell groups={groups} company={ctx.companyName} user={user} initialCollapsed={jar.get("fg_sidebar")?.value === "1"} header={header}>
      {children}
    </AppShell>
  );
}
