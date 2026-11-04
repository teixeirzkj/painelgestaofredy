import Link from "next/link";
import { orNotFound } from "@/server/page-helpers";
import { Plus, Plane, ShieldCheck, ShieldOff, Map, IdCard, AlertTriangle } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { getClient } from "@/server/services/registry";
import { Card, CardHeader, LinkButton, PageHeader, Stat, Table, Td, Th, Badge } from "@/components/ui";
import { ContractStatusBadge, EntryStatusBadge, SaleStatusBadge, TripStatusBadge } from "@/components/status";
import { Notice } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatDocument, maskPassport } from "@/lib/utils";
import { PRODUCT_TYPES } from "@/lib/constants";
import type { Params } from "@/lib/params";
import { ArchiveClientButton, EditClientButton } from "../client-buttons";

export const metadata = { title: "Cliente" };

export default async function ClientPage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const { client: c, sales, receivables, contracts, stats, trips, asPassenger, passportAlert } = await orNotFound(getClient(ctx, id));
  const address = [c.street && `${c.street}${c.number ? `, ${c.number}` : ""}`, c.complement, c.district, c.city && `${c.city}${c.state ? `/${c.state}` : ""}`, c.zipCode].filter(Boolean).join(" · ");
  const canManage = can(ctx, "clients.manage");

  return (
    <>
      <PageHeader
        back={{ href: "/clientes", label: "Clientes" }}
        title={
          <span className="flex items-center gap-2">
            {c.name} {c.personType === "PJ" && <Badge tone="violet">Pessoa jurídica</Badge>} {c.archivedAt && <Badge>Arquivado</Badge>}
          </span>
        }
        description={[c.document && formatDocument(c.document), c.whatsapp ?? c.phone, c.email].filter(Boolean).join(" · ") || "Contato não informado"}
        actions={
          <>
            {canManage && <ArchiveClientButton id={c.id} archived={!!c.archivedAt} />}
            {canManage && <EditClientButton id={c.id} initial={c} />}
            {can(ctx, "sales.create") && !c.archivedAt && (
              <LinkButton href={`/vendas/nova?cliente=${c.id}`}>
                <Plus className="h-4 w-4" /> Nova venda
              </LinkButton>
            )}
          </>
        }
      />

      {passportAlert && (
        <Notice tone="amber" title={passportAlert === "VENCIDO" ? "Passaporte vencido" : "Passaporte vence em menos de 6 meses"} className="mb-6">
          Validade: {formatDate(c.passportExpiry)}. Muitos destinos exigem 6 meses de validade na data da viagem.
        </Notice>
      )}
      <Card className="mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-5">
        <Stat label="Compras" value={String(stats.count)} />
        <Stat label="Total comprado" value={formatBRL(stats.totalCents)} />
        <Stat label="Pago" value={formatBRL(stats.receivedCents)} tone="success" />
        <Stat label="Em aberto" value={formatBRL(stats.openCents)} />
        <Stat label="Em atraso" value={formatBRL(stats.overdueCents)} tone={stats.overdueCents > 0 ? "danger" : undefined} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Compras realizadas" />
            {sales.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma compra registrada.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Venda</Th>
                    <Th>Produto</Th>
                    <Th>Destino</Th>
                    <Th>Viagem</Th>
                    <Th align="right">Valor</Th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <Td>
                        <Link href={`/vendas/${s.id}`} className="font-medium text-brand-700 hover:underline">
                          {s.code}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                          {formatDate(s.saleDate)} <SaleStatusBadge s={s.status} />
                        </div>
                      </Td>
                      <Td className="text-slate-600">{PRODUCT_TYPES.label(s.mainProductType)}</Td>
                      <Td>{s.destination ?? "—"}</Td>
                      <Td className="whitespace-nowrap text-slate-600">{s.tripStart ? `${formatDate(s.tripStart)} – ${formatDate(s.tripEnd)}` : "—"}</Td>
                      <Td align="right">{formatBRL(s.grossCents)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {(trips.length > 0 || asPassenger.length > 0) && (
            <Card>
              <CardHeader title="Viagens" icon={Map} description="Vendas agrupadas por viagem e viagens como passageiro" />
              <ul className="divide-y divide-line">
                {trips.map((tr) => (
                  <li key={tr.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/viagens/${tr.id}`} className="min-w-0">
                      <span className="block truncate font-medium text-ink hover:text-brand-700">{tr.title}</span>
                      <span className="block text-xs text-muted">
                        {tr.code} · {tr.sales.length} venda(s){tr.start && ` · ${formatDate(tr.start)}`}
                      </span>
                    </Link>
                    <TripStatusBadge s={tr.status} />
                  </li>
                ))}
                {asPassenger.map((pp) => (
                  <li key={pp.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link href={`/vendas/${pp.sale.id}`} className="min-w-0">
                      <span className="block truncate font-medium text-ink hover:text-brand-700">{pp.sale.destination ?? pp.sale.code}</span>
                      <span className="block text-xs text-muted">
                        passageiro na venda {pp.sale.code} de {pp.sale.client.name}
                        {pp.sale.tripStart && ` · ${formatDate(pp.sale.tripStart)}`}
                      </span>
                    </Link>
                    <SaleStatusBadge s={pp.sale.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Pagamentos e pendências" />
            {receivables.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Nenhum lançamento.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Vencimento</Th>
                    <Th>Descrição</Th>
                    <Th align="right">Valor</Th>
                    <Th align="right">Saldo</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {receivables.map((r) => (
                    <tr key={r.id}>
                      <Td>{formatDate(r.dueDate)}</Td>
                      <Td className="max-w-72 truncate">
                        {r.sale && r.sale.clientId !== c.id && <Badge className="mr-1">pagante</Badge>}
                        {can(ctx, "finance.view") ? (
                          <Link className="hover:text-brand-700" href={`/financeiro/receber?abrir=${r.id}`}>
                            {r.description}
                          </Link>
                        ) : (
                          r.description
                        )}
                      </Td>
                      <Td align="right">{formatBRL(r.amountCents)}</Td>
                      <Td align="right">{formatBRL(r.balanceCents)}</Td>
                      <Td>
                        <EntryStatusBadge s={r.displayStatus} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Próximas viagens" />
            <ul className="divide-y divide-line">
              {stats.upcomingTrips.length === 0 && <li className="px-5 py-6 text-sm text-muted">Nenhuma viagem agendada.</li>}
              {stats.upcomingTrips.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <Plane className="h-4 w-4 text-brand-600" />
                  <Link href={`/vendas/${s.id}`} className="flex-1 hover:text-brand-700">
                    {s.destination ?? s.code}
                  </Link>
                  <span className="text-xs text-muted">{formatDate(s.tripStart)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Dados cadastrais" />
            <dl className="space-y-3 p-5 text-sm">
              <div>
                <dt className="text-xs text-muted">Endereço</dt>
                <dd>{address || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Nascimento</dt>
                <dd>{formatDate(c.birthDate)}</dd>
              </div>
              {(c.rg || c.passportNumber || c.specialNeeds) && (
                <div>
                  <dt className="flex items-center gap-1 text-xs text-muted">
                    <IdCard className="h-3.5 w-3.5" /> Documentos de viagem
                  </dt>
                  <dd className="space-y-0.5">
                    {c.rg && <p>RG ••••{c.rg.slice(-3)}</p>}
                    {c.passportNumber && (
                      <p>
                        Passaporte {maskPassport(c.passportNumber)}
                        {c.passportExpiry && ` · val. ${formatDate(c.passportExpiry)}`}
                      </p>
                    )}
                    {c.specialNeeds && (
                      <p className="flex items-center gap-1 text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" /> {c.specialNeeds}
                      </p>
                    )}
                  </dd>
                </div>
              )}
              {c.tradeName && (
                <div>
                  <dt className="text-xs text-muted">Nome fantasia</dt>
                  <dd>{c.tradeName}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted">Destinos já adquiridos</dt>
                <dd className="mt-1 flex flex-wrap gap-1">{stats.destinations.length ? stats.destinations.map((d) => <Badge key={d}>{d}</Badge>) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Comunicações automáticas</dt>
                <dd className="flex items-center gap-1">
                  {c.consentMessaging ? (
                    <>
                      <ShieldCheck className="h-4 w-4 text-success" /> Autorizadas
                    </>
                  ) : (
                    <>
                      <ShieldOff className="h-4 w-4 text-muted" /> Não autorizadas
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Vínculo com CRM Frédy</dt>
                <dd>{c.fredyContactId ? <Badge tone="blue">{c.fredyContactId}</Badge> : <span className="text-muted">Pendente de integração</span>}</dd>
              </div>
              {c.notes && (
                <div>
                  <dt className="text-xs text-muted">Observações operacionais</dt>
                  <dd className="whitespace-pre-wrap">{c.notes}</dd>
                </div>
              )}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Contratos" />
            <ul className="divide-y divide-line">
              {contracts.length === 0 && <li className="px-5 py-6 text-sm text-muted">Nenhum contrato.</li>}
              {contracts.map((ct) => (
                <li key={ct.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  {can(ctx, "contracts.manage") ? (
                    <Link href={`/contratos/${ct.id}`} className="hover:text-brand-700">
                      {ct.sale.code}
                    </Link>
                  ) : (
                    ct.sale.code
                  )}
                  <ContractStatusBadge s={ct.status} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
