import Link from "next/link";
import { Plus, Users, Receipt, ShoppingBag, Download, TrendingUp, Armchair, Scale, Wallet } from "lucide-react";
import { orNotFound } from "@/server/page-helpers";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { getExcursion } from "@/server/services/excursions";
import { supplierOptions } from "@/server/services/registry";
import { Card, CardHeader, KpiCard, LinkButton, PageHeader, ProgressBar, Table, Td, Th, Badge, DataList } from "@/components/ui";
import { EntryStatusBadge, ExcursionStatusBadge, SaleStatusBadge } from "@/components/status";
import { formatBRL, formatPercentBps } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { displayStatus } from "@/lib/finance";
import { maskDocument } from "@/lib/utils";
import type { Params } from "@/lib/params";
import { AddCostButton, ExcursionFormButton, RoomCell } from "../excursion-client";

export const metadata = { title: "Excursão" };

export default async function ExcursionPage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const [e, suppliers] = await orNotFound(Promise.all([getExcursion(ctx, id), can(ctx, "suppliers.view") ? supplierOptions(ctx) : Promise.resolve([])]));
  const t = today(ctx);
  const st = e.stats;
  const open = e.status === "PLANEJADA" || e.status === "VENDAS_ABERTAS";

  return (
    <>
      <PageHeader
        back={{ href: "/excursoes", label: "Excursões" }}
        title={e.name}
        description={`${e.code} · ${e.destination} · ${formatDate(e.startDate)} a ${formatDate(e.endDate)}`}
        meta={
          <>
            <ExcursionStatusBadge s={e.status} />
            <Badge tone="gray">{formatBRL(e.pricePerSeatCents)} por passageiro</Badge>
          </>
        }
        actions={
          <>
            <a href={`/api/excursoes/${e.id}/passageiros`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-medium shadow-sm hover:bg-slate-50">
              <Download className="h-4 w-4" /> Lista de passageiros (CSV)
            </a>
            {e.canManage && (
              <ExcursionFormButton
                initial={{ id: e.id, name: e.name, destination: e.destination, startDate: e.startDate, endDate: e.endDate, seats: e.seats, pricePerSeatCents: e.pricePerSeatCents, status: e.status, notes: e.notes ?? "" }}
              />
            )}
            {can(ctx, "sales.create") && open && st.available > 0 && (
              <LinkButton href={`/vendas/nova?excursao=${e.id}`}>
                <Plus className="h-4 w-4" /> Nova reserva
              </LinkButton>
            )}
          </>
        }
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <p className="text-[13px] font-medium text-muted">Ocupação</p>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Armchair className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 font-display text-[22px] font-semibold">
            {st.booked}
            <span className="text-base font-normal text-muted">/{e.seats}</span>
          </p>
          <ProgressBar value={st.booked} max={e.seats} className="mt-3" tone={st.available <= 0 ? "green" : "blue"} />
          <p className="mt-2 text-xs text-muted">{st.available > 0 ? `${st.available} vaga(s) disponível(is)` : "Lotada"}</p>
        </Card>
        <KpiCard label="Vendido" value={formatBRL(st.grossCents)} icon={TrendingUp} tone="violet" hint={`recebido ${formatBRL(st.receivedCents)} de ${formatBRL(st.toReceiveCents)}`} />
        {st.costCents !== null && <KpiCard label="Custos da operação" value={formatBRL(st.costCents)} icon={Receipt} tone="red" hint={`pago ${formatBRL(st.paidCents)}`} />}
        {st.resultCents !== null && (
          <KpiCard
            label="Resultado previsto"
            value={formatBRL(st.resultCents)}
            icon={Scale}
            tone={st.resultCents < 0 ? "red" : "green"}
            hint={`margem ${formatPercentBps(st.marginBps ?? 0)}${st.resultPerPassengerCents !== null ? ` · ${formatBRL(st.resultPerPassengerCents)}/passageiro` : ""}`}
          />
        )}
      </section>

      {st.realizedCents !== null && (
        <Card className="mb-6 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Wallet className="h-4 w-4 text-brand-600" /> Previsto × realizado
          </h3>
          <DataList
            columns={3}
            items={[
              { label: "Recebimentos (previsto / realizado)", value: `${formatBRL(st.toReceiveCents)} / ${formatBRL(st.receivedCents)}` },
              { label: "Pagamentos (previsto / realizado)", value: `${formatBRL(st.toPayCents)} / ${formatBRL(st.paidCents)}` },
              { label: "Caixa realizado da excursão", value: <span className={st.realizedCents < 0 ? "font-semibold text-danger" : "font-semibold text-success"}>{formatBRL(st.realizedCents)}</span> },
            ]}
          />
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Passageiros e rooming list" icon={Users} description={`${e.passengers.filter((p) => !p.placeholder).length} nomeado(s) de ${st.booked} reservado(s)`} />
            {e.passengers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma reserva ainda.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Passageiro</Th>
                    <Th>Reserva</Th>
                    <Th>Contato</Th>
                    <Th>Quarto / poltrona</Th>
                  </tr>
                </thead>
                <tbody>
                  {e.passengers.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <p className={p.placeholder ? "text-sm italic text-muted" : "font-medium text-ink"}>{p.name}</p>
                        {!p.placeholder && <p className="text-xs text-muted">{maskDocument(p.document) || "sem documento"}</p>}
                      </Td>
                      <Td>
                        <Link href={`/vendas/${p.saleId}`} className="text-sm text-brand-700 hover:underline">
                          {p.saleCode}
                        </Link>
                        <p className="text-xs text-muted">{p.clientName}</p>
                      </Td>
                      <Td className="text-sm text-slate-600">{p.contact ?? "—"}</Td>
                      <Td>{p.placeholder ? <span className="text-xs text-muted">informe os passageiros na venda</span> : <RoomCell passengerId={p.id} room={p.room} seat={p.seat} editable={can(ctx, "sales.edit_all")} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Reservas (vendas)" icon={ShoppingBag} />
            {e.sales.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">Nenhuma reserva.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Venda</Th>
                    <Th>Cliente</Th>
                    <Th align="center">Passageiros</Th>
                    <Th align="right">Valor</Th>
                    <Th align="right">Recebido</Th>
                  </tr>
                </thead>
                <tbody>
                  {e.sales.map((s) => (
                    <tr key={s.id}>
                      <Td>
                        <Link href={`/vendas/${s.id}`} className="font-semibold text-ink hover:text-brand-700">
                          {s.code}
                        </Link>
                        <div className="mt-1">
                          <SaleStatusBadge s={s.status} />
                        </div>
                      </Td>
                      <Td>{s.client.name}</Td>
                      <Td align="center">{s.passengerCount}</Td>
                      <Td align="right">{formatBRL(s.grossCents)}</Td>
                      <Td align="right">{formatBRL(s.receivables.reduce((a, r) => a + r.settledCents, 0))}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {(e.showMargin || can(ctx, "finance.view")) && (
            <Card>
              <CardHeader title="Custos da operação" icon={Receipt} action={e.canManage && <AddCostButton excursionId={e.id} suppliers={suppliers} defaultDue={e.startDate > t ? e.startDate : t} />} />
              {e.payables.length === 0 ? (
                <p className="px-5 py-5 text-sm text-muted">Nenhum custo lançado.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {e.payables.map((p) => (
                    <li key={p.id} className={p.status === "CANCELADO" ? "px-5 py-3 opacity-50" : "px-5 py-3"}>
                      <div className="flex items-start justify-between gap-2 text-sm">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{p.description.replace(`${e.code} · `, "")}</span>
                          <span className="block text-xs text-muted">
                            {p.supplier?.name ?? "sem fornecedor"} · vence {formatDate(p.dueDate)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-medium tabular">{formatBRL(p.amountCents)}</span>
                          <EntryStatusBadge kind="payable" s={displayStatus(p.status, p.dueDate, t)} />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {e.notes && (
            <Card>
              <CardHeader title="Observações" />
              <p className="whitespace-pre-wrap p-5 text-sm text-slate-700">{e.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
