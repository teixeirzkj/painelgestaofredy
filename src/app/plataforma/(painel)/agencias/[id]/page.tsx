import { notFound } from "next/navigation";
import { getCompanyDetail } from "@/server/platform";
import { Badge, Card, CardHeader, DataList, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { ROLES } from "@/lib/constants";
import type { Params } from "@/lib/params";
import { AddAdminButton, CompanyActions, ResetPasswordButton } from "../../platform-client";

export const metadata = { title: "Plataforma · Agência" };

const ACTION: Record<string, string> = {
  "agencia.criada": "Conta criada",
  "agencia.suspensa": "Conta suspensa",
  "agencia.reativada": "Conta reativada",
  "agencia.plano_alterado": "Plano alterado",
  "usuario.senha_redefinida": "Senha redefinida",
  "usuario.admin_criado": "Administrador adicionado",
};

export default async function CompanyPage({ params }: { params: Params }) {
  const { id } = await params;
  const c = await getCompanyDetail(id).catch(() => null);
  if (!c) notFound();
  const activeUsers = c.users.filter((u) => u.active).length;
  return (
    <>
      <PageHeader
        back={{ href: "/plataforma", label: "Agências" }}
        title={c.name}
        meta={
          <>
            {c.active ? <Badge tone="green" dot>Ativa</Badge> : <Badge tone="amber" dot>Suspensa</Badge>}
            {c.isDemo && <Badge>Demonstração</Badge>}
          </>
        }
        actions={<CompanyActions id={c.id} active={c.active} plan={c.plan} maxUsers={c.maxUsers} />}
      />
      {!c.active && (
        <Notice tone="amber" title="Conta suspensa" className="mb-6">
          {c.suspendedReason}
        </Notice>
      )}
      <Card className="mb-6 p-5">
        <DataList
          columns={3}
          items={[
            { label: "CNPJ", value: c.document ?? "—" },
            { label: "Plano", value: `${c.plan.toLowerCase()} · ${activeUsers}/${c.maxUsers} usuários` },
            { label: "Criada em", value: formatDateTime(c.createdAt, c.timezone) },
            { label: "Vendas registradas", value: String(c._count.sales) },
            { label: "Clientes", value: String(c._count.clients) },
            { label: "Volume vendido (confirmado)", value: formatBRL(c.grossCents) },
          ]}
        />
      </Card>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Usuários da agência" description="A própria agência cadastra a equipe em Equipe; aqui você recupera acessos." action={<AddAdminButton companyId={c.id} />} />
          <Table>
            <thead>
              <tr>
                <Th>Usuário</Th>
                <Th>Perfil</Th>
                <Th>Último acesso</Th>
                <Th>Situação</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {c.users.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </Td>
                  <Td>{ROLES.label(u.role)}</Td>
                  <Td className="text-sm text-slate-600">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, c.timezone) : "nunca"}</Td>
                  <Td>{u.active ? <Badge tone="green">Ativo</Badge> : <Badge>Inativo</Badge>}</Td>
                  <Td align="right">
                    <ResetPasswordButton companyId={c.id} userId={u.id} email={u.email} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Histórico na plataforma" />
          <ol className="space-y-3 p-5 text-sm">
            {c.audit.length === 0 && <li className="text-muted">Sem registros.</li>}
            {c.audit.map((a) => (
              <li key={a.id} className="border-l-2 border-brand-100 pl-3">
                <p className="font-medium">{ACTION[a.action] ?? a.action}</p>
                <p className="text-xs text-muted">{formatDateTime(a.createdAt, c.timezone)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
