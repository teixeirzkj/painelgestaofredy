import Link from "next/link";
import { Building2, CircleCheck, CirclePause, Users } from "lucide-react";
import { listCompanies, platformOverview } from "@/server/platform";
import { Badge, Card, EmptyState, KpiCard, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSearch } from "@/components/filter-form";
import { formatDateTime } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { NewCompanyButton } from "./platform-client";

export const metadata = { title: "Plataforma · Agências" };

export default async function PlatformHome({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [o, companies] = await Promise.all([platformOverview(), listCompanies(str(sp, "q"))]);
  return (
    <>
      <PageHeader title="Agências clientes" description="Crie a conta de cada agência, entregue o login do administrador e acompanhe o uso." actions={<NewCompanyButton />} />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Agências" value={String(o.companies)} icon={Building2} />
        <KpiCard label="Ativas" value={String(o.active)} icon={CircleCheck} tone="green" />
        <KpiCard label="Suspensas" value={String(o.suspended)} icon={CirclePause} tone={o.suspended ? "amber" : "slate"} />
        <KpiCard label="Usuários ativos" value={String(o.users)} icon={Users} tone="violet" hint={`${o.sales} vendas registradas`} />
      </section>
      <Card>
        <div className="border-b border-line px-5 py-3">
          <FilterForm>
            <FilterSearch value={str(sp, "q")} placeholder="Nome ou CNPJ da agência" />
          </FilterForm>
        </div>
        {companies.length === 0 ? (
          <EmptyState icon={Building2} title="Nenhuma agência encontrada" description="Use “Nova agência” para criar a primeira conta." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Agência</Th>
                <Th>Administrador</Th>
                <Th align="center">Usuários</Th>
                <Th align="center">Vendas</Th>
                <Th>Último acesso</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <Td className="py-3.5">
                    <Link href={`/plataforma/agencias/${c.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted">
                      Plano {c.plan.toLowerCase()} · até {c.maxUsers} usuários{c.isDemo ? " · demonstração" : ""}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm">{c.users[0]?.name ?? "—"}</p>
                    <p className="text-xs text-muted">{c.users[0]?.email}</p>
                  </Td>
                  <Td align="center">{c._count.users}</Td>
                  <Td align="center">{c._count.sales}</Td>
                  <Td className="text-sm text-slate-600">{c.lastLoginAt ? formatDateTime(c.lastLoginAt, c.timezone) : "nunca"}</Td>
                  <Td>{c.active ? <Badge tone="green" dot>Ativa</Badge> : <Badge tone="amber" dot>Suspensa</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
