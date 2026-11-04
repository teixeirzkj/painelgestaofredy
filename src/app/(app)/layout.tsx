import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { Sidebar, MobileNav, type NavItem } from "@/components/shell/nav";
import { GlobalSearch, NewSaleButton, UserMenu } from "@/components/shell/topbar";
import { ROLES } from "@/lib/constants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext();
  const items: NavItem[] = [
    { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
    { href: "/vendas", label: "Vendas", icon: "ShoppingBag" },
    { href: "/clientes", label: "Clientes", icon: "Users" },
    ...(can(ctx, "finance.view") ? [{ href: "/financeiro", label: "Financeiro", icon: "Wallet" } as NavItem] : []),
    ...(can(ctx, "suppliers.view") ? [{ href: "/fornecedores", label: "Fornecedores", icon: "Building2" } as NavItem] : []),
    ...(can(ctx, "contracts.manage") ? [{ href: "/contratos", label: "Contratos", icon: "FileSignature" } as NavItem] : []),
    ...(can(ctx, "reports.commercial") || can(ctx, "reports.financial") ? [{ href: "/relatorios", label: "Relatórios", icon: "BarChart3" } as NavItem] : []),
    ...(can(ctx, "automations.manage") ? [{ href: "/automacoes", label: "Automações", icon: "Zap" } as NavItem] : []),
    ...(can(ctx, "settings.manage") ? [{ href: "/configuracoes", label: "Configurações", icon: "Settings" } as NavItem] : []),
  ];
  return (
    <div className="min-h-screen">
      <Sidebar items={items} company={ctx.companyName} />
      <div className="lg:pl-64">
        {ctx.isDemo && (
          <div className="no-print bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
            Ambiente de demonstração: todos os clientes, vendas e valores são fictícios.
          </div>
        )}
        <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
          <MobileNav items={items} company={ctx.companyName} />
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            {can(ctx, "sales.create") && <NewSaleButton />}
            <UserMenu name={ctx.userName} role={ROLES.label(ctx.role)} />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
