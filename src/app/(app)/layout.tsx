import { cookies } from "next/headers";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { AppShell, MobileNav, type NavGroup } from "@/components/shell/nav";
import { Breadcrumbs, DemoPill, GlobalSearch, NewSaleButton, Notifications, UserMenu } from "@/components/shell/topbar";
import { getAlerts } from "@/server/services/dashboard";
import { ROLES } from "@/lib/constants";
import { workMonth } from "@/server/month";
import { MonthPicker } from "@/components/shell/month-picker";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const [jar, alerts, wm] = await Promise.all([cookies(), getAlerts(ctx, today(ctx), can(ctx, "dashboard.financeiro")), workMonth(ctx.timezone)]);
  const fin = can(ctx, "finance.view");
  const has = (p: Parameters<typeof can>[1]) => can(ctx, p);
  type I = NavGroup["items"][number];
  const when = (cond: boolean, item: I): I[] => (cond ? [item] : []);
  const groups: NavGroup[] = [
    {
      label: "Dashboards",
      icon: "LayoutDashboard",
      items: [
        { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
        ...when(has("sales.create") || has("sales.view_all"), { href: "/vendedor", label: "Painel do vendedor", icon: "Gauge" }),
        ...when(has("reports.commercial") || has("reports.financial"), { href: "/relatorios", label: "Relatórios", icon: "BarChart3" }),
      ],
    },
    {
      label: "Vendas",
      icon: "ShoppingBag",
      items: [
        { href: "/vendas", label: "Vendas", icon: "ShoppingBag" },
        { href: "/viagens", label: "Viagens", icon: "Map" },
        { href: "/excursoes", label: "Excursões e grupos", icon: "Bus" },
        ...when(has("contracts.manage"), { href: "/contratos", label: "Contratos", icon: "FileSignature" }),
        { href: "/clientes", label: "Clientes", icon: "Users" },
        { href: "/embarques", label: "Próximos embarques", icon: "PlaneTakeoff" },
        { href: "/creditos", label: "Créditos", icon: "Gift" },
        { href: "/aniversariantes", label: "Aniversariantes", icon: "Cake" },
        { href: "/solicitacoes", label: "Solic. de edição", icon: "FilePen" },
      ],
    },
    {
      label: "Financeiro",
      icon: "Wallet",
      items: fin
        ? [
            { href: "/financeiro/contas", label: "Contas e saldos", icon: "Landmark" },
            { href: "/financeiro/faturas", label: "Faturas do fornecedor", icon: "FileStack" },
            { href: "/financeiro/pagar", label: "Contas a pagar", icon: "ArrowUpFromLine" },
            { href: "/financeiro/receber", label: "Contas a receber", icon: "ArrowDownToLine" },
            ...when(has("reports.financial") && has("sales.view_margin"), { href: "/financeiro/dre", label: "DRE", icon: "Layers" }),
            { href: "/financeiro/fluxo", label: "Fluxo de caixa", icon: "Activity" },
            { href: "/financeiro/comissoes", label: "Comissões", icon: "Coins" },
            { href: "/financeiro/repasses", label: "Repasses", icon: "ArrowLeftRight" },
            { href: "/financeiro/decendios", label: "Decêndios", icon: "CalendarRange" },
            { href: "/financeiro/conciliacao", label: "Conciliação bancária", icon: "GitCompareArrows" },
            { href: "/financeiro/conferencia", label: "Conf. de vendas", icon: "ClipboardCheck" },
            { href: "/financeiro/calendario", label: "Calendário", icon: "CalendarDays" },
            { href: "/financeiro/pendencias", label: "Pendências", icon: "TriangleAlert" },
          ]
        : [],
    },
    {
      label: "Equipe",
      icon: "UsersRound",
      items: [
        ...when(has("users.manage"), { href: "/equipe", label: "Equipe", icon: "UsersRound" }),
        { href: "/equipe/metas", label: "Metas", icon: "Target" },
        { href: "/equipe/ranking", label: "Ranking", icon: "Trophy" },
        { href: "/equipe/tarefas", label: "Tarefas", icon: "ListTodo" },
        { href: "/equipe/calendario", label: "Meu calendário", icon: "CalendarDays" },
      ],
    },
    { label: "Marketing", icon: "Megaphone", items: [{ href: "/marketing/destinos", label: "Destinos e hotéis", icon: "MapPin" }] },
    {
      label: "Configurações",
      icon: "Settings",
      items: [
        ...when(has("settings.manage"), { href: "/configuracoes", label: "Agência", icon: "Settings" }),
        ...when(has("suppliers.view"), { href: "/fornecedores", label: "Fornecedores", icon: "Building2" }),
        ...when(fin, { href: "/configuracoes/categorias", label: "Categorias", icon: "Tags" }),
        ...when(has("settings.manage"), { href: "/configuracoes/taxas-cartao", label: "Taxas de cartão", icon: "CreditCard" }),
        ...when(has("automations.manage"), { href: "/automacoes", label: "Automações", icon: "Zap" }),
        ...when(has("settings.manage"), { href: "/configuracoes/acessos", label: "Log de acessos", icon: "ScrollText" }),
      ],
    },
  ].filter((g) => g.items.length > 0) as NavGroup[];
  const user = { name: ctx.userName, role: ROLES.label(ctx.role), logo: ctx.logoKey ? `/api/agencia/logo?v=${encodeURIComponent(ctx.logoKey.slice(-12))}` : null };

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
          <MonthPicker month={wm.month} current={wm.today.slice(0, 7)} />
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
