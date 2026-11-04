import Link from "next/link";
import { orNotFound } from "@/server/page-helpers";
import { requirePageContext } from "@/server/auth";
import { getContract } from "@/server/services/contracts";
import { Card, CardHeader, Notice, PageHeader } from "@/components/ui";
import { ContractStatusBadge } from "@/components/status";
import { formatDateTime } from "@/lib/dates";
import type { Params } from "@/lib/params";
import { ContractActions } from "./contract-actions";

export const metadata = { title: "Contrato" };

export default async function ContractPage({ params }: { params: Params }) {
  const ctx = await requirePageContext("contracts.manage");
  const { id } = await params;
  const c = await orNotFound(getContract(ctx, id));
  const missing = JSON.parse(c.missingFieldsJson) as string[];
  return (
    <>
      <div className="no-print">
        <PageHeader
          back={{ href: "/contratos", label: "Contratos" }}
          title={
            <span className="flex items-center gap-2">
              Contrato {c.sale.code} <ContractStatusBadge s={c.status} />
            </span>
          }
          description={
            <>
              {c.sale.client.name} · <Link href={`/vendas/${c.saleId}`} className="text-brand-600 hover:underline">ver venda</Link>
              {c.template && ` · modelo “${c.template.name}” v${c.templateVersion}`}
              {c.issuedAt && ` · versão ${c.version} emitida em ${formatDateTime(c.issuedAt, ctx.timezone)}`}
            </>
          }
          actions={<ContractActions id={c.id} status={c.status} canIssue={missing.length === 0} />}
        />
        <div className="mb-4 space-y-3">
          {missing.length > 0 && (
            <Notice tone="amber" title="Dados obrigatórios pendentes">
              Complete no cadastro do cliente ou na venda e clique em “Atualizar prévia”: {missing.join(", ")}.
            </Notice>
          )}
          {c.outdated && (
            <Notice tone="amber" title="A venda foi alterada depois da emissão">
              O conteúdo emitido foi preservado. Se necessário, cancele e reabra o contrato para emitir uma nova versão.
            </Notice>
          )}
          {c.status === "AGUARDANDO_ENVIO" && (
            <Notice title="Contrato emitido">
              Use “Imprimir / salvar PDF” para gerar o arquivo. O envio para assinatura eletrônica ficará disponível quando um provedor for configurado.
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
