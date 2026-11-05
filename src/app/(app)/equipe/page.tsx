import { Users } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { prisma } from "@/server/db";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { formatDateTime } from "@/lib/dates";
import { formatPercentBps } from "@/lib/money";
import { ROLES } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { UserButton } from "../configuracoes/settings-client";

export const metadata = { title: "Equipe" };

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function TeamPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("users.manage");
  const sp = await searchParams;
  const role = str(sp, "perfil");
  const status = str(sp, "status");
  const [company, users] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { maxUsers: true } }),
    prisma.user.findMany({
      where: { companyId: ctx.companyId },
      select: { id: true, name: true, email: true, role: true, active: true, commissionRateBps: true, lastLoginAt: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const activeCount = users.filter((u) => u.active).length;
  const rows = users.filter((u) => (!role || u.role === role) && (!status || (status === "ativos" ? u.active : !u.active)));

  return (
    <>
      <PageHeader title="Equipe" description={`${users.length} membro(s) · ${activeCount} de ${company.maxUsers} usuários ativos no plano`} actions={<UserButton />} />
      {activeCount >= company.maxUsers && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          A agência atingiu o limite de usuários ativos do plano. Desative um membro ou fale com o suporte Frédy para ampliar.
        </p>
      )}
      <Card>
        <div className="border-b border-line px-5 py-3">
          <FilterForm>
            <FilterSelect name="perfil" label="Perfil" value={role} options={ROLES.values.map((v) => ({ value: v, label: ROLES.label(v) }))} all="Todos os perfis" />
            <FilterSelect
              name="status"
              label="Situação"
              value={status}
              options={[
                { value: "ativos", label: "Ativos" },
                { value: "bloqueados", label: "Bloqueados" },
              ]}
              all="Todos"
            />
          </FilterForm>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum membro encontrado" description="Ajuste os filtros ou cadastre um novo membro." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Membro</Th>
                <Th>Perfil</Th>
                <Th align="right">Comissão padrão</Th>
                <Th>Situação</Th>
                <Th>Último acesso</Th>
                <Th>Entrada</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <Td className="py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{initials(u.name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">
                          {u.name}
                          {u.id === ctx.userId && <span className="ml-1.5 text-xs font-normal text-muted">(você)</span>}
                        </span>
                        <span className="block truncate text-xs text-muted">{u.email}</span>
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone="blue">{ROLES.label(u.role)}</Badge>
                  </Td>
                  <Td align="right">{u.commissionRateBps ? formatPercentBps(u.commissionRateBps) : "—"}</Td>
                  <Td>{u.active ? <Badge tone="green" dot>Ativo</Badge> : <Badge dot>Bloqueado</Badge>}</Td>
                  <Td className="text-sm text-slate-600">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, ctx.timezone) : "nunca"}</Td>
                  <Td className="text-sm text-slate-600">{formatDateTime(u.createdAt, ctx.timezone).slice(0, 10)}</Td>
                  <Td align="right">
                    <UserButton user={{ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, commissionRateBps: u.commissionRateBps }} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
