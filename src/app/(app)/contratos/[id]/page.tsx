import Link from "next/link";
import { orNotFound } from "@/server/page-helpers";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { contractNeverSent, getContract } from "@/server/services/contracts";
import { Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { ContractStatusBadge } from "@/components/status";
import { formatDateTime } from "@/lib/dates";
import type { Params } from "@/lib/params";
import { ContractActions } from "./contract-actions";
import { zapsignConfigured, signatureCostCents } from "@/server/services/zapsign";
import { formatBRL } from "@/lib/money";

export const metadata = { title: "Contrato" };

export default async function ContractPage({ params }: { params: Params }) {
  const ctx = await requirePageContext("contracts.manage");
  const { id } = await params;
  const c = await orNotFound(getContract(ctx, id));
  const missing = JSON.parse(c.missingFieldsJson) as string[];
  const isTrip = !!c.tripId && !!c.trip;
  // contrato ainda não enviado: "Atualizar prévia" refaz o texto e libera a nova emissão
  const canRefreshOutdated = c.status === "AGUARDANDO_ENVIO" || c.status === "EM_PREPARACAO" || c.status === "NAO_GERADO";
  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ href: "/contratos", label: "Contratos" }}
          title={
            <span className="flex items-center gap-2">
              {isTrip ? `Contrato da viagem ${c.trip!.code}` : `Contrato ${c.sale.code}`} <ContractStatusBadge s={c.status} />
            </span>
          }
          description={
            <>
              {c.sale.client.name} ·{" "}
              {isTrip ? (
                <>
                  <Link href={`/viagens/${c.tripId}`} className="text-brand-600 hover:underline">
                    ver viagem
                  </Link>
                  {c.tripSales.included.length > 0 && <> · vendas: {c.tripSales.included.map((s) => s.code).join(", ")}</>}
                </>
              ) : (
                <Link href={`/vendas/${c.saleId}`} className="text-brand-600 hover:underline">
                  ver venda
                </Link>
              )}
              {c.template && ` · modelo “${c.template.name}” v${c.templateVersion}`}
              {c.issuedAt && ` · versão ${c.version} emitida em ${formatDateTime(c.issuedAt, ctx.timezone)}`}
            </>
          }
          actions={
            <ContractActions
              id={c.id}
              status={c.status}
              canIssue={missing.length === 0}
              canSplit={isTrip && contractNeverSent(c) && (can(ctx, "sales.view_all") || c.tripSales.included.every((s) => s.sellerId === ctx.userId))}
              signature={{ enabled: zapsignConfigured(), provider: c.signatureProvider, signUrl: c.signUrl, cost: formatBRL(signatureCostCents()), clientEmail: c.sale.client.email, clientPhone: c.sale.client.whatsapp || c.sale.client.phone }}
            />
          }
        />
        <div className="mb-4 space-y-3">
          {missing.length > 0 && (
            <Notice tone="amber" title="Dados obrigatórios pendentes">
              {missing.includes("Modelo de contrato para o produto") ? (
                <>
                  A agência ainda não tem modelo de contrato para este produto.{" "}
                  <Link href="/contratos/modelos" className="font-medium underline">
                    Cadastre ou carregue os modelos sugeridos
                  </Link>{" "}
                  e depois clique em “Atualizar prévia”.
                </>
              ) : (
                <>Complete no cadastro do cliente ou na venda e clique em “Atualizar prévia”: {missing.join(", ")}.</>
              )}
            </Notice>
          )}
          {c.outdated &&
            (isTrip ? (
              <Notice tone="amber" title="Uma venda da viagem foi alterada, incluída ou retirada depois da emissão">
                {canRefreshOutdated
                  ? "Clique em “Atualizar prévia” e emita o contrato de novo. Até lá, vale o texto emitido."
                  : "O texto emitido foi guardado. Se precisar, cancele e reabra o contrato para emitir uma versão nova."}
              </Notice>
            ) : (
              <Notice tone="amber" title="A venda foi alterada depois da emissão">
                {canRefreshOutdated
                  ? "Clique em “Atualizar prévia” e emita o contrato de novo. Até lá, vale o texto emitido."
                  : "O conteúdo emitido foi preservado. Se necessário, cancele e reabra o contrato para emitir uma nova versão."}
              </Notice>
            ))}
          {isTrip && c.tripSales.outside.length > 0 && (
            <Notice title="Contrato da viagem">
              Ficaram de fora porque já tinham contrato enviado ao cliente: {c.tripSales.outside.map((s) => s.code).join(", ")}.
            </Notice>
          )}
          {c.status === "ENVIADO" && (
            <Notice title="Aguardando assinatura">
              Enviado{c.sentAt ? ` em ${formatDateTime(c.sentAt, ctx.timezone)}` : ""}{c.signatureProvider ? ` pela ${c.signatureProvider === "ZAPSIGN" ? "ZapSign" : c.signatureProvider}` : ""}. O status muda para assinado automaticamente quando todos assinarem.
            </Notice>
          )}
          {c.status === "ASSINADO" && (
            <Notice title="Contrato assinado">
              Assinado{c.signedAt ? ` em ${formatDateTime(c.signedAt, ctx.timezone)}` : ""}. {isTrip ? "O PDF assinado fica nos documentos da viagem." : "O PDF assinado fica nos anexos da venda."}
            </Notice>
          )}
          {c.status === "AGUARDANDO_ENVIO" && (
            <Notice title="Contrato emitido">
              {zapsignConfigured()
                ? "Envie para assinatura online pela ZapSign ou use “Imprimir / salvar PDF”. O contrato só fica como assinado quando a ZapSign confirmar."
                : "Use “Imprimir / salvar PDF” para gerar o arquivo. A assinatura online fica disponível quando a ZapSign for configurada na plataforma."}
            </Notice>
          )}
        </div>
      </div>
      <Card className="print-area mx-auto max-w-3xl">
        <CardHeader className="no-print" title={c.status === "EM_PREPARACAO" || c.status === "NAO_GERADO" ? "Prévia para conferência" : `Versão ${c.version}`} />
        <article className="whitespace-pre-wrap px-8 py-8 font-serif text-[14px] leading-relaxed text-slate-800 sm:px-12">
          {c.content ?? "Nenhum conteúdo gerado ainda. Cadastre um modelo de contrato para este tipo de produto e clique em “Atualizar prévia”."}
        </article>
      </Card>
    </>
  );
}
