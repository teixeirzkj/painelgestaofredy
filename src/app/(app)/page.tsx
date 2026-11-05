import { pagePeriod } from "@/server/month";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronRight,
  ShieldAlert,
  TrendingUp,
  Landmark,
  PiggyBank,
  Percent,
  ArrowDownToLine,
  ArrowUpFromLine,
  Wallet,
  ShoppingBag,
  Plane,
  FileSignature,
  CalendarClock,
  Receipt,
} from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { getDashboard } from "@/server/services/dashboard";
import { sellerOptions } from "@/server/services/settings";
import { Card, CardHeader, KpiCard, PageHeader, ProgressBar, SectionTitle, Notice } from "@/components/ui";
import { FilterForm, FilterSelect, PeriodSelect } from "@/components/filter-form";
import { BarList, CashChart, MarginChart, SalesEvolutionChart } from "@/components/charts";
import { ContractStatusBadge, SaleStatusBadge } from "@/components/status";
import { formatBRL, formatPercentBps, ratioBps } from "@/lib/money";
import { formatDate, resolvePeriod } from "@/lib/dates";
import { PAYABLE_CATEGORIES, PRODUCT_TYPES, SALE_STATUS } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const delta = (cur: number, prev: number | null | undefined, inverse = false) => (prev ? { bps: ratioBps(cur - prev, Math.abs(prev)), label: "vs. período anterior", inverse } : { bps: null, label: "sem base anterior" });

