import Link from "next/link";
import { Plus, ShoppingBag } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { prisma } from "@/server/db";
import { listSales } from "@/server/services/sales";
import { sellerOptions } from "@/server/services/settings";
import { Card, EmptyState, LinkButton, PageHeader, Pagination, Table, Td, Th, Badge } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect } from "@/components/filter-form";
import { ContractStatusBadge, FinancialStatusBadge, SaleStatusBadge } from "@/components/status";
import { formatBRL, formatPercentBps } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { FINANCIAL_STATUS, PRODUCT_TYPES, SALE_STATUS } from "@/lib/constants";
import { int, str, withParams, type SearchParams } from "@/lib/params";
import { SaleRowActions } from "./sale-actions";

export const metadata = { title: "Vendas" };

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { upcomingTripDays: true } });
  const f = {
    q: str(sp, "q"),
    status: str(sp, "status"),
    sellerId: str(sp, "vendedor"),
    productType: str(sp, "categoria"),
    from: str(sp, "de"),
    to: str(sp, "ate"),
    financial: str(sp, "financeiro"),
    sort: str(sp, "ordem"),
    page: int(sp, "pagina"),
    pending: str(sp, "pendencias") === "1",
    upcomingTripDays: str(sp, "viagem") === "proximas" ? company.upcomingTripDays : undefined,
  };
  const [data, sellers] = await Promise.all([listSales(ctx, f), can(ctx, "sales.view_all") ? sellerOptions(ctx) : Promise.resolve([])]);
  const showMargin = can(ctx, "sales.view_margin");
  const filtered = Object.entries(f).some(([k, v]) => k !== "page" && v);

  return (
    <>
      <PageHeader
        title="Vendas"
        description={can(ctx, "sales.view_all") ? "Todas as vendas da agência." : "Suas vendas."}
        actions={
          can(ctx, "sales.create") && (
            <LinkButton href="/vendas/nova">
              <Plus className="h-4 w-4" /> Nova venda
            </LinkButton>
          )
        }
      />
      {(f.pending || f.upcomingTripDays) && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Badge tone="amber">{f.pending ? "Vendas com informações obrigatórias pendentes" : `Viagens nos próximos ${f.upcomingTripDays} dias`}</Badge>
          <Link href="/vendas" className="text-brand-600 hover:underline">
            limpar
          </Link>
        </div>
      )}
      <Card>
        <div className="border-b border-line p-3">
          <FilterForm>
            <FilterSearch value={f.q} placeholder="Código, cliente, destino, localizador" />
            <FilterSelect name="status" label="Status" value={f.status} options={SALE_STATUS.values.map((v) => ({ value: v, label: SALE_STATUS.label(v) }))} />
            <FilterSelect name="financeiro" label="Financeiro" value={f.financial} options={FINANCIAL_STATUS.values.map((v) => ({ value: v, label: FINANCIAL_STATUS.label(v) }))} />
            {sellers.length > 0 && <FilterSelect name="vendedor" label="Vendedor" value={f.sellerId} options={sellers.map((s) => ({ value: s.id, label: s.name }))} />}
            <FilterSelect name="categoria" label="Produto" value={f.productType} options={PRODUCT_TYPES.values.map((v) => ({ value: v, label: PRODUCT_TYPES.label(v) }))} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted">De</span>
              <input type="date" name="de" defaultValue={f.from} className="h-9 rounded-lg border border-line px-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted">Até</span>
              <input type="date" name="ate" defaultValue={f.to} className="h-9 rounded-lg border border-line px-2 text-sm" />
            </label>
            <FilterSelect
              name="ordem"
              label="Ordenar"
              value={f.sort}
              all={null}
              options={[
                { value: "recentes", label: "Mais recentes" },
                { value: "antigas", label: "Mais antigas" },
                { value: "maior_valor", label: "Maior valor" },
                { value: "menor_valor", label: "Menor valor" },
                ...(showMargin ? [{ value: "maior_lucro", label: "Maior lucro" }] : []),
                { value: "codigo", label: "Código" },
              ]}
            />
            {f.pending && <input type="hidden" name="pendencias" value="1" />}
            {f.upcomingTripDays && <input type="hidden" name="viagem" value="proximas" />}
          </FilterForm>
        </div>
        {data.items.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title={filtered ? "Nenhuma venda encontrada" : "Nenhuma venda registrada ainda"}
            description={filtered ? "Ajuste os filtros ou a busca." : "Registre a primeira venda: o financeiro, a comissão e o contrato são preparados automaticamente."}
            action={!filtered && can(ctx, "sales.create") ? <LinkButton href="/vendas/nova">Nova venda</LinkButton> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th>Cliente</Th>
                <Th>Destino</Th>
                <Th>Vendedor</Th>
                <Th>Data</Th>
                <Th align="right">Valor total</Th>
                {showMargin && <Th align="right">Lucro</Th>}
                <Th>Financeiro</Th>
                <Th>Contrato</Th>
                <Th align="right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <Td>
                    <Link href={`/vendas/${s.id}`} className="font-medium text-brand-700 hover:underline">
                      {s.code}
                    </Link>
                    <div className="mt-0.5">
                      <SaleStatusBadge s={s.status} />
                    </div>
                  </Td>
                  <Td className="max-w-48 truncate">{s.client.name}</Td>
                  <Td className="max-w-40 truncate text-slate-600">{s.destination ?? "—"}</Td>
                  <Td className="text-slate-600">{s.seller.name}</Td>
                  <Td className="whitespace-nowrap text-slate-600">{formatDate(s.saleDate)}</Td>
                  <Td align="right" className="font-medium">
                    {formatBRL(s.grossCents)}
                  </Td>
                  {showMargin && (
                    <Td align="right">
                      <span className={s.grossProfitCents! < 0 ? "text-danger" : ""}>{formatBRL(s.grossProfitCents)}</span>
                      <div className="text-xs text-muted">{formatPercentBps(s.marginBps ?? 0)}</div>
                    </Td>
                  )}
                  <Td>
                    <FinancialStatusBadge s={s.financialStatus} />
                  </Td>
                  <Td>
                    <ContractStatusBadge s={s.contractStatus} />
                  </Td>
                  <Td align="right">
                    <SaleRowActions id={s.id} code={s.code} status={s.status} canCancel={can(ctx, "sales.cancel") || s.status === "ORCAMENTO"} canCreate={can(ctx, "sales.create")} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} pages={data.pages} total={data.total} hrefFor={(p) => withParams("/vendas", sp, { pagina: p })} />
      </Card>
    </>
  );
}
