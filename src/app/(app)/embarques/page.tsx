import Link from "next/link";
import { Plane, CircleAlert, Users, CalendarClock } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { upcomingDepartures } from "@/server/services/team";
import { Badge, Card, EmptyState, KpiCard, PageHeader, Table, Td, Th, Tabs } from "@/components/ui";
import { formatBRL, sum } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Próximos embarques" };

const OPTIONS = [7, 15, 30, 60];

export default async function DeparturesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const days = OPTIONS.includes(Number(str(sp, "dias"))) ? Number(str(sp, "dias")) : 15;
  const rows = await upcomingDepartures(ctx, days);
  const withPending = rows.filter((r) => r.pending.length > 0).length;

  return (
    <>
      <PageHeader title="Próximos embarques" description="Viagens confirmadas que embarcam nos próximos dias, com o que ainda falta resolver antes da partida." />
      <Tabs active={String(days)} items={OPTIONS.map((d) => ({ key: String(d), href: `/embarques?dias=${d}`, label: `Próximos ${d} dias` }))} />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Embarques no período" value={String(rows.length)} icon={Plane} />
        <KpiCard label="Passageiros" value={String(sum(rows.map((r) => r.passengerCount)))} icon={Users} tone="violet" />
        <KpiCard label="Com pendências" value={String(withPending)} icon={CircleAlert} tone={withPending ? "amber" : "green"} hint="resolva antes do embarque" />
      </section>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title={`Nenhum embarque nos próximos ${days} dias`} description="Amplie o período para ver viagens mais distantes." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Embarque</Th>
                <Th>Cliente</Th>
                <Th>Destino</Th>
                <Th align="center">Passageiros</Th>
                <Th>Vendedor</Th>
                <Th align="right">Saldo em aberto</Th>
                <Th>Pendências</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap py-3.5">
                    <p className="font-semibold text-ink">{formatDate(r.tripStart)}</p>
                    <p className={cn("text-xs", r.daysLeft <= 3 ? "font-medium text-danger" : "text-muted")}>{r.daysLeft === 0 ? "hoje" : r.daysLeft === 1 ? "amanhã" : `em ${r.daysLeft} dias`}</p>
                  </Td>
                  <Td>
                    <Link href={`/vendas/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {r.client.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {r.code} · {r.client.whatsapp ?? r.client.phone ?? "sem contato"}
                    </p>
                  </Td>
                  <Td>
                    {r.destination ?? "—"}
                    {r.tripEnd && <p className="text-xs text-muted">retorno {formatDate(r.tripEnd)}</p>}
                  </Td>
                  <Td align="center">{r.passengerCount}</Td>
                  <Td className="text-slate-600">{r.seller}</Td>
                  <Td align="right" className={r.openCents > 0 ? "font-medium text-warning" : "text-muted"}>
                    {formatBRL(r.openCents)}
                  </Td>
                  <Td>
                    {r.pending.length === 0 ? (
                      <Badge tone="green" dot>
                        Tudo pronto
                      </Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.pending.map((p) => (
                          <Badge key={p} tone="amber">
                            {p}
                          </Badge>
                        ))}
                      </div>
                    )}
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
