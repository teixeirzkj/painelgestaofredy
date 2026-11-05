import { Trophy, TrendingUp, Users, Award } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { workMonth } from "@/server/month";
import { getRanking } from "@/server/services/team";
import { Card, EmptyState, KpiCard, PageHeader, ProgressBar, Table, Td, Th } from "@/components/ui";
import { formatBRL, formatPercentBps } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata = { title: "Ranking de vendedores" };

const medal = ["bg-amber-100 text-amber-700", "bg-slate-200 text-slate-700", "bg-orange-100 text-orange-700"];

export default async function RankingPage() {
  const ctx = await requirePageContext();
  const wm = await workMonth(ctx.timezone);
  const r = await getRanking(ctx, wm.month);
  const showProfit = r.rows.some((x) => x.profit !== null);
  const max = Math.max(1, ...r.rows.map((x) => x.gross));

  return (
    <>
      <PageHeader title="Ranking de vendedores" description={<span>{ctx.companyName.replace(/\s*\(DEMONSTRAÇÃO\)\s*/i, "")} · {wm.label}</span>} />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total da loja" value={formatBRL(r.total)} icon={TrendingUp} />
        <KpiCard label="Média por vendedor" value={formatBRL(r.average)} icon={Users} tone="violet" />
        <KpiCard label="Melhor vendedor" value={r.best ? r.best.name.split(" ")[0] : "—"} icon={Trophy} tone="amber" hint={r.best ? formatBRL(r.best.gross) : undefined} />
        <KpiCard label="Vendedores ativos" value={String(r.activeSellers)} icon={Award} tone="green" hint="com venda no mês" />
      </section>
      <Card>
        {r.activeSellers === 0 ? (
          <EmptyState icon={Trophy} title={`Sem vendas em ${wm.label}`} description="Troque o mês no seletor do topo para ver outro período." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th align="center">Posição</Th>
                <Th>Vendedor</Th>
                <Th align="center">Vendas</Th>
                <Th align="right">Faturamento</Th>
                <Th align="right">Ticket médio</Th>
                {showProfit && <Th align="right">Lucro bruto</Th>}
                <Th>Meta</Th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x, i) => (
                <tr key={x.id}>
                  <Td align="center">
                    <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold", i < 3 && x.count > 0 ? medal[i] : "bg-slate-100 text-slate-500")}>{i + 1}º</span>
                  </Td>
                  <Td className="min-w-48">
                    <p className={cn("font-semibold", x.id === ctx.userId ? "text-brand-700" : "text-ink")}>
                      {x.name}
                      {x.id === ctx.userId && <span className="ml-1.5 text-xs font-normal text-muted">(você)</span>}
                    </p>
                    <ProgressBar value={x.gross} max={max} className="mt-1.5 max-w-56" />
                  </Td>
                  <Td align="center">{x.count}</Td>
                  <Td align="right" className="font-semibold">
                    {formatBRL(x.gross)}
                  </Td>
                  <Td align="right">{formatBRL(x.ticket)}</Td>
                  {showProfit && <Td align="right">{x.profit === null ? "—" : formatBRL(x.profit)}</Td>}
                  <Td>{x.goalBps === null ? <span className="text-xs text-muted">sem meta</span> : <span className={cn("text-sm font-semibold", x.goalBps >= 10000 ? "text-success" : "text-ink")}>{formatPercentBps(x.goalBps)}</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
