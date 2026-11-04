import Link from "next/link";
import { Map, Plane, CalendarCheck, CircleCheck } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listTrips } from "@/server/services/trips";
import { Card, EmptyState, KpiCard, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSearch } from "@/components/filter-form";
import { TripStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { NewTripButton, TripStatusFilter } from "./trip-client";

export const metadata = { title: "Viagens" };

export default async function TripsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const status = str(sp, "status");
  const all = await listTrips(ctx, { q: str(sp, "q") });
  const trips = status ? all.filter((t) => t.status === status) : all;
  const count = (s: string) => all.filter((t) => t.status === s).length;

  return (
    <>
      <PageHeader
        title="Viagens"
        description="Cada viagem reúne as vendas de um cliente — passagem, hospedagem, seguro e serviços — com datas, passageiros, localizadores e documentos."
        actions={can(ctx, "sales.create") && <NewTripButton />}
      />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="A iniciar" value={String(count("A_INICIAR"))} icon={CalendarCheck} href="/viagens?status=A_INICIAR" />
        <KpiCard label="Em viagem agora" value={String(count("EM_VIAGEM"))} icon={Plane} tone="violet" href="/viagens?status=EM_VIAGEM" />
        <KpiCard label="Finalizadas" value={String(count("FINALIZADA"))} icon={CircleCheck} tone="green" href="/viagens?status=FINALIZADA" hint="prontas para pós-venda" />
      </section>
      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
          <FilterForm className="flex-1">
            <FilterSearch value={str(sp, "q")} placeholder="Código, nome da viagem, destino ou cliente" />
            {status && <input type="hidden" name="status" value={status} />}
          </FilterForm>
          <TripStatusFilter value={status} />
        </div>
        {trips.length === 0 ? (
          <EmptyState
            icon={Map}
            title="Nenhuma viagem encontrada"
            description="Crie uma viagem para agrupar as vendas de um cliente, ou vincule uma venda pela própria venda."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Viagem</Th>
                <Th>Cliente</Th>
                <Th>Período</Th>
                <Th align="center">Vendas</Th>
                <Th align="right">Valor total</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr key={t.id}>
                  <Td className="py-3.5">
                    <Link href={`/viagens/${t.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {t.title}
                    </Link>
                    <p className="text-xs text-muted">
                      {t.code}
                      {t.destination && ` · ${t.destination}`}
                    </p>
                  </Td>
                  <Td>{t.client.name}</Td>
                  <Td className="whitespace-nowrap text-slate-600">{t.start ? `${formatDate(t.start)} – ${formatDate(t.end)}` : "—"}</Td>
                  <Td align="center">{t.salesCount}</Td>
                  <Td align="right" className="font-medium">
                    {formatBRL(t.grossCents)}
                  </Td>
                  <Td>
                    <TripStatusBadge s={t.status} />
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
