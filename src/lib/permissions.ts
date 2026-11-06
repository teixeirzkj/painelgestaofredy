import type { Role } from "./constants";

/**
 * Matriz de permissões padrão. Algumas permissões são configuráveis por empresa
 * (tabela RolePermission) — ex.: acesso financeiro do Gestor.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "dashboard.financeiro", // indicadores financeiros globais (receita, margem, a pagar)
  "sales.view_all", // ver vendas de toda a equipe
  "sales.create",
  "sales.edit_all",
  "sales.cancel",
  "sales.view_margin", // ver custo, lucro e margem
  "clients.view_all",
  "clients.manage",
  "suppliers.view",
  "suppliers.manage",
  "finance.view",
  "finance.manage",
  "contracts.manage",
  "reports.commercial",
  "reports.financial",
  "automations.manage",
  "settings.manage",
  "users.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

export const DEFAULT_PERMISSIONS: Record<Role, Set<Permission>> = {
  ADMIN: ALL,
  GESTOR: new Set<Permission>([
    "dashboard.view",
    "dashboard.financeiro",
    "sales.view_all",
    "sales.create",
    "sales.edit_all",
    "sales.cancel",
    "sales.view_margin",
    "clients.view_all",
    "clients.manage",
    "suppliers.view",
    "suppliers.manage",
    "finance.view",
    "contracts.manage",
    "reports.commercial",
    "reports.financial",
    "automations.manage",
  ]),
  VENDEDOR: new Set<Permission>([
    "dashboard.view",
    "sales.create",
    "clients.manage",
    "suppliers.view",
    "contracts.manage",
  ]),
  // só a venda rápida (popup): cadastra cliente, lança a venda e emite o contrato; não entra na gestão
  ATENDENTE: new Set<Permission>(["sales.create", "clients.manage", "contracts.manage"]),
  FINANCEIRO: new Set<Permission>([
    "dashboard.view",
    "dashboard.financeiro",
    "sales.view_all",
    "sales.view_margin",
    "clients.view_all",
    "suppliers.view",
    "suppliers.manage",
    "finance.view",
    "finance.manage",
    "reports.financial",
    "reports.commercial",
  ]),
};

/** Permissões que o administrador pode ajustar por perfil na tela de Configurações. */
export const CONFIGURABLE: { role: Role; permission: Permission; label: string }[] = [
  { role: "GESTOR", permission: "finance.view", label: "Gestor pode consultar o financeiro" },
  { role: "GESTOR", permission: "finance.manage", label: "Gestor pode lançar e baixar no financeiro" },
  { role: "GESTOR", permission: "reports.financial", label: "Gestor pode ver relatórios financeiros" },
  { role: "VENDEDOR", permission: "clients.view_all", label: "Vendedor vê todos os clientes da agência" },
  { role: "VENDEDOR", permission: "sales.view_margin", label: "Vendedor vê custo e margem das próprias vendas" },
];

export function resolvePermissions(
  role: Role,
  overrides: { permission: string; allowed: boolean }[] = [],
): Set<Permission> {
  const set = new Set(DEFAULT_PERMISSIONS[role] ?? []);
  if (role === "ADMIN") return set; // administrador sempre tem acesso completo
  for (const o of overrides) {
    if (!CONFIGURABLE.some((c) => c.role === role && c.permission === o.permission)) continue;
    if (o.allowed) set.add(o.permission as Permission);
    else set.delete(o.permission as Permission);
  }
  return set;
}
