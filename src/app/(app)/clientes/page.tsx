import Link from "next/link";
import { Users } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listClients } from "@/server/services/registry";
import { Card, EmptyState, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
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
        description={can(ctx, "clients.view_all") ? "Cadastro de clientes da agência." : "Clientes atendidos por você."}
        actions={can(ctx, "clients.manage") && <NewClientButton />}
      />
      <Card>
        <div className="border-b border-line p-3">
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
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <Td>
                    <Link href={`/clientes/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                    {c.city && <p className="text-xs text-muted">{c.city}{c.state && `/${c.state}`}</p>}
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