function greeting(timezone: string) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: timezone }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("dashboard.view");
  const sp = await searchParams;
  const t = today(ctx);
  const period = await pagePeriod(ctx.timezone, str(sp, "periodo"), str(sp, "de"), str(sp, "ate"));
  const filters = { from: period.from, to: period.to, sellerId: str(sp, "vendedor"), productType: str(sp, "categoria"), status: str(sp, "status") };
  const [d, sellers] = await Promise.all([getDashboard(ctx, filters), can(ctx, "sales.view_all") ? sellerOptions(ctx) : Promise.resolve([])]);
  const k = d.kpis;
  const p = d.previous;
  const f = d.finance;
  const L = d.lists;

  const alertIcon = { danger: AlertCircle, warning: AlertTriangle, info: Info };
  const alertTone = { danger: "text-danger bg-red-50", warning: "text-amber-700 bg-amber-50", info: "text-brand-700 bg-brand-50" };

  return (
    <>
      <PageHeader
        title={`${greeting(ctx.timezone)}, ${ctx.userName.split(" ")[0]}`}
        description={`Visão de ${formatDate(period.from)} a ${formatDate(period.to)}${d.financial ? "" : " · suas vendas"}`}
      />
      {sp.negado && (
        <div className="mb-5">
          <Notice tone="amber" title="Acesso restrito">
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" /> Seu perfil não tem acesso à página solicitada.
            </span>
          </Notice>
        </div>
      )}

      <Card className="mb-6 px-4 py-3">
        <FilterForm>
          <PeriodSelect preset={period.preset} from={period.from} to={period.to} />
          {sellers.length > 0 && <FilterSelect name="vendedor" label="Vendedor" value={filters.sellerId} options={sellers.map((s) => ({ value: s.id, label: s.name }))} />}
          <FilterSelect name="categoria" label="Produto" value={filters.productType} options={PRODUCT_TYPES.values.map((v) => ({ value: v, label: PRODUCT_TYPES.label(v) }))} all="Todos" />
          <FilterSelect
            name="status"
            label="Status da venda"
            value={filters.status}
            options={["CONFIRMADA", "CONCLUIDA", "ORCAMENTO", "CANCELADA"].map((v) => ({ value: v, label: SALE_STATUS.label(v) }))}
            all="Confirmadas e concluídas"
          />
        </FilterForm>
      </Card>

      {(d.result || f) && (
        <div className="mb-8 grid gap-5 xl:grid-cols-2">
          {d.result && (
            <Card className="bg-hero flex flex-col justify-between p-6">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Resultado do período</p>
                <p className={cn("mt-2 font-display text-[40px] font-bold leading-none tabular", d.result.resultCents < 0 ? "text-danger" : "text-success")}>{formatBRL(d.result.resultCents)}</p>
                <p className="mt-2 text-sm text-muted">Receita da agência − custos, comissões e despesas · competência, mesma regra do DRE</p>
              </div>
              <div className="mt-8 grid grid-cols-3 gap-4 border-t border-line pt-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Receita</p>
                  <p className="mt-1 font-semibold tabular text-ink">{formatBRL(d.result.netRevenueCents)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Custos e despesas</p>
                  <p className="mt-1 font-semibold tabular text-ink">{formatBRL(d.result.costsCents)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Margem</p>
                  <p className="mt-1 font-semibold tabular text-ink">{formatPercentBps(d.result.marginBps)}</p>
                </div>
              </div>
            </Card>
          )}
          {f && (
            <Card className="bg-hero flex flex-col justify-between p-6">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Caixa do período</p>
                <Link href="/financeiro/fluxo" className="text-xs font-medium text-brand-600 hover:underline">
                  Fluxo de caixa →
                </Link>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-6">
                <div>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <ArrowDownToLine className="h-3.5 w-3.5 text-success" /> Recebido
                  </p>
                  <p className="mt-1 font-display text-[26px] font-bold leading-tight tabular text-success">{formatBRL(f.receivedCents)}</p>
                  <p className="text-xs text-muted">a receber {formatBRL(f.receivableCents)}</p>
                </div>
                <div className="text-right">
                  <p className="flex items-center justify-end gap-1.5 text-xs text-muted">
                    <ArrowUpFromLine className="h-3.5 w-3.5 text-warning" /> Pago
                  </p>
                  <p className="mt-1 font-display text-[26px] font-bold leading-tight tabular text-warning">{formatBRL(f.paidCents)}</p>
                  <p className="text-xs text-muted">a pagar {formatBRL(f.payableCents)}</p>
                </div>
              </div>
              <div className="mt-6 border-t border-line pt-4">
                <div className="mb-1.5 flex justify-between text-xs text-muted">
                  <span>Recebido do previsto no período</span>
                  <span className="font-medium text-ink">{f.receivedCents + f.receivableCents ? Math.round((f.receivedCents / (f.receivedCents + f.receivableCents)) * 100) : 0}%</span>
                </div>
                <ProgressBar value={f.receivedCents} max={f.receivedCents + f.receivableCents} tone="green" />
                <p className="mt-3 text-xs text-muted">
                  Saldo nas contas hoje: <span className="font-semibold text-ink">{formatBRL(f.balanceCents)}</span>
                </p>
              </div>
            </Card>
          )}
        </div>
      )}

      <SectionTitle>Vendas</SectionTitle>
      <section aria-label="Vendas" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total vendido" value={formatBRL(k.grossCents)} icon={TrendingUp} delta={delta(k.grossCents, p.grossCents)} href="/vendas" />
        <KpiCard label="Quantidade de vendas" value={String(k.count)} icon={ShoppingBag} tone="violet" delta={delta(k.count, p.count)} />
        <KpiCard label="Ticket médio" value={formatBRL(k.ticketCents)} icon={Receipt} tone="amber" delta={delta(k.ticketCents, p.ticketCents)} />
        {k.marginBps !== null ? (
          <KpiCard label="Margem das vendas" value={formatPercentBps(k.marginBps)} icon={Percent} tone="green" hint="lucro bruto ÷ total vendido" />
        ) : (
          <KpiCard label={d.financial ? "Comissões de vendedores" : "Suas comissões"} value={formatBRL(k.sellerCommissionCents)} icon={PiggyBank} tone="green" />
        )}
      </section>

      {(k.agencyRevenueCents !== null || f) && (
        <>
          <SectionTitle>Receita & caixa</SectionTitle>
          <section aria-label="Receita e caixa" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {k.agencyRevenueCents !== null && <KpiCard label="Receita da agência" value={formatBRL(k.agencyRevenueCents)} icon={Landmark} tone="violet" delta={delta(k.agencyRevenueCents, p.agencyRevenueCents)} />}
            {k.grossProfitCents !== null && <KpiCard label="Lucro bruto" value={formatBRL(k.grossProfitCents)} icon={PiggyBank} tone="green" delta={delta(k.grossProfitCents, p.grossProfitCents)} />}
            {f && <KpiCard label="Saldo financeiro" value={formatBRL(f.balanceCents)} icon={Wallet} tone="slate" hint="soma das contas ativas hoje" href="/financeiro/contas" />}
            {f && <KpiCard label="Comissões pendentes" value={formatBRL(f.commissionsPendingCents)} icon={Receipt} tone="amber" hint="a pagar a vendedores" href="/financeiro/pagar?category=COMISSOES&status=ABERTO" />}
          </section>
        </>
      )}

      <SectionTitle>Atenção & evolução</SectionTitle>
      {f && f.overdueReceivableCents + f.overduePayableCents > 0 && (
        <Link href="/relatorios?r=contas-vencidas" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-red-200 bg-red-50/60 px-4 py-2.5 text-sm text-red-900 transition-colors hover:bg-red-50">
          <AlertCircle className="h-4 w-4 text-danger" />
          <span className="font-medium">Valores em atraso</span>
          <span>a receber {formatBRL(f.overdueReceivableCents)}</span>
          <span>a pagar {formatBRL(f.overduePayableCents)}</span>
          <ChevronRight className="ml-auto h-4 w-4" />
        </Link>
      )}

      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Evolução das vendas" description="Total vendido por mês · últimos 12 meses" />
          <div className="p-4">
            <SalesEvolutionChart data={d.evolution} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Alertas operacionais" description="O que precisa de ação agora" />
          <div className="divide-y divide-line">
            {d.alerts.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Tudo em dia. Nenhuma pendência encontrada.</p>}
            {d.alerts.map((a) => {
              const Icon = alertIcon[a.severity];
              return (
                <Link key={a.key} href={a.href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", alertTone[a.severity])}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{a.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {a.detail}
                      {a.amountCents !== undefined && ` · ${formatBRL(a.amountCents)}`}
                    </span>
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular text-slate-700">{a.count}</span>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      {(f || d.showMargin) && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          {f && (
            <Card>
              <CardHeader title="Fluxo de caixa" description="Recebimentos e pagamentos realizados por mês" action={<Link href="/financeiro/fluxo" className="text-xs font-medium text-brand-600 hover:underline">Ver fluxo completo</Link>} />
              <div className="p-4">
                <CashChart data={f.cashSeries} />
              </div>
            </Card>
          )}
          {d.showMargin && (
            <Card>
              <CardHeader title="Rentabilidade" description="Margem de lucro das vendas de cada mês" />
              <div className="p-4">
                <MarginChart data={d.evolution} />
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {d.bySeller.length > 0 && (
          <Card>
            <CardHeader title="Vendas por vendedor" description="Total vendido no período" />
            <div className="p-5">
              <BarList items={d.bySeller.map((s) => ({ label: s.key, valueCents: s.valueCents, sub: `· ${s.count}` }))} />
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Produtos mais vendidos" description="Itens vendidos por tipo de produto" />
          <div className="p-5">
            <BarList format="int" items={d.byProductCount.slice(0, 8).map((s) => ({ label: PRODUCT_TYPES.label(s.key), valueCents: s.valueCents, sub: `· ${formatBRL(d.byCategory.find((c) => c.key === s.key)?.valueCents ?? 0)}` }))} />
          </div>
        </Card>
        {f ? (
          <Card>
            <CardHeader title="Despesas por categoria" description="Contas a pagar com vencimento no período (sem custos de vendas)" />
            <div className="p-5">
              <BarList items={f.expensesByCategory.slice(0, 8).map((s) => ({ label: PAYABLE_CATEGORIES.label(s.key), valueCents: s.valueCents }))} />
            </div>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Destinos mais vendidos" description="Total vendido por destino" />
            <div className="p-5">
              <BarList items={d.byDestination.map((s) => ({ label: s.key, valueCents: s.valueCents, sub: `· ${s.count}` }))} />
            </div>
          </Card>
        )}
      </div>

      <SectionTitle>Acompanhamento</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Vendas recentes" icon={ShoppingBag} action={<Link href="/vendas" className="text-xs font-medium text-brand-600 hover:underline">Ver todas</Link>} />
          <ul className="divide-y divide-line">
            {L.recentSales.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nenhuma venda registrada.</li>}
            {L.recentSales.map((s) => (
              <li key={s.id}>
                <Link href={`/vendas/${s.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{s.client.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {s.code} · {s.destination ?? "Sem destino"} · {formatDate(s.saleDate)}
                    </span>
                  </span>
                  <SaleStatusBadge s={s.status} />
                  <span className="w-28 text-right text-sm font-medium tabular text-ink">{formatBRL(s.grossCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Próximas viagens" icon={Plane} action={<Link href="/vendas?viagem=proximas" className="text-xs font-medium text-brand-600 hover:underline">Ver todas</Link>} />
          <ul className="divide-y divide-line">
            {L.upcomingTrips.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nenhuma viagem agendada.</li>}
            {L.upcomingTrips.map((s) => (
              <li key={s.id}>
                <Link href={`/vendas/${s.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-brand-50 py-1 text-brand-700">
                    <span className="text-sm font-semibold leading-none">{s.tripStart!.slice(8, 10)}</span>
                    <span className="text-[10px] uppercase">{new Date(`${s.tripStart}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{s.destination ?? "Destino não informado"}</span>
                    <span className="block truncate text-xs text-muted">
                      {s.client.name} · {s.passengerCount} passageiro(s) · {s.code}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        {L.dueReceivables.length > 0 && (
          <Card>
            <CardHeader title="Pendências financeiras" description="Recebimentos vencidos ou que vencem em 7 dias" icon={CalendarClock} action={<Link href="/financeiro/receber?status=ABERTO" className="text-xs font-medium text-brand-600 hover:underline">Contas a receber</Link>} />
            <ul className="divide-y divide-line">
              {L.dueReceivables.map((r) => (
                <li key={r.id}>
                  <Link href={`/financeiro/receber?abrir=${r.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{r.client?.name ?? r.description}</span>
                      <span className="block truncate text-xs text-muted">{r.description}</span>
                    </span>
                    <span className={cn("text-xs font-medium", r.overdue ? "text-danger" : "text-muted")}>{r.overdue ? "venceu " : "vence "}{formatDate(r.dueDate)}</span>
                    <span className="w-28 text-right text-sm font-medium tabular text-ink">{formatBRL(r.balanceCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {can(ctx, "contracts.manage") && (
          <Card>
            <CardHeader title="Contratos pendentes" icon={FileSignature} action={<Link href="/contratos" className="text-xs font-medium text-brand-600 hover:underline">Ver contratos</Link>} />
            <ul className="divide-y divide-line">
              {L.pendingContracts.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nenhum contrato pendente.</li>}
              {L.pendingContracts.map((c) => (
                <li key={c.id}>
                  <Link href={`/contratos/${c.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{c.sale.client.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {c.sale.code}
                        {c.missing > 0 && ` · ${c.missing} dado(s) obrigatório(s) faltando`}
                      </span>
                    </span>
                    <ContractStatusBadge s={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
