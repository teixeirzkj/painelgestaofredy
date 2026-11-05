import Link from "next/link";
import { ShoppingBag, TrendingUp, MapPin, Hotel } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { workMonth } from "@/server/month";
import { destinationsAnalysis } from "@/server/services/team";
import { Card, CardHeader, EmptyState, KpiCard, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { BarList } from "@/components/charts";
import { formatBRL } from "@/lib/money";
import { addMonths } from "@/lib/dates";
import { str, withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Destinos e hotéis" };

export default async function DestinationsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const tab = str(sp, "aba") === "hoteis" ? "hoteis" : "destinos";
  const twelve = str(sp, "periodo") === "12m";
  const wm = await workMonth(ctx.timezone);
  const from = twelve ? addMonths(wm.from, -11) : wm.from;
  const d = await destinationsAnalysis(ctx, from, wm.to);
  const list = tab === "destinos" ? d.destinations : d.hotels;

  return (
    <>
      <PageHeader
        title="Destinos e hotéis"
        description={<span>Análise dos destinos e hospedagens mais vendidos · <span>{twelve ? `12 meses até ${wm.label}` : wm.label}</span></span>}
        actions={
          <div className="flex rounded-xl border border-line bg-white p-0.5">
            {[
              { k: false, label: "Mês" },
              { k: true, label: "12 meses" },
            ].map((o) => (
              <Link key={o.label} href={withParams("/marketing/destinos", sp, { periodo: o.k ? "12m" : undefined })} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", twelve === o.k ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}>
                {o.label}
              </Link>
            ))}
          </div>
        }
      />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Vendas" value={String(d.sales)} icon={ShoppingBag} />
        <KpiCard label="Faturamento" value={formatBRL(d.gross)} icon={TrendingUp} tone="violet" />
        <KpiCard label="Destinos" value={String(d.destinations.length)} icon={MapPin} tone="green" />
        <KpiCard label="Hotéis" value={String(d.hotels.length)} icon={Hotel} tone="amber" />
      </section>
      <Tabs
        active={tab}
        items={[
          { key: "destinos", href: withParams("/marketing/destinos", sp, { aba: undefined }), label: "Destinos" },
          { key: "hoteis", href: withParams("/marketing/destinos", sp, { aba: "hoteis" }), label: "Hotéis" },
        ]}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={MapPin} title="Nenhum dado no período" description="Troque o mês no topo da tela ou veja os últimos 12 meses." />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-2">
            <CardHeader title={tab === "destinos" ? "Destinos mais vendidos" : "Hotéis mais vendidos"} description="Por faturamento" />
            <div className="p-5">
              <BarList items={list.slice(0, 10).map((x) => ({ label: x.name, valueCents: x.gross, sub: `· ${x.count}` }))} />
            </div>
          </Card>
          <Card className="xl:col-span-3">
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>{tab === "destinos" ? "Destino" : "Hotel"}</Th>
                  {tab === "hoteis" && <Th>Destino</Th>}
                  <Th align="center">{tab === "destinos" ? "Vendas" : "Reservas"}</Th>
                  {tab === "destinos" && <Th align="center">Passageiros</Th>}
                  <Th align="right">Faturamento</Th>
                  <Th align="right">Participação</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((x, i) => {
                  const total = list.reduce((a, y) => a + y.gross, 0);
                  return (
                    <tr key={x.name}>
                      <Td className="w-10 text-muted">{i + 1}</Td>
                      <Td className="font-medium">
                        {tab === "destinos" ? (
                          <Link href={`/vendas?q=${encodeURIComponent(x.name)}`} className="text-brand-700 hover:underline">
                            {x.name}
                          </Link>
                        ) : (
                          x.name
                        )}
                      </Td>
                      {tab === "hoteis" && <Td className="text-slate-600">{"destination" in x ? x.destination : ""}</Td>}
                      <Td align="center">{x.count}</Td>
                      {tab === "destinos" && <Td align="center">{"pax" in x ? x.pax : ""}</Td>}
                      <Td align="right" className="font-medium">
                        {formatBRL(x.gross)}
                      </Td>
                      <Td align="right" className="text-slate-600">
                        {total ? `${((x.gross / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
