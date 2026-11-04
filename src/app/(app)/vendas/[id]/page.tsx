import Link from "next/link";
import { orNotFound } from "@/server/page-helpers";
import { FileSignature, ExternalLink } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { getSale, getSaleAudit } from "@/server/services/sales";
import { Card, CardHeader, LinkButton, Notice, PageHeader, Stat, Table, Td, Th, Badge } from "@/components/ui";
import { ContractStatusBadge, EntryStatusBadge, FinancialStatusBadge, SaleStatusBadge } from "@/components/status";
import { formatBRL, formatPercentBps } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { COMMERCIAL_MODELS, PAYABLE_CATEGORIES, PAYMENT_METHODS, PRODUCT_TYPES } from "@/lib/constants";
import { displayStatus } from "@/lib/finance";
import { maskDocument, maskPassport, formatDocument } from "@/lib/utils";
import { today } from "@/server/context";
import type { Params } from "@/lib/params";
import { SaleHeaderActions } from "../sale-actions";
import { ReservationEditor } from "./reservation-editor";
import { PrepareContractButton } from "./prepare-contract";

export const metadata = { title: "Venda" };

const ACTION_LABEL: Record<string, string> = {
  "venda.criada_confirmada": "Venda criada e confirmada",
  "venda.criada_rascunho": "Rascunho criado",
  "venda.confirmada": "Venda confirmada",
  "venda.alterada": "Venda alterada",
  "venda.cancelada": "Venda cancelada",
};

