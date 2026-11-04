import Link from "next/link";
import { Users } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listClients } from "@/server/services/registry";
import { Badge, Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect } from "@/components/filter-form";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { maskDocument } from "@/lib/utils";
import { int, str, withParams, type SearchParams } from "@/lib/params";
import { NewClientButton } from "./client-buttons";

export const metadata = { title: "Clientes" };

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const q = str(sp, "q");
  const archived = str(sp, "arquivados") === "1";
  const data = await listClients(ctx, { q, page: int(sp, "pagina"), archived });
  return (
    <>
      <PageHeader
        title="Clientes"
        description={can(ctx, "clients.view_all") ? "Clientes pessoa física e jurídica, com histórico de compras, viagens e pendências." : "Clientes atendidos por você."}
        actions={can(ctx, "clients.manage") && <NewClientButton />}
      />
      <Card>
        <div className="border-b border-line px-4 py-3">
          <FilterForm>
            <FilterSearch value={q} placeholder="Nome, CPF, telefone ou e-mail" />
            <FilterSelect name="arquivados" label="Situação" value={archived ? "1" : ""} options={[{ value: "1", label: "Arquivados" }]} all="Ativos" />
          </FilterForm>
        </div>
        {data.items.length === 0 ? (
          <EmptyState icon={Users} title={q ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"} description="Clientes também podem ser cadastrados direto na tela de nova venda." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Documento</Th>
                <Th>Contato</Th>
                <Th align="right">Vendas</Th>
                <Th align="right">Total comprado</Th>
                <Th>Última compra</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id}>
                  <Td className="py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                        {c.name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <Link href={`/clientes/${c.id}`} className="font-semibold text-ink hover:text-brand-700">
                          {c.name}
                        </Link>
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                          {c.personType === "PJ" && <Badge tone="violet" className="py-0 text-[10px]">PJ</Badge>}
                          {c.city ? `${c.city}${c.state ? `/${c.state}` : ""}` : ""}
                        </span>
                      </span>
                    </div>
                  </Td>
                  <Td className="text-slate-600">{maskDocument(c.document)}</Td>
                  <Td className="text-slate-600">
                    {c.whatsapp ?? c.phone ?? "—"}
                    {c.email && <p className="text-xs text-muted">{c.email}</p>}
                  </Td>
                  <Td align="right">{c._count.sales}</Td>
                  <Td align="right">{formatBRL(c.totalCents)}</Td>
                  <Td className="text-slate-600">{formatDate(c.lastSale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} pages={data.pages} total={data.total} hrefFor={(p) => withParams("/clientes", sp, { pagina: p })} />
      </Card>
    </>
  );
}
