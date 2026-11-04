import { requirePageContext } from "@/server/auth";
import { getCompanySettings, listAudit } from "@/server/services/settings";
import { listCommissionRules, listCostCenters } from "@/server/services/catalog";
import { supplierOptions } from "@/server/services/registry";
import { can } from "@/server/context";
import { CommissionRulesEditor, CostCentersEditor } from "@/components/catalog-editors";
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
  const [rules, centers, suppliers] = tab === "cadastros" ? await Promise.all([listCommissionRules(ctx), listCostCenters(ctx), supplierOptions(ctx)]) : [[], [], []];

  return (
    <>
      <PageHeader title="Configurações" description={s.company.name} />
      <Tabs
        active={tab}
        items={[
          { key: "agencia", href: "/configuracoes?aba=agencia", label: "Agência" },
          { key: "usuarios", href: "/configuracoes?aba=usuarios", label: "Usuários e permissões" },
          { key: "cadastros", href: "/configuracoes?aba=cadastros", label: "Comissões e centros de custo" },
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

      {tab === "cadastros" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Regras de comissão e over" description="Por fornecedor e/ou produto. A regra mais específica é sugerida na venda (fornecedor + produto > fornecedor > produto)." />
            <CommissionRulesEditor rules={rules} suppliers={suppliers} canManage={can(ctx, "suppliers.manage")} />
          </Card>
          <Card>
            <CardHeader title="Centros de custo" description="Classificam receitas e despesas avulsas no financeiro e no relatório por centro de custo." />
            <CostCentersEditor items={centers} canManage={can(ctx, "finance.manage")} />
          </Card>
        </div>
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
      {tab === "integracoes" && (
        <Card className="mt-6 max-w-3xl">
          <CardHeader title="Jornada Frédy: atendimento → orçamento → venda" description="API própria do Frédy Gestão para receber orçamentos de qualquer sistema de atendimento (CRM, n8n, site)." />
          <div className="space-y-3 p-5 text-sm text-slate-700">
            <p>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">POST /api/v1/orcamentos</code> com o cabeçalho <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;chave da agência&gt;</code>. O orçamento entra como
              rascunho de venda, vinculado ao cliente pelo <em>fredyContactId</em>, CPF/CNPJ ou e-mail (ou cria o cadastro). A mesma <em>externalRef</em> nunca gera dois orçamentos.
            </p>
            <pre className="overflow-x-auto rounded-xl bg-sidebar p-4 text-xs leading-relaxed text-blue-100">{`{
  "externalRef": "crm-123",
  "client": { "name": "Maria Souza", "whatsapp": "42999990000", "fredyContactId": "abc" },
  "destination": "Gramado - RS", "tripStart": "2026-12-20", "passengerCount": 2,
  "items": [{ "productType": "PACOTE", "priceCents": 520000, "costCents": 430000 }]
}`}</pre>
            <p className="text-xs text-muted">
              Os eventos da venda (confirmação, pagamentos, contrato, pré-viagem e pós-venda) seguem disponíveis em <code>GET /api/v1/eventos</code> ou pelo webhook configurado. A integração nativa com o CRM Frédy
              depende da definição de endpoint e autenticação pela equipe Frédy e não é simulada.
            </p>
          </div>
        </Card>
      )}

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
