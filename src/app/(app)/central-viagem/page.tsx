import Link from "next/link";
import { BellRing, CalendarClock, CircleAlert, MapPin, Plane, PlaneTakeoff, Users } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { travelCenter, SHORT_CONNECTION_MIN } from "@/server/services/flights";
import { Badge, Card, CardHeader, EmptyState, KpiCard, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { can } from "@/server/context";
import { openFlightAlerts, MONITOR_MODULE } from "@/server/services/flight-monitor";
import { CheckFlightsNow, FlightAlerts } from "./alerts-client";

export const metadata = { title: "Central da Viagem" };

type Row = Awaited<ReturnType<typeof travelCenter>>["flightsToday"][number];
const hhmm = (v: string | null) => (v ? v.slice(11, 16) : "—");
const ddmm = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}`;

const LIVE: Record<string, { label: string; tone: "gray" | "green" | "amber" | "red" | "blue" | "violet" }> = {
  Expected: { label: "No horário", tone: "green" },
  CheckIn: { label: "Check-in aberto", tone: "blue" },
  Boarding: { label: "Embarcando", tone: "blue" },
  GateClosed: { label: "Portão fechado", tone: "blue" },
  Departed: { label: "Decolou", tone: "blue" },
  EnRoute: { label: "Em voo", tone: "blue" },
  Approaching: { label: "Pousando", tone: "blue" },
  Arrived: { label: "Pousou", tone: "green" },
  Delayed: { label: "Atrasado", tone: "amber" },
  Canceled: { label: "Cancelado", tone: "red" },
  CanceledUncertain: { label: "Possível cancelamento", tone: "amber" },
  Diverted: { label: "Desviado", tone: "red" },
  NAO_ENCONTRADO: { label: "Sem informação", tone: "gray" },
  Unknown: { label: "Sem informação", tone: "gray" },
};

function LiveStatus({ f }: { f: Row }) {
  if (!f.liveStatus) return <Badge tone="gray">Programado</Badge>;
  const s = LIVE[f.liveStatus] ?? { label: f.liveStatus, tone: "gray" as const };
  const gate = [f.liveTerminal ? `T${f.liveTerminal}` : null, f.liveGate ? `portão ${f.liveGate}` : null].filter(Boolean).join(" · ");
  return (
    <div>
      <Badge tone={s.tone}>{s.label}</Badge>
      {(f.liveRevisedAt || gate) && (
        <p className="mt-1 text-xs text-muted">
          {f.liveRevisedAt && f.liveRevisedAt !== f.liveScheduledAt ? `prev. ${hhmm(f.liveRevisedAt)}` : ""}
          {f.liveRevisedAt && f.liveRevisedAt !== f.liveScheduledAt && gate ? " · " : ""}
          {gate}
        </p>
      )}
    </div>
  );
}

function FlightTable({ rows, showDate }: { rows: Row[]; showDate?: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Partida</Th>
          <Th>Voo</Th>
          <Th>Trecho</Th>
          <Th>Cliente</Th>
          <Th align="center">Passageiros</Th>
          <Th>Situação</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id}>
            <Td className="whitespace-nowrap py-3">
              <p className="font-semibold text-ink">{hhmm(f.departureAt)}</p>
              {showDate && <p className="text-xs text-muted">{ddmm(f.departureAt)}</p>}
            </Td>
            <Td className="whitespace-nowrap font-medium">
              {f.airline} {f.flightNumber}
            </Td>
            <Td className="whitespace-nowrap">
              {f.origin} → {f.destination}
              {f.arrivalAt && <p className="text-xs text-muted">chega {f.arrivalAt.slice(0, 10) !== f.departureAt.slice(0, 10) ? `${ddmm(f.arrivalAt)} ` : ""}{hhmm(f.arrivalAt)}</p>}
            </Td>
            <Td>
              <Link href={`/vendas/${f.sale.id}`} className="font-medium text-brand-700 hover:underline">
                {f.sale.client.name}
              </Link>
              <p className="text-xs text-muted">
                {f.sale.code} · {f.sale.client.whatsapp ?? f.sale.client.phone ?? "sem contato"}
              </p>
            </Td>
            <Td align="center">{f.sale.passengerCount}</Td>
            <Td>
              <LiveStatus f={f} />
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function TravelCenterPage() {
  const ctx = await requirePageContext();
  const c = await travelCenter(ctx);
  const monitor = ctx.modules.has(MONITOR_MODULE);
  const flightAlerts = monitor ? await openFlightAlerts(ctx) : [];
  const alerts = c.connections.length + c.missing.length + flightAlerts.length;

  return (
    <>
      <PageHeader title="Central da Viagem" description="Quem está viajando, os voos dos clientes e o que precisa de atenção antes de virar problema." />
      {monitor ? (
        <Notice className="mb-6" title="Monitor de voos ligado">
          Todo dia às 6h os voos de hoje e amanhã são conferidos com as companhias (AeroDataBox): cancelamento, atraso, mudança de horário e portão. Cada voo é conferido uma vez por dia; a situação mostrada é a da última conferência.
        </Notice>
      ) : (
        <Notice className="mb-6" title="Horários programados">
          Os voos mostram o horário cadastrado na venda (ou trazido do Monde). O acompanhamento de cancelamento, atraso e troca de portão é um recurso adicional: fale com o suporte da Frédy Gestão para liberar.
        </Notice>
      )}
      {monitor && (
        <Card className="mb-6">
          <CardHeader
            title="Alterações de voo"
            icon={BellRing}
            description={flightAlerts.length ? `${flightAlerts.length} para resolver` : "Nenhuma alteração em aberto"}
            action={can(ctx, "sales.view_all") ? <CheckFlightsNow /> : undefined}
          />
          {flightAlerts.length > 0 ? <FlightAlerts alerts={flightAlerts} agency={ctx.companyName} /> : <p className="p-5 text-sm text-muted">Quando um voo de cliente for cancelado, atrasar ou mudar de horário, o aviso aparece aqui com a mensagem pronta para o cliente.</p>}
        </Card>
      )}

      <section aria-label="Resumo" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Viajando agora" value={String(c.traveling.length)} icon={Users} tone="violet" hint={`${c.travelingPassengers} passageiro(s)`} />
        <KpiCard label="Voos hoje" value={String(c.flightsToday.length)} icon={PlaneTakeoff} />
        <KpiCard label="Voos amanhã" value={String(c.flightsTomorrow.length)} icon={Plane} tone="slate" />
        <KpiCard label="Pontos de atenção" value={String(alerts)} icon={CircleAlert} tone={alerts ? "amber" : "green"} hint={alerts ? (monitor ? "alterações de voo, conexões e voos faltando" : "conexões curtas e voos faltando") : "nada pendente"} />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Voos de hoje" icon={PlaneTakeoff} description={formatDate(c.today)} />
            {c.flightsToday.length ? <FlightTable rows={c.flightsToday} /> : <EmptyState icon={PlaneTakeoff} title="Nenhum voo de cliente hoje" />}
          </Card>
          <Card>
            <CardHeader title="Voos de amanhã" icon={Plane} />
            {c.flightsTomorrow.length ? <FlightTable rows={c.flightsTomorrow} /> : <EmptyState icon={Plane} title="Nenhum voo de cliente amanhã" />}
          </Card>
          <Card>
            <CardHeader title="Próximos 7 dias" icon={CalendarClock} />
            {c.flightsWeek.length ? <FlightTable rows={c.flightsWeek} showDate /> : <EmptyState icon={CalendarClock} title="Nenhum outro voo nos próximos dias" />}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Atenção" icon={CircleAlert} />
            <div className="space-y-4 p-5 text-sm">
              {alerts === 0 && <p className="text-muted">Nenhum ponto de atenção agora.</p>}
              {c.connections.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-ink">Conexões curtas (menos de {SHORT_CONNECTION_MIN} min)</p>
                  {c.connections.map((x) => (
                    <Link key={`${x.saleId}${x.at}`} href={`/vendas/${x.saleId}`} className="block rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 hover:bg-amber-100">
                      <p className="font-medium text-amber-900">
                        {x.minutes} min em {x.airport} · {x.sale.client.name}
                      </p>
                      <p className="text-xs text-amber-800">
                        {x.from} → {x.to} · {ddmm(x.at)} {hhmm(x.at)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
              {c.missing.length > 0 && (
                <div className="space-y-2">
                  <p className="font-medium text-ink">Embarques em até 15 dias sem voo cadastrado</p>
                  {c.missing.map((s) => (
                    <Link key={s.id} href={`/vendas/${s.id}`} className="block rounded-lg border border-line px-3 py-2 hover:bg-slate-50">
                      <p className="font-medium text-ink">{s.client.name}</p>
                      <p className="text-xs text-muted">
                        {s.code} · embarque {formatDate(s.tripStart)}
                        {s.destination ? ` · ${s.destination}` : ""}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Clientes por destino agora" icon={MapPin} description="Quem está viajando hoje" />
            <div className="space-y-3 p-5 text-sm">
              {c.destinations.length === 0 && <p className="text-muted">Nenhum cliente viajando hoje.</p>}
              {c.destinations.map((d) => (
                <div key={d.destination} className="rounded-lg border border-line p-3">
                  <p className="flex items-center justify-between font-medium text-ink">
                    <span>{d.destination}</span>
                    <Badge tone="violet">{d.passengers} pax</Badge>
                  </p>
                  <ul className="mt-2 space-y-1">
                    {d.sales.map((s) => (
                      <li key={s.id} className="flex justify-between gap-2 text-xs">
                        <Link href={`/vendas/${s.id}`} className="text-brand-700 hover:underline">
                          {s.client.name}
                        </Link>
                        <span className="text-muted">volta {formatDate(s.tripEnd)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
