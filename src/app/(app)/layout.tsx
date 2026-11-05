import { cookies } from "next/headers";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { AppShell, MobileNav, type NavGroup } from "@/components/shell/nav";
import { Breadcrumbs, DemoPill, GlobalSearch, NewSaleButton, Notifications, UserMenu } from "@/components/shell/topbar";
import { getAlerts } from "@/server/services/dashboard";
import { ROLES } from "@/lib/constants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const [jar, alerts] = await Promise.all([cookies(), getAlerts(ctx, today(ctx), can(ctx, "dashboard.financeiro"))]);
  const fin = can(ctx, "finance.view");
  const groups: NavGroup[] = [
    { label: "Dashboard", icon: "LayoutDashboard", items: [{ href: "/", label: "Dashboard", icon: "LayoutDashboard" }] },
    {
      label: "Vendas",
      icon: "ShoppingBag",
      items: [
        { href: "/vendas", label: "Vendas", icon: "ShoppingBag" },
        { href: "/viagens", label: "Viagens", icon: "Map" },
        { href: "/excursoes", label: "Excursões e grupos", icon: "Bus" },
        { href: "/clientes", label: "Clientes", icon: "Users" },
        ...(can(ctx, "contracts.manage") ? [{ href: "/contratos", label: "Contratos", icon: "FileSignature" } as const] : []),
      ],
    },
    {
      label: "Financeiro",
      icon: "Wallet",
      items: fin
        ? [
            { href: "/financeiro/receber", label: "Contas a receber", icon: "ArrowDownToLine" },
            { href: "/financeiro/pagar", label: "Contas a pagar", icon: "ArrowUpFromLine" },
            { href: "/financeiro/faturas", label: "Faturas do fornecedor", icon: "FileStack" },
            { href: "/financeiro/fluxo", label: "Fluxo de caixa", icon: "Activity" },
            { href: "/financeiro/contas", label: "Contas e saldos", icon: "Landmark" },
            { href: "/financeiro/conciliacao", label: "Conciliação", icon: "GitCompareArrows" },
          ]
        : [],
    },
    {
      label: "Gestão",
      icon: "BarChart3",
      items: [
        ...(can(ctx, "reports.commercial") || can(ctx, "reports.financial") ? [{ href: "/relatorios", label: "Relatórios e DRE", icon: "BarChart3" } as const] : []),
        ...(can(ctx, "suppliers.view") ? [{ href: "/fornecedores", label: "Fornecedores", icon: "Building2" } as const] : []),
        ...(can(ctx, "automations.manage") ? [{ href: "/automacoes", label: "Automações", icon: "Zap" } as const] : []),
      ],
    },
    ...(can(ctx, "settings.manage")
      ? [{ label: "Configurações", icon: "Settings", items: [{ href: "/configuracoes", label: "Configurações", icon: "Settings" }] } as NavGroup]
      : []),
  ].filter((g) => g.items.length > 0) as NavGroup[];
  const user = { name: ctx.userName, role: ROLES.label(ctx.role) };

  const header = (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <MobileNav groups={groups} company={ctx.companyName} user={user} />
        <div className="flex min-w-0 flex-1 items-center gap-6">
          <GlobalSearch />
          <Breadcrumbs />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ctx.isDemo && <DemoPill />}
          {can(ctx, "sales.create") && <NewSaleButton />}
          <Notifications alerts={alerts} />
          <span className="hidden h-6 w-px bg-line sm:block" />
          <UserMenu name={ctx.userName} role={user.role} canSettings={can(ctx, "settings.manage")} />
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
