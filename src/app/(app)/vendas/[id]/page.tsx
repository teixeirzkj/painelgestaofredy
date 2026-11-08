import Link from "next/link";
import { orNotFound } from "@/server/page-helpers";
import { FileSignature, ExternalLink, Package, Users, Wallet, Building2, History, Paperclip, Plane, UserRound, Check, CircleDashed, Bus, Webhook, ShieldCheck } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { getSale, getSaleAudit } from "@/server/services/sales";
import { contractNeverSent, effectiveContract } from "@/server/services/contracts";
import { supplierOptions } from "@/server/services/registry";
import { Card, CardHeader, DataList, LinkButton, Notice, PageHeader, Table, Td, Th, Badge } from "@/components/ui";
import { ContractStatusBadge, EntryStatusBadge, FinancialStatusBadge, SaleStatusBadge } from "@/components/status";
import { AttachmentsPanel } from "@/components/attachments";
import { formatBRL, formatPercentBps, sum } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { COMMERCIAL_MODELS, PAYABLE_CATEGORIES, PAYMENT_METHODS, PRODUCT_TYPES, RECEIVABLE_CATEGORIES } from "@/lib/constants";
import { displayStatus } from "@/lib/finance";
import { maskDocument, maskPassport, cn } from "@/lib/utils";
import { clientDocHint, hasClientDocument, missingDocLabel } from "@/lib/client-identity";
import type { Params } from "@/lib/params";
import { SaleHeaderActions } from "../sale-actions";
import { ReservationEditor } from "./reservation-editor";
import { PrepareContractButton } from "./prepare-contract";
import { RefundButton, TripLink } from "./sale-extras";
import { RequestEditButton } from "../../solicitacoes/review-client";
import { NewCreditButton } from "../../creditos/credit-client";

export const metadata = { title: "Venda" };

const ACTION_LABEL: Record<string, string> = {
  "venda.criada_confirmada": "Venda criada e confirmada",
  "venda.criada_rascunho": "Rascunho criado",
  "venda.confirmada": "Venda confirmada",
  "venda.alterada": "Venda alterada",
  "venda.cancelada": "Venda cancelada",
  "venda.ajuste_registrado": "Reembolso/multa registrado",
  "venda.fornecedor_pago_cartao": "Fornecedor pago com o cartão da agência",
  "venda.fornecedor_cartao_estornado": "Compra no cartão da agência estornada",
  "venda.fornecedor_cartao_pendente": "Compra no cartão não lançada (fatura já paga)",
  "viagem.venda_vinculada": "Vinculada a uma viagem",
  "viagem.venda_desvinculada": "Desvinculada da viagem",
  "orcamento.recebido_api": "Orçamento recebido por integração",
};

/** "Fornecedor: ..." de cada produto, em palavras simples. */
function supplierPaymentText(i: {
  supplierPayment: string;
  supplierPayMethod: string | null;
  supplierCardInstallments: number;
  supplierCardStartInstallment: number;
  supplierCardAccount: { name: string } | null;
}) {
  switch (i.supplierPayment) {
    case "CLIENTE_DIRETO":
      return "pago pelo cliente direto";
    case "CARTAO_AGENCIA": {
      const start = i.supplierCardStartInstallment > 1 ? ` (a partir da ${i.supplierCardStartInstallment}ª)` : "";
      const parts = i.supplierCardInstallments > 1 ? ` · ${i.supplierCardInstallments}x${start}` : "";
      return `pago no cartão ${i.supplierCardAccount?.name ?? "da agência (cartão não escolhido)"}${parts}`;
    }
    case "A_VISTA":
      return `pago à vista${i.supplierPayMethod ? ` · ${PAYMENT_METHODS.label(i.supplierPayMethod)}` : ""}`;
    default:
      return "faturado (a agência paga no vencimento)";
  }
}

