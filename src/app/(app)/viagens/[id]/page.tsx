import Link from "next/link";
import { Plus, ShoppingBag, Users, Ticket, Paperclip, Building2, Wallet } from "lucide-react";
import { orNotFound } from "@/server/page-helpers";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { getTrip } from "@/server/services/trips";
import { Card, CardHeader, KpiCard, LinkButton, Notice, PageHeader, Table, Td, Th, Badge } from "@/components/ui";
import { ContractStatusBadge, FinancialStatusBadge, ReservationStatusBadge, SaleStatusBadge, TripStatusBadge } from "@/components/status";
import { AttachmentsPanel } from "@/components/attachments";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PRODUCT_TYPES } from "@/lib/constants";
import { maskDocument, maskPassport, formatDocument } from "@/lib/utils";
import type { Params } from "@/lib/params";
import { TripActions, UnlinkSaleButton } from "../trip-client";

export const metadata = { title: "Viagem" };

export default async function TripPage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const trip = await orNotFound(getTrip(ctx, id));
  const items = trip.sales.filter((s) => s.status !== "CANCELADA").flatMap((s) => s.items.map((i) => ({ ...i, saleCode: s.code, saleId: s.id })));
  const suppliers = [...new Map(items.filter((i) => i.supplier || i.operator).map((i) => [(i.operator ?? i.supplier)!.id, (i.operator ?? i.supplier)!])).values()];

  return (
    <>
      <PageHeader
        back={{ href: "/viagens", label: "Viagens" }}
        title={trip.title}
        description={
          <>
            {trip.code} ·{" "}
            <Link href={`/clientes/${trip.client.id}`} className="font-medium text-ink hover:text-brand-700">
              {trip.client.name}
            </Link>
            {trip.destination && ` · ${trip.destination}`}
          </>
        }
        meta={
          <>
            <TripStatusBadge s={trip.status} />
            {trip.start && (
              <Badge tone="gray">
                {formatDate(trip.start)} – {formatDate(trip.end)}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <TripActions trip={{ id: trip.id, clientId: trip.clientId, title: trip.title, destination: trip.destination, notes: trip.notes, cancelled: !!trip.cancelledAt }} canCancel={can(ctx, "sales.cancel")} />
            {can(ctx, "sales.create") && !trip.cancelledAt && (
              <LinkButton href={`/vendas/nova?viagem=${trip.id}`}>
                <Plus className="h-4 w-4" /> Venda nesta viagem
              </LinkButton>
            )}
          </>
        }
      />
      {trip.cancelledAt && (
        <Notice tone="red" title="Viagem cancelada" className="mb-6">
          As vendas vinculadas foram mantidas como estavam.
        </Notice>
      )}

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Valor total" value={formatBRL(trip.totals.grossCents)} icon={Wallet} hint={`${trip.sales.filter((s) => s.status !== "CANCELADA").length} venda(s)`} />
        <KpiCard label="Recebido" value={formatBRL(trip.totals.receivedCents)} icon={Wallet} tone="green" />
        <KpiCard label="Em aberto" value={formatBRL(trip.totals.openCents)} icon={Wallet} tone="amber" />
        {trip.totals.grossProfitCents !== null ? (
          <KpiCard label="Lucro bruto" value={formatBRL(trip.totals.grossProfitCents)} icon={Wallet} tone="violet" />
        ) : (
          <KpiCard label="Passageiros" value={String(trip.passengers.length)} icon={Users} tone="violet" />
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Vendas da viagem" icon={ShoppingBag} />
            {trip.sales.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma venda vinculada. Use “Venda nesta viagem” ou “Vincular venda existente”.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Venda</Th>
                    <Th>Produtos</Th>
                    <Th>Período</Th>
                    <Th align="right">Valor</Th>
                    <Th>Financeiro</Th>
                    <Th>Contrato</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {trip.sales.map((s) => (
                    <tr key={s.id} className={s.status === "CANCELADA" ? "opacity-60" : ""}>
                      <Td>
                        <Link href={`/vendas/${s.id}`} className="font-semibold text-ink hover:text-brand-700">
                          {s.code}
                        </Link>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted">
                          <SaleStatusBadge s={s.status} /> {formatDate(s.saleDate)}
                        </div>
                      </Td>
                      <Td className="max-w-56 text-slate-600">{[...new Set(s.items.map((i) => PRODUCT_TYPES.label(i.productType)))].join(", ")}</Td>
                      <Td className="whitespace-nowrap text-slate-600">{s.tripStart ? `${formatDate(s.tripStart)} – ${formatDate(s.tripEnd)}` : "—"}</Td>
                      <Td align="right" className="font-medium">
                        {formatBRL(s.grossCents)}
                      </Td>
                      <Td>
                        <FinancialStatusBadge s={s.financialStatus} />
                      </Td>
                      <Td>{s.contracts[0] ? <ContractStatusBadge s={s.contracts[0].status} /> : <span className="text-xs text-muted">—</span>}</Td>
                      <Td align="right">{(s.sellerId === ctx.userId || can(ctx, "sales.edit_all")) && <UnlinkSaleButton saleId={s.id} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Reservas e localizadores" icon={Ticket} description="Situação operacional de cada produto" />
            {items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">Sem produtos.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Produto</Th>
                    <Th>Fornecedor</Th>
                    <Th>Localizador</Th>
                    <Th>Reserva</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <Td>
                        <p className="font-medium">{PRODUCT_TYPES.label(i.productType)}</p>
                        <p className="text-xs text-muted">
                          {i.description ?? ""} · {i.saleCode}
                        </p>
                      </Td>
                      <Td className="text-slate-600">
                        {i.supplier?.name ?? "—"}
                        {i.operator && <span className="block text-xs text-muted">via {i.operator.name}</span>}
                      </Td>
                      <Td className="font-mono text-xs">{i.reservation?.locator ?? i.locator ?? "—"}</Td>
                      <Td>{i.reservation ? <ReservationStatusBadge s={i.reservation.status} /> : <span className="text-xs text-muted">—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Documentos e vouchers" icon={Paperclip} description="Da viagem e das vendas vinculadas (coluna Origem)" />
            <AttachmentsPanel target={{ kind: "trip", id: trip.id }} items={trip.documents} canUpload={can(ctx, "sales.create") && !trip.cancelledAt} timezone={ctx.timezone} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Cliente" action={<Link href={`/clientes/${trip.client.id}`} className="text-xs font-medium text-brand-600 hover:underline">Ver cadastro</Link>} />
            <div className="space-y-1 p-5 text-sm">
              <p className="font-semibold text-ink">{trip.client.name}</p>
              <p className="text-muted">{trip.client.document ? formatDocument(trip.client.document) : "CPF/CNPJ não informado"}</p>
              <p className="text-muted">{trip.client.whatsapp ?? trip.client.phone ?? "—"}</p>
              {trip.client.email && <p className="text-muted">{trip.client.email}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Passageiros" icon={Users} description="Sem repetição entre as vendas" />
            {trip.passengers.length === 0 ? (
              <p className="px-5 py-5 text-sm text-muted">Nenhum passageiro informado nas vendas.</p>
            ) : (
              <ul className="divide-y divide-line">
                {trip.passengers.map((p) => (
                  <li key={p.id} className="px-5 py-2.5 text-sm">
                    <p className="font-medium text-ink">{p.name}</p>
                    <p className="text-xs text-muted">
                      {maskDocument(p.document) || "sem documento"}
                      {p.passportNumber && ` · Pass. ${maskPassport(p.passportNumber)}`}
                      {p.passportExpiry && ` (val. ${formatDate(p.passportExpiry)})`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Fornecedores" icon={Building2} />
            {suppliers.length === 0 ? (
              <p className="px-5 py-5 text-sm text-muted">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {suppliers.map((s) => (
                  <li key={s.id} className="px-5 py-2.5 text-sm">
                    {can(ctx, "suppliers.view") ? (
                      <Link href={`/fornecedores/${s.id}`} className="hover:text-brand-700">
                        {s.name}
                      </Link>
                    ) : (
                      s.name
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {trip.notes && (
            <Card>
              <CardHeader title="Observações" />
              <p className="whitespace-pre-wrap p-5 text-sm text-slate-700">{trip.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
