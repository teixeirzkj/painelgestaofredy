import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, AlertCircle, AlertTriangle, Info, ChevronRight, ShieldAlert } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { getDashboard } from "@/server/services/dashboard";
import { sellerOptions } from "@/server/services/settings";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { FilterForm, FilterSelect, PeriodSelect } from "@/components/filter-form";
import { BarList, CashChart, MarginChart, SalesEvolutionChart } from "@/components/charts";
import { formatBRL, formatPercentBps, ratioBps } from "@/lib/money";
import { formatDate, resolvePeriod } from "@/lib/dates";
import { PRODUCT_TYPES, SALE_STATUS } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-muted">sem base anterior</span>;
  const bps = ratioBps(cur - prev, Math.abs(prev));
  const up = bps >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-success" : "text-danger")}>
      <Icon className="h-3.5 w-3.5" />
      {formatPercentBps(Math.abs(bps))} <span className="font-normal text-muted">vs. anterior</span>
    </span>
  );
}

function Kpi({ label, value, footer, tone, href }: { label: string; value: string; footer?: React.ReactNode; tone?: "danger"; href?: string }) {
  const body = (
    <Card className={cn("h-full p-4 transition-shadow", href && "hover:shadow-md")}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1.5 truncate text-xl font-semibold tabular tracking-tight", tone === "danger" ? "text-danger" : "text-ink")}>{value}</p>
      <div className="mt-1 min-h-4">{footer}</div>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("dashboard.view");
  const sp = await searchParams;
  const t = today(ctx);
  const period = resolvePeriod(str(sp, "periodo"), t, str(sp, "de"), str(sp, "ate"));
  const filters = { from: period.from, to: period.to, sellerId: str(sp, "vendedor"), productType: str(sp, "categoria"), status: str(sp, "status") };
  const [d, sellers] = await Promise.all([getDashboard(ctx, filters), can(ctx, "sales.view_all") ? sellerOptions(ctx) : Promise.resolve([])]);
  const k = d.kpis;
  const p = d.previous;
  const f = d.finance;

  const alertIcon = { danger: AlertCircle, warning: AlertTriangle, info: Info };
  const alertTone = { danger: "text-danger bg-red-50", warning: "text-amber-700 bg-amber-50", info: "text-brand-700 bg-brand-50" };

  return (
    <>
      <PageHeader
        title={`Olá, ${ctx.userName.split(" ")[0]}`}
        description={`Visão geral de ${formatDate(period.from)} a ${formatDate(period.to)}${d.financial ? "" : " · suas vendas"}`}
      />
      {sp.negado && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <ShieldAlert className="h-4 w-4" /> Seu perfil não tem acesso à página solicitada.
        </div>
      )}

      <Card className="mb-6 p-3">
        <FilterForm>
          <PeriodSelect preset={period.preset} from={period.from} to={period.to} />
          {sellers.length > 0 && <FilterSelect name="vendedor" label="Vendedor" value={filters.sellerId} options={sellers.map((s) => ({ value: s.id, label: s.name }))} />}
          <FilterSelect name="categoria" label="Categoria" value={filters.productType} options={PRODUCT_TYPES.values.map((v) => ({ value: v, label: PRODUCT_TYPES.label(v) }))} all="Todas" />
          <FilterSelect
            name="status"
            label="Status da venda"
            value={filters.status}
            options={["CONFIRMADA", "CONCLUIDA", "ORCAMENTO", "CANCELADA"].map((v) => ({ value: v, label: SALE_STATUS.label(v) }))}
            all="Confirmadas e concluídas"
          />
        </FilterForm>
      </Card>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total vendido" value={formatBRL(k.grossCents)} footer={<Delta cur={k.grossCents} prev={p.grossCents} />} href="/vendas" />
        <Kpi label="Quantidade de vendas" value={String(k.count)} footer={<Delta cur={k.count} prev={p.count} />} />
        <Kpi label="Ticket médio" value={formatBRL(k.ticketCents)} footer={<Delta cur={k.ticketCents} prev={p.ticketCents} />} />
        {k.agencyRevenueCents !== null && <Kpi label="Receita da agência" value={formatBRL(k.agencyRevenueCents)} footer={<Delta cur={k.agencyRevenueCents} prev={p.agencyRevenueCents ?? 0} />} />}
        {k.grossProfitCents !== null && <Kpi label="Lucro bruto estimado" value={formatBRL(k.grossProfitCents)} footer={<Delta cur={k.grossProfitCents} prev={p.grossProfitCents ?? 0} />} />}
        {k.marginBps !== null && <Kpi label="Margem de lucro" value={formatPercentBps(k.marginBps)} footer={<span className="text-xs text-muted">lucro ÷ faturamento</span>} />}
        <Kpi label={d.financial ? "Comissões de vendedores" : "Suas comissões"} value={formatBRL(k.sellerCommissionCents)} footer={f ? <span className="text-xs text-muted">{formatBRL(f.commissionsPendingCents)} pendentes (total)</span> : undefined} />
        {f && (
          <>
            <Kpi label="A receber no período" value={formatBRL(f.receivableCents)} footer={<span className="text-xs text-muted">recebido: {formatBRL(f.receivedCents)}</span>} href="/financeiro/receber?status=ABERTO" />
            <Kpi label="A pagar no período" value={formatBRL(f.payableCents)} footer={<span className="text-xs text-muted">pago: {formatBRL(f.paidCents)}</span>} href="/financeiro/pagar?status=ABERTO" />
            <Kpi
              label="Valores vencidos"
              value={formatBRL(f.overdueReceivableCents + f.overduePayableCents)}
              tone={f.overdueReceivableCents + f.overduePayableCents > 0 ? "danger" : undefined}
              footer={
                <span className="text-xs text-muted">
                  receber {formatBRL(f.overdueReceivableCents)} · pagar {formatBRL(f.overduePayableCents)}
                </span>
              }
              href="/financeiro/receber?status=VENCIDO"
            />
          </>
        )}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Evolução das vendas" description="Faturamento mensal dos últimos 12 meses" />
          <div className="p-4">
            <SalesEvolutionChart data={d.evolution} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Atenção" description="Itens que precisam de ação" />
          <div className="divide-y divide-line">
            {d.alerts.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Tudo em dia. Nenhuma pendência encontrada.</p>}
            {d.alerts.map((a) => {
              const Icon = alertIcon[a.severity];
              return (
                <Link key={a.key} href={a.href} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
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
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {d.bySeller.length > 0 && (
          <Card>
            <CardHeader title="Vendas por vendedor" description="Faturamento no período" />
            <div className="p-5">
              <BarList items={d.bySeller.map((s) => ({ label: s.key, valueCents: s.valueCents, sub: `· ${s.count}` }))} />
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Vendas por categoria" description="Valor vendido por tipo de produto" />
          <div className="p-5">
            <BarList items={d.byCategory.map((s) => ({ label: PRODUCT_TYPES.label(s.key), valueCents: s.valueCents }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Destinos mais vendidos" description="Faturamento por destino" />
          <div className="p-5">
            <BarList items={d.byDestination.map((s) => ({ label: s.key, valueCents: s.valueCents, sub: `· ${s.count}` }))} />
          </div>
        </Card>
      </div>

      {(f || d.showMargin) && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          {f && (
            <Card>
              <CardHeader title="Recebimentos e pagamentos" description="Valores efetivamente movimentados por mês" />
              <div className="p-4">
                <CashChart data={f.cashSeries} />
              </div>
            </Card>
          )}
          {d.showMargin && (
            <Card>
              <CardHeader title="Margem de lucro por mês" description="Lucro bruto ÷ faturamento das vendas do mês" />
              <div className="p-4">
                <MarginChart data={d.evolution} />
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