export default async function SalePage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const [s, history, suppliers] = await orNotFound(Promise.all([getSale(ctx, id), getSaleAudit(ctx, id), can(ctx, "finance.manage") ? supplierOptions(ctx) : Promise.resolve([])]));
  const t = today(ctx);
  // contrato que vale para a venda: o próprio ou o contrato da viagem
  const contract = effectiveContract(s);
  const tripContract = contract?.tripId && s.trip ? s.trip : null;
  const otherTripSales = s.trip ? s.trip.sales.filter((x) => x.id !== s.id) : [];
  // incluída no contrato da viagem depois da emissão: entra no texto quando a prévia for atualizada
  const tripPending = !!tripContract && !(JSON.parse(contract!.saleIdsJson) as string[]).includes(s.id);
  const tripCompanions = tripContract ? otherTripSales.filter((x) => x.contracts.every((c) => c.id === contract!.id)).map((x) => x.code) : [];
  const salesRec = s.receivables.filter((r) => r.origin === "VENDA");
  const otherRec = s.receivables.filter((r) => r.origin !== "VENDA");
  const confirmed = s.status === "CONFIRMADA" || s.status === "CONCLUIDA";
  // venda conferida: só o financeiro edita direto; os demais pedem a edição
  const editLocked = !!s.reviewedAt && !can(ctx, "finance.manage");
  const activeRec = salesRec.filter((r) => r.status !== "CANCELADO");
  const received = sum(activeRec.map((r) => r.settledCents));
  const toReceive = sum(activeRec.map((r) => r.amountCents));
  const paxNamed = s.passengers.length;
  const missing = [
    !s.destination && "destino",
    !s.tripStart && "data da viagem",
    !s.locator && !s.items.some((i) => i.locator) && "localizador",
    !hasClientDocument(s.client) && `${missingDocLabel(s.client)} do cliente`,
    paxNamed < s.passengerCount && `${s.passengerCount - paxNamed} passageiro(s) sem nome`,
  ].filter(Boolean) as string[];
  const ravDu = sum(s.items.map((i) => i.ravCents + i.duCents));
  const payersDiffer = activeRec.some((r) => r.clientId && r.clientId !== s.clientId);

  // Jornada: atendimento → orçamento → venda → financeiro → contrato → pré-viagem → pós-venda
  const steps = [
    { label: "Orçamento", done: true, detail: s.origin === "API" ? "via integração" : "registrado" },
    { label: "Venda", done: confirmed, detail: confirmed ? "confirmada" : s.status === "CANCELADA" ? "cancelada" : "rascunho" },
    { label: "Financeiro", done: confirmed && toReceive > 0 && received >= toReceive, detail: confirmed ? (toReceive ? `${formatBRL(received)} de ${formatBRL(toReceive)}` : "sem cobrança") : "após confirmar" },
    { label: "Contrato", done: contract?.status === "ASSINADO", detail: tripPending ? "falta incluir" : contract ? (contract.status === "ASSINADO" ? "assinado" : contract.status === "AGUARDANDO_ENVIO" ? "emitido" : contract.status === "EM_PREPARACAO" ? "em preparação" : contract.status === "NAO_GERADO" ? "sem modelo" : contract.status.toLowerCase()) : "após confirmar" },
    { label: "Pré-viagem", done: !!s.tripStart && s.tripStart <= t, detail: s.tripStart ? (missing.length ? `${missing.length} pendência(s)` : `embarque ${formatDate(s.tripStart)}`) : "sem data" },
    { label: "Pós-venda", done: !!s.tripEnd && s.tripEnd < t, detail: s.tripEnd ? (s.tripEnd < t ? "viagem concluída" : `retorno ${formatDate(s.tripEnd)}`) : "—" },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/vendas", label: "Vendas" }}
        title={s.code}
        description={
          <>
            <Link href={`/clientes/${s.client.id}`} className="font-medium text-ink hover:text-brand-700">
              {s.client.name}
            </Link>{" "}
            · {s.destination ?? "destino não informado"} · vendida em {formatDate(s.saleDate)} por {s.seller.name}
          </>
        }
        meta={
          <>
            <SaleStatusBadge s={s.status} />
            <FinancialStatusBadge s={s.financialStatus} />
            {s.trip && (
              <Link href={`/viagens/${s.trip.id}`}>
                <Badge tone="violet">
                  <Plane className="h-3 w-3" /> {s.trip.code}
                </Badge>
              </Link>
            )}
            {s.excursion && (
              <Link href={`/excursoes/${s.excursion.id}`}>
                <Badge tone="violet">
                  <Bus className="h-3 w-3" /> {s.excursion.code}
                </Badge>
              </Link>
            )}
            {s.origin === "API" && (
              <Badge tone="gray">
                <Webhook className="h-3 w-3" /> recebida por integração
              </Badge>
            )}
            {s.reviewedAt && (
              <Badge tone="green">
                <ShieldCheck className="h-3 w-3" /> Conferida pelo financeiro
              </Badge>
            )}
          </>
        }
        actions={
          <>
            {can(ctx, "finance.manage") && s.status !== "ORCAMENTO" && <RefundButton saleId={s.id} suppliers={suppliers} today={t} />}
            {s.status === "CANCELADA" && can(ctx, "sales.create") && (
              <NewCreditButton variant="outline" label="Gerar crédito ao cliente" fixedClient={{ id: s.client.id, name: s.client.name }} originSaleId={s.id} defaultAmount={sum(salesRec.map((r) => r.settledCents))} />
            )}
            {editLocked && s.permissions.canEdit && s.status !== "CANCELADA" && <RequestEditButton saleId={s.id} />}
            <SaleHeaderActions id={s.id} code={s.code} status={s.status} canEdit={s.permissions.canEdit && !editLocked} canCancel={s.permissions.canCancel} canCreate={can(ctx, "sales.create")} hasAgencyCard={s.items.some((i) => i.cardBills !== null)} />
          </>
        }
      />

      {s.status === "CANCELADA" && (
        <Notice tone="red" title="Venda cancelada" className="mb-6">
          {s.cancelReason} {s.cancelledAt && `· em ${formatDateTime(s.cancelledAt, ctx.timezone)}`}. Valores já recebidos ou pagos foram preservados; registre reembolsos e multas pelo botão “Reembolso ou multa”.
        </Notice>
      )}
      {s.status === "ORCAMENTO" && (
        <Notice title="Rascunho" className="mb-6">
          Esta venda ainda não foi confirmada: nenhum lançamento financeiro, comissão ou contrato foi gerado.
        </Notice>
      )}

      <Card className="mb-6 overflow-x-auto">
        <ol className="flex min-w-[720px] items-stretch">
          {steps.map((st, i) => (
            <li key={st.label} className={cn("relative flex flex-1 items-center gap-3 px-4 py-3.5", i > 0 && "border-l border-line")}>
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", st.done ? "bg-green-50 text-green-600" : "bg-slate-100 text-slate-400")}>
                {st.done ? <Check className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{st.label}</span>
                <span className="block truncate text-xs text-muted">{st.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {confirmed && missing.length > 0 && (
        <Notice tone="amber" title="Etapas que precisam de informação" className="mb-6">
          Complete para seguir com contrato e pré-viagem: {missing.join(", ")}.
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Dados da venda" icon={Wallet} />
            <div className="p-5">
              <DataList
                columns={3}
                items={[
                  { label: "Total vendido", value: <span className="font-display text-lg font-semibold">{formatBRL(s.grossCents)}</span> },
                  { label: "A receber pela agência", value: formatBRL(s.clientPayableCents) },
                  ...(s.permissions.showMargin
                    ? [
                        { label: "Receita da agência", value: formatBRL(s.agencyRevenueCents) },
                        { label: "Repasse a fornecedores", value: formatBRL(s.costCents) },
                        {
                          label: "Lucro bruto",
                          value: (
                            <span className={(s.grossProfitCents ?? 0) < 0 ? "font-semibold text-danger" : "font-semibold text-success"}>
                              {formatBRL(s.grossProfitCents)} <span className="text-xs font-normal text-muted">· {formatPercentBps(s.marginBps ?? 0)}</span>
                            </span>
                          ),
                        },
                      ]
                    : []),
                  { label: "Comissão do vendedor", value: `${formatBRL(s.sellerCommissionCents)}${s.commission ? ` · ${({ PENDENTE: "pendente", PAGA: "paga", CANCELADA: "cancelada" } as Record<string, string>)[s.commission.status]}` : ""}` },
                  ...(s.intermediary ? [{ label: "Intermediário", value: `${s.intermediary.name}${s.intermediaryCommissionCents !== null ? ` · ${formatBRL(s.intermediaryCommissionCents)}` : ""}` }] : []),
                  ...(ravDu > 0 ? [{ label: "Taxas RAV/DU", value: formatBRL(ravDu) }] : []),
                  ...(s.feesCents > 0 ? [{ label: "Taxa de serviço", value: formatBRL(s.feesCents) }] : []),
                  ...(s.discountCents > 0 ? [{ label: "Desconto", value: formatBRL(s.discountCents) }] : []),
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Produtos e reservas" icon={Package} description={`${s.items.length} produto(s)`} />
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th>Fornecedor / operadora</Th>
                  <Th align="right">Cobrado</Th>
                  {s.permissions.showMargin && <Th align="right">Custo / comissão</Th>}
                  <Th>Reserva</Th>
                </tr>
              </thead>
              <tbody>
                {s.items.map((i) => (
                  <tr key={i.id}>
                    <Td className="min-w-48">
                      <p className="font-medium text-ink">{PRODUCT_TYPES.label(i.productType)}</p>
                      {i.description && <p className="text-xs text-muted">{i.description}</p>}
                      <p className="mt-0.5 text-[11px] text-subtle">Fornecedor: {supplierPaymentText(i)}</p>
                      {i.commercialModel !== "COMISSAO" && <p className="text-[11px] text-subtle">Receita: {COMMERCIAL_MODELS.label(i.commercialModel)}</p>}
                      {i.supplierPayment === "CARTAO_AGENCIA" && s.status === "CANCELADA" &&
                        (i.cardBills && i.cardBills.length > 0 ? (
                          <p className="mt-0.5 text-[11px] text-amber-700">Venda cancelada, mas a compra continua no cartão. Na fatura: {i.cardBills.join(", ")}</p>
                        ) : i.cardReversedOnCancel ? (
                          <p className="mt-0.5 text-[11px] text-muted">Compra tirada do cartão no cancelamento da venda.</p>
                        ) : null)}
                      {i.supplierPayment === "CARTAO_AGENCIA" && confirmed && s.status !== "CANCELADA" &&
                        (i.cardBills ? (
                          i.cardBills.length > 0 && <p className="text-[11px] text-muted">Na fatura: {i.cardBills.join(", ")}</p>
                        ) : (
                          <p className="mt-0.5 text-[11px] text-amber-700">Ainda não lançado no cartão: o financeiro registra o pagamento com o cartão.</p>
                        ))}
                    </Td>
                    <Td className="min-w-40">
                      {i.supplier ? (
                        <Link className="text-brand-700 hover:underline" href={`/fornecedores/${i.supplier.id}`}>
                          {i.supplier.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {i.operator && <p className="text-xs text-muted">via {i.operator.name}</p>}
                    </Td>
                    <Td align="right">
                      {formatBRL(i.priceCents + i.ravCents + i.duCents)}
                      {i.ravCents + i.duCents > 0 && <p className="text-[11px] text-muted">inclui RAV/DU {formatBRL(i.ravCents + i.duCents)}</p>}
                    </Td>
                    {s.permissions.showMargin && (
                      <Td align="right">
                        {i.commercialModel === "COMISSAO" ? `+${formatBRL(i.supplierCommissionCents)}` : formatBRL(i.costCents)}
                        {(i.overCents ?? 0) > 0 && <p className="text-[11px] text-success">over +{formatBRL(i.overCents)}</p>}
                        {(i.cardFeeCents ?? 0) > 0 && <p className="text-[11px] text-danger">taxa CC −{formatBRL(i.cardFeeCents)}</p>}
                      </Td>
                    )}
                    <Td>
                      {i.reservation ? (
                        <div>
                          <ReservationEditor r={{ id: i.reservation.id, status: i.reservation.status, locator: i.reservation.locator, notes: i.reservation.notes }} readOnly={!s.permissions.canEdit || s.status === "CANCELADA"} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted">após confirmar</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="Financeiro do cliente" icon={Wallet} description={payersDiffer ? "Parcelas a receber · há pagantes diferentes do cliente" : "Parcelas a receber geradas pela venda"} />
            {salesRec.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{s.status === "ORCAMENTO" ? "Serão geradas ao confirmar a venda." : "Sem parcelas."}</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Parcela</Th>
                    <Th>Vencimento</Th>
                    <Th>Pagante</Th>
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
                      <Td className="max-w-40 truncate text-slate-600">{r.client?.id === s.clientId ? "Cliente" : r.client?.name ?? "—"}</Td>
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

          {s.permissions.canFinance && (s.payables.length > 0 || otherRec.length > 0) && (
            <Card>
              <CardHeader title="Fornecedores, comissões e ajustes" icon={Building2} description="Contas a pagar e valores a receber de fornecedores gerados pela venda" />
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
                      <Td className="max-w-72">
                        <span className="block truncate">{p.description}</span>
                        {p.invoice && (
                          <Link href={`/financeiro/faturas/${p.invoice.id}`} className="text-[11px] text-brand-600 hover:underline">
                            na fatura {p.invoice.number}
                          </Link>
                        )}
                      </Td>
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
                  {otherRec.map((r) => (
                    <tr key={r.id} className={r.status === "CANCELADO" ? "opacity-50" : ""}>
                      <Td className="max-w-72 truncate">{r.description}</Td>
                      <Td>
                        <Badge tone="green">A receber · {RECEIVABLE_CATEGORIES.label(r.category)}</Badge>
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

          <Card>
            <CardHeader title="Documentos e vouchers" icon={Paperclip} description="Vouchers, bilhetes, documentos de viagem e comprovantes desta venda" />
            <AttachmentsPanel target={{ kind: "sale", id: s.id }} items={s.attachments} canUpload={s.permissions.canEdit && s.status !== "ORCAMENTO"} timezone={ctx.timezone} emptyText={s.status === "ORCAMENTO" ? "Disponível após confirmar a venda." : "Nenhum documento anexado."} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Cliente" icon={UserRound} action={<Link href={`/clientes/${s.client.id}`} className="text-xs font-medium text-brand-600 hover:underline">Ver cadastro</Link>} />
            <div className="space-y-1 p-5 text-sm">
              <p className="font-semibold text-ink">{s.client.name}</p>
              <p className="text-muted">{clientDocHint(s.client) ?? "Documento não informado"}</p>
              <p className="text-muted">{s.client.whatsapp ?? s.client.phone ?? "—"}</p>
              {s.client.email && <p className="text-muted">{s.client.email}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Viagem" icon={Plane} />
            <div className="space-y-4 p-5">
              <DataList
                items={[
                  { label: "Início", value: formatDate(s.tripStart) },
                  { label: "Retorno", value: formatDate(s.tripEnd) },
                  { label: "Passageiros", value: String(s.passengerCount) },
                  { label: "Localizador", value: s.locator ?? "—" },
                ]}
              />
              <TripLink saleId={s.id} clientId={s.clientId} trip={s.trip} canEdit={s.permissions.canEdit && s.status !== "CANCELADA"} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Passageiros" icon={Users} description={`${paxNamed} de ${s.passengerCount} informado(s)`} />
            {s.passengers.length === 0 ? (
              <p className="px-5 py-5 text-sm text-muted">Nenhum passageiro informado.</p>
            ) : (
              <ul className="divide-y divide-line">
                {s.passengers.map((p) => (
                  <li key={p.id} className="px-5 py-2.5 text-sm">
                    <p className="font-medium text-ink">
                      {p.client ? (
                        <Link href={`/clientes/${p.client.id}`} className="hover:text-brand-700">
                          {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {maskDocument(p.document) || "sem documento"}
                      {p.passportNumber && ` · Pass. ${maskPassport(p.passportNumber)}`}
                      {p.room && ` · quarto ${p.room}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Contrato" icon={FileSignature} />
            <div className="space-y-3 p-5 text-sm">
              {contract ? (
                <>
                  <div className="flex items-center justify-between">
                    <ContractStatusBadge s={contract.status} />
                    {contract.version > 0 && <span className="text-xs text-muted">versão {contract.version}</span>}
                  </div>
                  {tripContract && tripPending && (
                    <p className="text-slate-700">
                      Esta venda vai entrar no contrato da viagem{" "}
                      <Link href={`/viagens/${tripContract.id}`} className="font-medium text-brand-700 hover:underline">
                        {tripContract.code}
                      </Link>{" "}
                      quando a prévia for atualizada: o texto emitido ainda não a inclui.
                    </p>
                  )}
                  {tripContract && !tripPending && (
                    <p className="text-slate-700">
                      Esta venda faz parte do contrato da viagem{" "}
                      <Link href={`/viagens/${tripContract.id}`} className="font-medium text-brand-700 hover:underline">
                        {tripContract.code}
                      </Link>
                      {tripCompanions.length > 0 ? `, junto com ${tripCompanions.join(", ")}.` : "."}
                    </p>
                  )}
                  {contract.outdated && (
                    <p className="text-xs text-amber-700">
                      {tripContract ? "Uma venda da viagem foi alterada, incluída ou retirada depois da emissão. Confira o contrato." : "A venda foi alterada após a emissão. Confira o contrato."}
                    </p>
                  )}
                  {can(ctx, "contracts.manage") && (
                    <LinkButton href={`/contratos/${contract.id}`} variant="secondary" className="w-full">
                      <FileSignature className="h-4 w-4" /> {tripContract ? "Abrir contrato da viagem" : "Abrir contrato"}
                    </LinkButton>
                  )}
                </>
              ) : confirmed ? (
                can(ctx, "contracts.manage") ? <PrepareContractButton saleId={s.id} /> : <p className="text-muted">Contrato não gerado.</p>
              ) : (
                <p className="text-muted">Gerado após a confirmação da venda.</p>
              )}
              {confirmed && s.trip && !s.trip.contracts[0] && otherTripSales.length > 0 && (!s.contracts[0] || contractNeverSent(s.contracts[0])) && can(ctx, "contracts.manage") && (
                <div className="rounded-lg bg-brand-25 p-3 text-xs text-slate-700">
                  Esta venda está na viagem {s.trip.code} com outras vendas. Você pode juntar todas em um contrato só.{" "}
                  <Link href={`/viagens/${s.trip.id}`} className="font-medium text-brand-700 hover:underline">
                    Ir para a viagem
                  </Link>
                </div>
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
            <CardHeader title="Histórico" icon={History} />
            <ol className="space-y-3 p-5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="relative border-l-2 border-brand-100 pl-3">
                  <p className="font-medium text-ink">{ACTION_LABEL[h.action] ?? h.action}</p>
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
