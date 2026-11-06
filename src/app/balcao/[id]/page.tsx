import Link from "next/link";
import { CheckCircle2, ExternalLink, MessageCircle, Pencil, Plus } from "lucide-react";
import { prisma } from "@/server/db";
import { can } from "@/server/context";
import { orNotFound } from "@/server/page-helpers";
import { saleScope } from "@/server/services/sales";
import { getContract } from "@/server/services/contracts";
import { zapsignConfigured, signatureCostCents } from "@/server/services/zapsign";
import { Card, CardHeader, Notice } from "@/components/ui";
import { ContractStatusBadge, SaleStatusBadge } from "@/components/status";
import { AttachmentsPanel } from "@/components/attachments";
import { ContractActions } from "@/app/(app)/contratos/[id]/contract-actions";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { AppError } from "@/server/errors";
import type { Params } from "@/lib/params";
import { balcaoContext } from "../shared";

/** Etapa 3 da venda rápida: contrato (atualizar, emitir, enviar) e documentos/vouchers da venda. */
export default async function BalcaoVendaFeitaPage({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await balcaoContext(`/balcao/${id}`);
  const sale = await orNotFound(
    prisma.sale.findFirst({
      where: { id, ...saleScope(ctx) },
      include: {
        client: { select: { name: true, whatsapp: true, phone: true, email: true } },
        contracts: { select: { id: true }, orderBy: { createdAt: "desc" }, take: 1 },
        attachments: { orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, kind: true, createdAt: true } },
      },
    }).then((s) => s ?? Promise.reject(new AppError("Venda não encontrada.", "NOT_FOUND"))),
  );
  const contract = sale.contracts[0] && can(ctx, "contracts.manage") ? await getContract(ctx, sale.contracts[0].id) : null;
  const missing = contract ? (JSON.parse(contract.missingFieldsJson) as string[]) : [];
  const draft = sale.status === "ORCAMENTO";
  const phone = (sale.client.whatsapp || sale.client.phone || "").replace(/\D/g, "");
  const wa = phone ? (phone.length <= 11 ? "55" + phone : phone) : null;
  const firstName = sale.client.name.split(/\s+/)[0];

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
              {sale.code} <SaleStatusBadge s={sale.status} />
            </p>
            <p className="text-sm text-muted">
              {sale.client.name} · {sale.destination ?? "sem destino"}
              {sale.tripStart && ` · ${formatDate(sale.tripStart)}`} · <span className="tabular">{formatBRL(sale.grossCents)}</span>
            </p>
          </div>
          <Link href={`/balcao/${sale.id}/editar`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-slate-50">
            <Pencil className="h-4 w-4" /> {draft ? "Continuar e confirmar" : "Ajustar venda"}
          </Link>
          <Link href={`/vendas/${sale.id}`} target="_blank" className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm text-muted hover:bg-slate-100">
            Ver na gestão <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>

      {draft ? (
        <Notice tone="amber" title="Venda em rascunho">
          Para gerar o financeiro e o contrato, abra <strong>Continuar e confirmar</strong>, confira a forma de pagamento e clique em Confirmar venda.
        </Notice>
      ) : !contract ? (
        <Notice title="Venda confirmada">O contrato desta venda é feito por quem tem acesso a contratos na agência.</Notice>
      ) : (
        <Card className="print-area">
          <div className="no-print flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold text-ink">
                Contrato <ContractStatusBadge s={contract.status} />
              </p>
              <p className="text-xs text-muted">
                {contract.status === "ASSINADO"
                  ? "Assinado. O PDF assinado fica nos documentos da venda."
                  : contract.status === "ENVIADO"
                    ? "Enviado para assinatura. O status muda sozinho quando todos assinarem."
                    : contract.status === "AGUARDANDO_ENVIO"
                      ? zapsignConfigured()
                        ? "Emitido. Envie para assinatura online ou salve o PDF."
                        : "Emitido. Salve o PDF e envie ao cliente."
                      : "Confira a prévia e clique em Emitir contrato."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ContractActions
                id={contract.id}
                status={contract.status}
                canIssue={missing.length === 0}
                signature={{ enabled: zapsignConfigured(), provider: contract.signatureProvider, signUrl: contract.signUrl, cost: formatBRL(signatureCostCents()), clientEmail: contract.sale.client.email, clientPhone: contract.sale.client.whatsapp || contract.sale.client.phone }}
              />
              {wa && contract.signUrl && contract.status === "ENVIADO" && (
                <a
                  href={`https://wa.me/${wa}?text=${encodeURIComponent(`Olá ${firstName}! Segue o link para assinar o contrato da sua viagem (${sale.code}): ${contract.signUrl}`)}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <MessageCircle className="h-4 w-4" /> Mandar no WhatsApp
                </a>
              )}
            </div>
          </div>
          {missing.length > 0 && (
            <p className="no-print border-b border-line bg-amber-50 px-5 py-2 text-xs text-amber-900">
              Falta para emitir: {missing.join(", ")}. Complete no cadastro do cliente (etapa 1) ou na venda e clique em “Atualizar prévia”.
            </p>
          )}
          <article className="max-h-[60vh] overflow-auto whitespace-pre-wrap px-8 py-6 font-serif text-[14px] leading-relaxed text-slate-800 print:max-h-none print:overflow-visible">
            {contract.content ?? "Nenhum conteúdo gerado ainda. Clique em “Atualizar prévia”."}
          </article>
        </Card>
      )}

      <Card className="no-print">
        <CardHeader title="Documentos e vouchers" description="Anexe vouchers, bilhetes e comprovantes (imagem ou PDF)" />
        <AttachmentsPanel target={{ kind: "sale", id: sale.id }} items={sale.attachments} canUpload timezone={ctx.timezone} />
      </Card>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        {!draft && (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Venda registrada na gestão: financeiro, comissão e contrato já foram gerados.
          </p>
        )}
        <Link href="/balcao" className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
          <Plus className="h-4 w-4" /> Nova venda
        </Link>
      </div>
    </div>
  );
}
