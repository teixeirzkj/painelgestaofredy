import { requirePageContext } from "@/server/auth";
import { getCompanySettings, listAudit } from "@/server/services/settings";
import { Card, CardHeader, PageHeader, Pagination, Table, Td, Th, Badge, Tabs } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { formatPercentBps } from "@/lib/money";
import { ROLES } from "@/lib/constants";
import { int, str, withParams, type SearchParams } from "@/lib/params";
import { CompanyForm, IntegrationsForm, PermissionToggle, UserButton } from "./settings-client";

export const metadata = { title: "Configurações" };

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("settings.manage");
  const sp = await searchParams;
  const tab = str(sp, "aba") ?? "agencia";
  const s = await getCompanySettings(ctx);
  const audit = tab === "auditoria" ? await listAudit(ctx, int(sp, "pagina")) : null;

  return (
    <>
      <PageHeader title="Configurações" description={s.company.name} />
      <Tabs
        active={tab}
        items={[
          { key: "agencia", href: "/configuracoes?aba=agencia", label: "Agência" },
          { key: "usuarios", href: "/configuracoes?aba=usuarios", label: "Usuários e permissões" },
          { key: "integracoes", href: "/configuracoes?aba=integracoes", label: "Integrações" },
          { key: "auditoria", href: "/configuracoes?aba=auditoria", label: "Auditoria" },
        ]}
      />

      {tab === "agencia" && (
        <Card className="max-w-3xl">
          <CardHeader title="Dados da agência" description="Usados nos contratos, nos prazos de alertas e no cálculo de datas." />
          <div className="p-5">
            <CompanyForm
              initial={{
                name: s.company.name,
                document: s.company.document ?? "",
                timezone: s.company.timezone,
                commissionPayDay: s.company.commissionPayDay,
                upcomingDueDays: s.company.upcomingDueDays,
                upcomingTripDays: s.company.upcomingTripDays,
                webhookUrl: s.company.webhookUrl ?? "",
                webhookSecret: s.company.webhookSecret ?? "",
              }}
            />
          </div>
        </Card>
      )}

      {tab === "usuarios" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Usuários" action={<UserButton />} />
            <Table>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Perfil</Th>
                  <Th align="right">Comissão padrão</Th>
                  <Th>Situação</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {s.users.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-muted">{u.email}</p>
                    </Td>
                    <Td>
                      <Badge tone="blue">{ROLES.label(u.role)}</Badge>
                    </Td>
                    <Td align="right">{u.commissionRateBps ? `${formatPercentBps(u.commissionRateBps)} da margem` : "—"}</Td>
                    <Td>{u.active ? <Badge tone="green">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                    <Td align="right">
                      <UserButton user={{ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, commissionRateBps: u.commissionRateBps }} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Permissões configuráveis" description="Ajustes por perfil. Administrador sempre tem acesso completo." />
            <ul className="divide-y divide-line">
              {s.permissions.map((p) => (
                <li key={`${p.role}-${p.permission}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>{p.label}</span>
                  <PermissionToggle role={p.role} permission={p.permission} allowed={p.allowed} />
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-5 py-3 text-xs text-muted">
              Padrões: Gestor vê vendas da equipe, relatórios e consulta o financeiro; Vendedor vê apenas as próprias vendas e clientes, sem margens; Financeiro gerencia contas,
              caixa e relatórios financeiros.
            </div>
          </Card>
        </div>
      )}

      {tab === "integracoes" && <IntegrationsForm hasApiKey={s.company.hasApiKey} webhookUrl={s.company.webhookUrl ?? ""} hasSecret={!!s.company.webhookSecret} base={{
        name: s.company.name,
        document: s.company.document ?? "",
        timezone: s.company.timezone,
        commissionPayDay: s.company.commissionPayDay,
        upcomingDueDays: s.company.upcomingDueDays,
        upcomingTripDays: s.company.upcomingTripDays,
      }} />}

      {tab === "auditoria" && audit && (
        <Card>
          <CardHeader title="Registro de auditoria" description="Quem fez o quê e quando (rastreabilidade — LGPD)." />
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Usuário</Th>
                <Th>Ação</Th>
                <Th>Registro</Th>
              </tr>
            </thead>
            <tbody>
              {audit.items.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-slate-600">{formatDateTime(a.createdAt, ctx.timezone)}</Td>
                  <Td>{a.user?.name ?? "Sistema"}</Td>
                  <Td>
                    <code className="text-xs">{a.action}</code>
                  </Td>
                  <Td className="text-xs text-muted">
                    {a.entityType}
                    {a.entityId && ` · ${a.entityId.slice(-8)}`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={audit.page} pages={audit.pages} total={audit.total} hrefFor={(p) => withParams("/configuracoes", sp, { pagina: p })} />
        </Card>
      )}
    </>
  );
}