export default async function SalePage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const [s, history] = await orNotFound(Promise.all([getSale(ctx, id), getSaleAudit(ctx, id)]));
  const t = today(ctx);
  const contract = s.contracts[0];
  const salesRec = s.receivables.filter((r) => r.origin === "VENDA");
  const supplierRec = s.receivables.filter((r) => r.origin !== "VENDA");
  const missing = [!s.destination && "destino", !s.tripStart && "data da viagem", !s.locator && "localizador", !s.client.document && "CPF/CNPJ do cliente"].filter(Boolean);

  return (
    <>
      <PageHeader
        back={{ href: "/vendas", label: "Vendas" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {s.code} <SaleStatusBadge s={s.status} /> <FinancialStatusBadge s={s.financialStatus} />
          </span>
        }
        description={`${s.client.name} · ${s.destination ?? "destino não informado"} · vendida em ${formatDate(s.saleDate)} por ${s.seller.name}`}
        actions={<SaleHeaderActions id={s.id} code={s.code} status={s.status} canEdit={s.permissions.canEdit} canCancel={s.permissions.canCancel} canCreate={can(ctx, "sales.create")} />}
      />

      {s.status === "CANCELADA" && (
        <div className="mb-6">
          <Notice tone="red" title="Venda cancelada">
            {s.cancelReason} {s.cancelledAt && `· em ${formatDateTime(s.cancelledAt, ctx.timezone)}`}
          </Notice>
        </div>
      )}
      {s.status === "ORCAMENTO" && (
        <div className="mb-6">
          <Notice title="Rascunho">Esta venda ainda não foi confirmada: nenhum lançamento financeiro, comissão ou contrato foi gerado.</Notice>
        </div>
      )}
      {s.status === "CONFIRMADA" && missing.length > 0 && (
        <div className="mb-6">
          <Notice tone="amber" title="Informações pendentes">
            Complete: {missing.join(", ")}.
          </Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Stat label="Faturamento" value={formatBRL(s.grossCents)} />
            <Stat label="A receber do cliente" value={formatBRL(s.clientPayableCents)} />
            {s.permissions.showMargin ? (
              <>
                <Stat label="Receita da agência" value={formatBRL(s.agencyRevenueCents)} />
                <Stat label="Lucro bruto" value={formatBRL(s.grossProfitCents)} hint={`Margem ${formatPercentBps(s.marginBps ?? 0)}`} tone={(s.grossProfitCents ?? 0) < 0 ? "danger" : "success"} />
                <Stat label="Custos / repasses" value={formatBRL(s.costCents)} />
              </>
            ) : null}
            <Stat label="Comissão do vendedor" value={formatBRL(s.sellerCommissionCents)} hint={s.commission ? ({ PENDENTE: "Pendente", PAGA: "Paga", CANCELADA: "Cancelada" } as Record<string, string>)[s.commission.status] : undefined} />
            {(s.feesCents > 0 || s.discountCents > 0) && <Stat label="Taxas / desconto" value={`${formatBRL(s.feesCents)} / ${formatBRL(s.discountCents)}`} />}
          </Card>

          <Card>
            <CardHeader title="Produtos e reservas" />
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th>Fornecedor</Th>
                  <Th>Modelo</Th>
                  <Th align="right">Valor</Th>
                  {s.permissions.showMargin && <Th align="right">Custo / comissão</Th>}
                  <Th>Reserva</Th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <Td className="min-w-48">
                      <p className="font-medium">{PRODUCT_TYPES.label(i.productType)}</p>
                      {i.description && <p className="text-xs text-muted">{i.description}</p>}
                    </Td>
                    <Td className="min-w-40">{i.supplier ? <Link className="text-brand-700 hover:underline" href={`/fornecedores/${i.supplier.id}`}>{i.supplier.name}</Link> : "—"}</Td>
                    <Td className="text-xs text-slate-600">{COMMERCIAL_MODELS.label(i.commercialModel)}</Td>
                    <Td align="right">{formatBRL(i.priceCents)}</Td>
                    {s.permissions.showMargin && <Td align="right">{i.commercialModel === "COMISSAO" ? `+${formatBRL(i.supplierCommissionCents)}` : formatBRL(i.costCents)}</Td>}
                    <Td>{i.reservation ? <ReservationEditor r={{ id: i.reservation.id, status: i.reservation.status, locator: i.reservation.locator, notes: i.reservation.notes }} readOnly={!s.permissions.canEdit || s.status === "CANCELADA"} /> : <span className="text-xs text-muted">—</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="Parcelas do cliente" description="Contas a receber geradas pela venda" />
            {salesRec.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{s.status === "ORCAMENTO" ? "Serão geradas ao confirmar a venda." : "Sem parcelas."}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Parcela</Th>
                    <Th>Vencimento</Th>
                    <Th>Forma</Th>
                    <Th align="right">Valor</Th>
                    <Th align="right">Recebido</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {salesRec.map((r) => (
                    <tr key={r.id} className={r.status === "CANCELADO" ? "opacity-50" : ""}>
                      <Td>{r.installmentNumber ? `${r.installmentNumber}/${r.installmentCount}` : "—"}</Td>
                      <Td>{formatDate(r.dueDate)}</Td>
                      <Td className="text-slate-600">{PAYMENT_METHODS.label(r.method)}</Td>
                      <Td align="right">{formatBRL(r.amountCents)}</Td>
                      <Td align="right">{formatBRL(r.receivedCents)}</Td>
                      <Td>
                        <EntryStatusBadge s={displayStatus(r.status, r.dueDate, t)} />
                      </Td>
                      <Td align="right">
                        {s.permissions.canFinance && (
                          <Link href={`/financeiro/receber?abrir=${r.id}&q=${encodeURIComponent(s.code)}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                            {can(ctx, "finance.manage") && r.status !== "PAGO" && r.status !== "CANCELADO" ? "Dar baixa" : "Abrir"} <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {s.permissions.canFinance && (s.payables.length > 0 || supplierRec.length > 0) && (
            <Card>
              <CardHeader title="Fornecedores e comissões" description="Contas a pagar e comissões a receber geradas pela venda" />
              <Table>
                <thead>
                  <tr>
                    <Th>Descrição</Th>
                    <Th>Tipo</Th>
                    <Th>Vencimento</Th>
                    <Th align="right">Valor</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {s.payables.map((p) => (
                    <tr key={p.id} className={p.status === "CANCELADO" ? "opacity-50" : ""}>
                      <Td className="max-w-72 truncate">{p.description}</Td>
                      <Td>
                        <Badge tone="red">A pagar · {PAYABLE_CATEGORIES.label(p.category)}</Badge>
                      </Td>
                      <Td>{formatDate(p.dueDate)}</Td>
                      <Td align="right">{formatBRL(p.amountCents)}</Td>
                      <Td>
                        <EntryStatusBadge kind="payable" s={displayStatus(p.status, p.dueDate, t)} />
                      </Td>
                      <Td align="right">
                        <Link href={`/financeiro/pagar?abrir=${p.id}&q=${encodeURIComponent(s.code)}`} className="text-xs font-medium text-brand-600 hover:underline">
                          Abrir
                        </Link>
                      </Td>
                    </tr>
                  ))}
                  {supplierRec.map((r) => (
                    <tr key={r.id} className={r.status === "CANCELADO" ? "opacity-50" : ""}>
                      <Td className="max-w-72 truncate">{r.description}</Td>
                      <Td>
                        <Badge tone="green">A receber · comissão</Badge>
                      </Td>
                      <Td>{formatDate(r.dueDate)}</Td>
                      <Td align="right">{formatBRL(r.amountCents)}</Td>
                      <Td>
                        <EntryStatusBadge s={displayStatus(r.status, r.dueDate, t)} />
                      </Td>
                      <Td align="right">
                        <Link href={`/financeiro/receber?abrir=${r.id}&q=${encodeURIComponent(s.code)}`} className="text-xs font-medium text-brand-600 hover:underline">
                          Abrir
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Cliente" action={<Link href={`/clientes/${s.client.id}`} className="text-xs font-medium text-brand-600 hover:underline">Ver cliente</Link>} />
            <dl className="space-y-2 p-5 text-sm">
              <p className="font-medium">{s.client.name}</p>
              <p className="text-muted">{s.client.document ? formatDocument(s.client.document) : "CPF/CNPJ não informado"}</p>
              <p className="text-muted">{s.client.whatsapp ?? s.client.phone ?? "—"}</p>
              <p className="text-muted">{s.client.email ?? ""}</p>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Viagem" />
            <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
              <Stat label="Início" value={formatDate(s.tripStart)} />
              <Stat label="Retorno" value={formatDate(s.tripEnd)} />
              <Stat label="Passageiros" value={String(s.passengerCount)} />
              <Stat label="Localizador" value={s.locator ?? "—"} />
            </dl>
            {s.passengers.length > 0 && (
              <ul className="border-t border-line px-5 py-3 text-sm">
                {s.passengers.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-1">
                    <span>{p.name}</span>
                    <span className="text-xs text-muted">
                      {maskDocument(p.document)}
                      {p.passportNumber && ` · Pass. ${maskPassport(p.passportNumber)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Contrato" />
            <div className="space-y-3 p-5 text-sm">
              {contract ? (
                <>
                  <div className="flex items-center justify-between">
                    <ContractStatusBadge s={contract.status} />
                    {contract.version > 0 && <span className="text-xs text-muted">versão {contract.version}</span>}
                  </div>
                  {contract.outdated && <p className="text-xs text-amber-700">A venda foi alterada após a emissão. Confira o contrato.</p>}
                  {can(ctx, "contracts.manage") && (
                    <LinkButton href={`/contratos/${contract.id}`} variant="secondary" className="w-full">
                      <FileSignature className="h-4 w-4" /> Abrir contrato
                    </LinkButton>
                  )}
                </>
              ) : s.status === "CONFIRMADA" || s.status === "CONCLUIDA" ? (
                can(ctx, "contracts.manage") ? <PrepareContractButton saleId={s.id} /> : <p className="text-muted">Contrato não gerado.</p>
              ) : (
                <p className="text-muted">Gerado após a confirmação da venda.</p>
              )}
            </div>
          </Card>
          {s.notes && (
            <Card>
              <CardHeader title="Observações" />
              <p className="whitespace-pre-wrap p-5 text-sm text-slate-700">{s.notes}</p>
            </Card>
          )}
          <Card>
            <CardHeader title="Histórico" />
            <ol className="space-y-3 p-5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-brand-100 pl-3">
                  <p className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</p>
                  <p className="text-xs text-muted">
                    {h.user?.name ?? "Sistema"} · {formatDateTime(h.createdAt, ctx.timezone)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
