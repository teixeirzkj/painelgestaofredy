import Link from "next/link";
import { Trophy, Plane, ShoppingBag } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { workMonth } from "@/server/month";
import { sellerDashboard } from "@/server/services/team";
import { sellerOptions } from "@/server/services/settings";
import { Card, CardHeader, PageHeader, ProgressBar, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { SaleStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { TodoTabs } from "./todo-tabs";

export const metadata = { title: "Dashboard do vendedor" };

function greeting(timezone: string) {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: timezone }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function SellerDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("dashboard.view");
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const canAll = can(ctx, "sales.view_all");
  const sellers = canAll ? await sellerOptions(ctx) : [];
  const requested = str(sp, "vendedor");
  const sellerId = canAll && requested && sellers.some((s) => s.id === requested) ? requested : ctx.userId;
  const d = await sellerDashboard(ctx, sellerId, wm.month);
  const monthName = wm.label.split(" de ")[0];
  const weekday = new Date(`${wm.today}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const revenueTotal = d.revenue.commission + d.revenue.over + d.revenue.fees;
  const pct = d.goal ? Math.min(999, Math.round((d.gross / Math.max(d.goal.amountCents, 1)) * 100)) : null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{initials(d.seller.name)}</span>
          <div>
            <h1 className="font-display text-[22px] font-bold leading-tight text-ink sm:text-[26px]">
              {greeting(ctx.timezone)}, {d.seller.name.split(" ")[0]}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span className="inline-block first-letter:uppercase">{weekday}</span>
              {d.ranking.position && (
                <span className="inline-flex items-center gap-1 font-medium text-warning">
                  <Trophy className="h-3.5 w-3.5" /> {d.ranking.position}º de {Math.max(d.ranking.of, d.ranking.position)} no ranking
                </span>
              )}
            </p>
          </div>
        </div>
        {canAll && (
          <FilterForm>
            <FilterSelect name="vendedor" label="Vendedor" value={sellerId} options={sellers.map((s) => ({ value: s.id, label: s.name }))} all={null} />
          </FilterForm>
        )}
      </div>

      <Card className="mb-6 p-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Minha meta · {monthName}</p>
            {d.goal ? (
              <>
                <p className="mt-3 text-sm text-muted">
                  Meta de <span className="font-semibold text-ink">{formatBRL(d.goal.amountCents)}</span>
                  {d.goal.superAmountCents > 0 && <> · super meta {formatBRL(d.goal.superAmountCents)}</>}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <ProgressBar value={d.gross} max={d.goal.amountCents} tone={d.gross >= d.goal.amountCents ? "green" : "blue"} className="h-2" />
                  <span className="text-sm font-semibold tabular text-ink">{pct}%</span>
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">Nenhuma meta definida para {monthName}. Fale com seu gerente.</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Vendido</p>
              <p className="mt-1 font-display text-lg font-bold tabular text-ink">{formatBRL(d.gross)}</p>
              <p className="text-xs text-muted">{d.count} venda(s) no período</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Falta</p>
              <p className="mt-1 font-display text-lg font-bold tabular text-ink">{d.missingCents === null ? "—" : formatBRL(d.missingCents)}</p>
              <p className="text-xs text-muted">{d.goal ? (d.missingCents === 0 ? "meta batida" : "para a meta") : "sem meta"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Comissão</p>
              <p className="mt-1 font-display text-lg font-bold tabular text-success">{formatBRL(d.commissionCents)}</p>
              <p className="text-xs text-muted">estimada</p>
            </div>
          </div>
        </div>
        <div className="mt-6 border-t border-line pt-5">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Receita gerada</p>
            <p className="font-display text-xl font-bold tabular text-brand-700">{formatBRL(revenueTotal)}</p>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              { label: "Comissão e margem dos produtos", value: d.revenue.commission, dot: "bg-brand-600" },
              { label: "Over (incentivos de operadoras)", value: d.revenue.over, dot: "bg-sky-500" },
              { label: "Taxas (RAV, DU e serviço)", value: d.revenue.fees, dot: "bg-amber-500" },
            ].map((r) => (
              <li key={r.label} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${r.dot}`} /> {r.label}
                </span>
                <span className="font-medium tabular text-ink">{formatBRL(r.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <TodoTabs
          tasks={d.todo.tasks.map((t) => ({ id: t.id, title: t.title, date: t.dueDate, href: "/equipe/tarefas" }))}
          contracts={d.todo.contracts.map((c) => ({ id: c.id, title: `${c.sale.code} · ${c.sale.client.name}`, date: null, href: `/contratos/${c.id}` }))}
          credits={d.todo.credits.map((c) => ({ id: c.id, title: `${c.client.name} · ${formatBRL(c.amountCents)}`, date: c.expiresAt, href: "/creditos" }))}
          birthdays={d.todo.birthdays.map((b) => ({ id: b.id, title: b.name, date: `${wm.month}-${b.day}`, href: b.href ?? "/aniversariantes" }))}
        />
        <Card>
          <CardHeader title="Próximos embarques" description="próximos 7 dias" icon={Plane} action={<Link href="/embarques" className="text-xs font-medium text-brand-600 hover:underline">Ver todos</Link>} />
          <ul className="divide-y divide-line">
            {d.departures.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nenhum embarque nos próximos 7 dias.</li>}
            {d.departures.map((s) => (
              <li key={s.id}>
                <Link href={`/vendas/${s.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50">
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-brand-50 py-1 text-brand-700">
                    <span className="text-sm font-semibold leading-none">{s.tripStart!.slice(8, 10)}</span>
                    <span className="text-[10px] uppercase">{new Date(`${s.tripStart}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{s.destination ?? "Destino não informado"}</span>
                    <span className="block truncate text-xs text-muted">
                      {s.client.name} · {s.code}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Últimas vendas" icon={ShoppingBag} action={<Link href="/vendas" className="text-xs font-medium text-brand-600 hover:underline">Ver todas</Link>} />
        {d.recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma venda ainda.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Cliente</Th>
                <Th>Destino</Th>
                <Th align="right">Valor</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((s) => (
                <tr key={s.id}>
                  <Td className="whitespace-nowrap">{formatDate(s.saleDate)}</Td>
                  <Td>
                    <Link href={`/vendas/${s.id}`} className="font-medium text-ink hover:text-brand-700">
                      {s.client.name}
                    </Link>
                    <p className="text-xs text-muted">{s.code}</p>
                  </Td>
                  <Td className="text-slate-600">{s.destination ?? "—"}</Td>
                  <Td align="right" className="font-semibold">
                    {formatBRL(s.grossCents)}
                  </Td>
                  <Td>
                    <SaleStatusBadge s={s.status} />
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
