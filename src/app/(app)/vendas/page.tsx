import Link from "next/link";
import { ShoppingBag, TrendingUp, PiggyBank, ArrowDownToLine, Hash, Map } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { prisma } from "@/server/db";
import { listSales } from "@/server/services/sales";
import { sellerOptions } from "@/server/services/settings";
import { Card, EmptyState, KpiCard, LinkButton, PageHeader, Pagination, Table, Td, Th, Badge } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect, MoreFilters } from "@/components/filter-form";
import { ContractStatusBadge, FinancialStatusBadge, SaleStatusBadge } from "@/components/status";
import { formatBRL, formatPercentBps } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { FINANCIAL_STATUS, PRODUCT_TYPES, SALE_STATUS } from "@/lib/constants";
import { int, str, withParams, type SearchParams } from "@/lib/params";
import { SaleRowActions } from "./sale-actions";
import { getMonde } from "@/server/services/monde";
import { MondeSalesButton } from "@/components/monde-import";

export const metadata = { title: "Vendas" };

const dateCls =
  "h-9 rounded-lg border border-line bg-white px-2 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100";

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
  const mondeAllowed = ["settings.manage", "sales.edit_all", "finance.manage"].every((k) => can(ctx, k as never));
  const filtered = Object.entries(f).some(([k, v]) => k !== "page" && k !== "sort" && v);
  const secondary = [f.productType, f.from, f.to, f.sellerId].filter(Boolean).length;
  const sm = data.summary;

  return (
    <>
      <PageHeader
        title="Vendas"
        description={can(ctx, "sales.view_all") ? "Vendas da agência, com situação financeira e de contrato." : "Suas vendas, com situação financeira e de contrato."}
        actions={mondeAllowed ? <MondeSalesButton monde={await getMonde(ctx)} /> : undefined}
      />

      <section aria-label="Resumo" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={filtered ? "Vendas no filtro" : "Vendas"} value={String(sm.count)} icon={Hash} hint="exceto canceladas" />
        <KpiCard label="Total vendido" value={formatBRL(sm.grossCents)} icon={TrendingUp} tone="violet" hint={sm.count && sm.grossProfitCents !== null ? `ticket ${formatBRL(Math.round(sm.grossCents / sm.count))}` : undefined} />
        {sm.grossProfitCents !== null ? (
          <KpiCard label="Lucro bruto" value={formatBRL(sm.grossProfitCents)} icon={PiggyBank} tone="green" hint={sm.grossCents ? `margem ${formatPercentBps(Math.round((sm.grossProfitCents * 10000) / sm.grossCents))}` : undefined} />
        ) : (
          <KpiCard label="Ticket médio" value={formatBRL(sm.count ? Math.round(sm.grossCents / sm.count) : 0)} icon={PiggyBank} tone="green" hint="valor médio por venda" />
        )}
        <KpiCard label="A receber dos clientes" value={formatBRL(sm.openCents)} icon={ArrowDownToLine} tone="amber" hint="parcelas em aberto destas vendas" />
      </section>

      {(f.pending || f.upcomingTripDays) && (
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Badge tone="amber" dot>
            {f.pending ? "Vendas com informações obrigatórias pendentes" : `Viagens nos próximos ${f.upcomingTripDays} dias`}
          </Badge>
          <Link href="/vendas" className="text-xs font-medium text-brand-600 hover:underline">
            limpar
          </Link>
        </div>
      )}

      <Card>
        <div className="border-b border-line px-4 py-3">
          <FilterForm>
            <FilterSearch value={f.q} placeholder="Código, cliente, passageiro, destino, localizador" />
            <FilterSelect name="status" label="Status" value={f.status} options={SALE_STATUS.values.map((v) => ({ value: v, label: SALE_STATUS.label(v) }))} />
            <FilterSelect name="financeiro" label="Situação financeira" value={f.financial} options={FINANCIAL_STATUS.values.map((v) => ({ value: v, label: FINANCIAL_STATUS.label(v) }))} />
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
            <MoreFilters active={secondary}>
              {sellers.length > 0 && <FilterSelect name="vendedor" label="Vendedor" value={f.sellerId} options={sellers.map((s) => ({ value: s.id, label: s.name }))} />}
              <FilterSelect name="categoria" label="Produto" value={f.productType} options={PRODUCT_TYPES.values.map((v) => ({ value: v, label: PRODUCT_TYPES.label(v) }))} />
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">Vendidas de</span>
                <input type="date" name="de" defaultValue={f.from} className={dateCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">até</span>
                <input type="date" name="ate" defaultValue={f.to} className={dateCls} />
              </label>
              {filtered && (
                <Link href="/vendas" className="mb-2 text-xs font-medium text-muted hover:text-brand-600">
                  Limpar filtros
                </Link>
              )}
            </MoreFilters>
          </FilterForm>
        </div>
        {data.items.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title={filtered ? "Nenhuma venda encontrada" : "Nenhuma venda registrada ainda"}
            description={filtered ? "Ajuste os filtros ou a busca." : "Registre a primeira venda: o financeiro, a comissão e o contrato são preparados automaticamente."}
            action={!filtered && can(ctx, "sales.create") ? <LinkButton href="/vendas/nova">Registrar venda</LinkButton> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Venda</Th>
                <Th>Cliente</Th>
                <Th>Destino e viagem</Th>
                {sellers.length > 0 && <Th>Vendedor</Th>}
                <Th align="right">Valor total</Th>
                {showMargin && <Th align="right">Lucro</Th>}
                <Th>Financeiro</Th>
                <Th>Contrato</Th>
                <Th align="right">
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <Td className="py-3.5">
                    <Link href={`/vendas/${s.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {s.code}
                    </Link>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <SaleStatusBadge s={s.status} /> {formatDate(s.saleDate)}
                    </div>
                  </Td>
                  <Td className="max-w-56">
                    <span className="block truncate font-medium text-ink">{s.client.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {PRODUCT_TYPES.label(s.mainProductType)}
                      {s.itemCount > 1 && ` + ${s.itemCount - 1} produto(s)`}
                    </span>
                  </Td>
                  <Td className="max-w-56">
                    <span className="block truncate text-slate-700">{s.destination ?? "—"}</span>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                      {s.tripStart ? `embarque ${formatDate(s.tripStart)}` : "sem data de viagem"}
                      {s.trip && (
                        <Link href={`/viagens/${s.trip.id}`} className="inline-flex items-center gap-0.5 text-brand-600 hover:underline">
                          <Map className="h-3 w-3" /> {s.trip.code}
                        </Link>
                      )}
                    </span>
                  </Td>
                  {sellers.length > 0 && <Td className="whitespace-nowrap text-slate-600">{s.seller.name}</Td>}
                  <Td align="right" className="font-semibold text-ink">
                    {formatBRL(s.grossCents)}
                  </Td>
                  {showMargin && (
                    <Td align="right">
                      <span className={s.grossProfitCents! < 0 ? "text-danger" : "text-ink"}>{formatBRL(s.grossProfitCents)}</span>
                      <div className="text-xs text-muted">{formatPercentBps(s.marginBps ?? 0)}</div>
                    </Td>
                  )}
                  <Td>
                    <FinancialStatusBadge s={s.financialStatus} />
                  </Td>
                  <Td>
                    <ContractStatusBadge s={s.contractStatus} />
                    {s.inTripContract &&
                      (s.tripContractPending ? (
                        <p className="mt-0.5 text-xs text-amber-700">Entra no contrato da viagem ao atualizar a prévia</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-muted">No contrato da viagem</p>
                      ))}
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
