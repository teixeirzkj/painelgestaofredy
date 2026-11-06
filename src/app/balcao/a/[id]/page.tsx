import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, Download, MessageCircle, Plus, UserRound } from "lucide-react";
import { today } from "@/server/context";
import { AppError } from "@/server/errors";
import { BALCAO_STEPS, DONE_STEP, loadFlow } from "@/server/services/balcao";
import { fredyCardPrefill } from "@/server/services/fredy";
import { getContract } from "@/server/services/contracts";
import { zapsignConfigured, signatureCostCents } from "@/server/services/zapsign";
import { prisma } from "@/server/db";
import { Card, Notice } from "@/components/ui";
import { ContractStatusBadge, SaleStatusBadge } from "@/components/status";
import { AttachmentsPanel } from "@/components/attachments";
import { ContractActions } from "@/app/(app)/contratos/[id]/contract-actions";
import { EditClientButton } from "@/app/(app)/clientes/client-buttons";
import { ClientDocuments } from "@/app/(app)/clientes/[id]/client-documents";
import { SaleForm } from "@/app/(app)/vendas/sale-form";
import { editSaleFormData, newSaleFormData } from "@/app/(app)/vendas/sale-form-data";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatDocument } from "@/lib/utils";
import { str, type Params, type SearchParams } from "@/lib/params";
import { balcaoContext } from "../../shared";
import { BalcaoHeader, StepBox } from "../../header";
import { AttachDraftButton, DiscardFlowButton, FlowMarkButton, PrepareContractButton } from "../../flow-buttons";

const btn = "inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold";

/** Atendimento da venda rápida: mostra só a etapa em que o cliente está (ou uma feita, para rever). */
export default async function BalcaoAtendimentoPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id: flowId } = await params;
  const sp = await searchParams;
  const base = `/balcao/a/${flowId}`;
  const ctx = await balcaoContext(base);
  const d = await loadFlow(ctx, flowId).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const asked = Number(str(sp, "etapa"));
  const view = asked >= 2 && asked < d.current && d.done[asked - 1] ? asked : d.current;
  const { client, sale, contract } = d;
  const reviewing = view !== d.current;
  const goCurrent = (
    <Link href={base} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
      {d.current >= DONE_STEP ? "Voltar ao resumo" : `Ir para a etapa ${d.current}: ${BALCAO_STEPS[d.current - 1]}`} <ArrowRight className="h-4 w-4" />
    </Link>
  );
  const footer = (children: React.ReactNode) => <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4">{children}</div>;

  let body: React.ReactNode;

  if (view === 2) {
    body = (
      <StepBox n={2} title="Cadastrar ou conferir o cliente" steps={["Confira nome, CPF/CNPJ, endereço, WhatsApp e e-mail.", "Se algo estiver errado ou faltando, clique em Editar."]}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-25 text-brand-700">
            <UserRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{client.name}</p>
            <p className="text-sm text-muted">{[client.document && formatDocument(client.document), client.whatsapp || client.phone, client.email].filter(Boolean).join(" · ") || "sem documento e contato"}</p>
            <p className="text-xs text-muted">{[client.street, client.number, client.district, client.city, client.state].filter(Boolean).join(", ") || "sem endereço"}</p>
          </div>
          {!sale && <DiscardFlowButton id={flowId} to="/balcao?etapa=2" label="Trocar cliente" confirmText="Trocar o cliente deste atendimento? O cadastro continua na gestão." />}
          <EditClientButton id={client.id} initial={client} />
        </div>
        {d.missing.length > 0 && <p className="border-t border-line bg-amber-50 px-5 py-2 text-sm text-amber-900">Falta no cadastro: <strong>{d.missing.join(" e ")}</strong>. Clique em Editar e complete: o contrato precisa desses dados.</p>}
        {footer(reviewing ? goCurrent : <FlowMarkButton id={flowId} mark="data" label="Dados conferidos, continuar" disabled={d.missing.length > 0} />)}
      </StepBox>
    );
  } else if (view === 3) {
    body = (
      <StepBox n={3} title="Fotos dos documentos do cliente" optional steps={["Envie ou fotografe RG, CPF, CNH ou passaporte de quem vai viajar, com o número.", "Se o cliente ainda não mandou, pule e anexe depois."]}>
        <ClientDocuments clientId={client.id} docs={client.attachments} canManage todayStr={today(ctx)} />
        {footer(reviewing ? goCurrent : <FlowMarkButton id={flowId} mark="docs" label={client.attachments.length ? "Continuar" : "Pular por enquanto"} variant={client.attachments.length ? "primary" : "outline"} />)}
      </StepBox>
    );
  } else if (view === 4) {
    const steps = [
      "Preencha destino, datas, passageiros, valor de venda, custo e fornecedor.",
      "Escolha a forma de pagamento e gere as parcelas.",
      <>
        Clique em <strong>Confirmar venda</strong>: ela entra no painel de gestão com o financeiro e o contrato.
      </>,
    ];
    if (sale && sale.status !== "ORCAMENTO") {
      body = (
        <StepBox n={4} title="Lançar e confirmar a venda">
          <div className="flex flex-wrap items-center gap-2 px-5 py-4 text-sm">
            <span className="font-semibold text-ink">{sale.code}</span> <SaleStatusBadge s={sale.status} />
            <span className="text-muted">
              {sale.destination ?? "sem destino"}
              {sale.tripStart && ` · ${formatDate(sale.tripStart)}`} · <span className="tabular">{formatBRL(sale.grossCents)}</span>
            </span>
          </div>
          <p className="px-5 pb-4 text-xs text-muted">Venda confirmada e registrada no painel de gestão. Para alterar, peça ao gestor.</p>
          {footer(goCurrent)}
        </StepBox>
      );
    } else if (sale) {
      const { sale: _s, ...form } = await editSaleFormData(ctx, sale.id);
      void _s;
      body = (
        <div className="space-y-4">
          <StepBox n={4} title="Lançar e confirmar a venda" steps={steps}>
            <p className="px-5 py-3 text-sm text-amber-900">
              Esta venda ({sale.code}) está em rascunho{sale.externalRef?.startsWith("fredy:") ? " e veio do card do Frédy" : ""}. Confira e clique em Confirmar venda.
            </p>
          </StepBox>
          <SaleForm {...form} afterSaveHref={base} />
        </div>
      );
    } else {
      // venda nova; se o atendimento veio de um card, os dados do card já entram no formulário
      let prefill: Awaited<ReturnType<typeof fredyCardPrefill>> | null = null;
      if (d.flow.fredyCardId) prefill = await fredyCardPrefill(ctx, d.flow.fredyCardId).catch(() => null);
      const integ = prefill ? await prisma.fredyIntegration.findUnique({ where: { companyId: ctx.companyId }, select: { defaultProductType: true } }) : null;
      const form = await newSaleFormData(ctx, {
        clientId: client.id,
        destination: prefill?.destination,
        tripStart: prefill?.tripStart,
        tripEnd: prefill?.tripEnd && prefill.tripStart && prefill.tripEnd < prefill.tripStart ? null : prefill?.tripEnd,
        passengerCount: prefill?.passengerCount,
        priceCents: prefill?.priceCents,
        description: prefill?.title,
        productType: integ?.defaultProductType,
      });
      body = (
        <div className="space-y-4">
          <StepBox n={4} title="Lançar e confirmar a venda" steps={steps}>
            {d.drafts.length > 0 && (
              <div className="px-5 py-4">
                <Notice tone="amber" title="Este cliente já tem venda em rascunho">
                  <p>Se for esta venda (por exemplo, a que chegou do Frédy quando o card virou ganho), continue por ela em vez de lançar outra.</p>
                  <ul className="mt-2 space-y-2">
                    {d.drafts.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2">
                        <AttachDraftButton flowId={flowId} saleId={s.id} label={`Continuar ${s.code}`} />
                        <span>
                          {s.destination ?? "sem destino"} · <span className="tabular">{formatBRL(s.grossCents)}</span>
                          {s.externalRef?.startsWith("fredy:") && " · veio do Frédy"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Notice>
              </div>
            )}
            {prefill && !prefill.existingSale && <p className="px-5 pb-3 text-xs text-muted">Dados do card “{prefill.title}” já preenchidos. Ao confirmar, o card fica como ganho no Frédy com o valor final.</p>}
          </StepBox>
          {form.initial.client && <SaleForm {...form} fredyCardId={prefill && !prefill.existingSale ? d.flow.fredyCardId : null} balcaoFlowId={flowId} afterSaveHref={base} />}
        </div>
      );
    }
  } else if ((view === 5 || view === 6) && sale) {
    const full = contract ? await getContract(ctx, contract.id) : null;
    const missing = full ? (JSON.parse(full.missingFieldsJson) as string[]) : [];
    const phone = (client.whatsapp || client.phone || "").replace(/\D/g, "");
    const wa = phone ? (phone.length <= 11 ? "55" + phone : phone) : null;
    const firstName = client.name.split(/\s+/)[0];
    const actions = full && (
      <ContractActions
        id={full.id}
        status={full.status}
        canIssue={missing.length === 0}
        signature={{ enabled: zapsignConfigured(), provider: full.signatureProvider, signUrl: full.signUrl, cost: formatBRL(signatureCostCents()), clientEmail: full.sale.client.email, clientPhone: full.sale.client.whatsapp || full.sale.client.phone }}
      />
    );
    if (!d.canContract) {
      body = (
        <StepBox n={view} title={BALCAO_STEPS[view - 1]}>
          <p className="px-5 py-4 text-sm text-muted">Seu usuário não emite contratos. Avise o gestor que a venda {sale.code} foi confirmada.</p>
          {footer(goCurrent)}
        </StepBox>
      );
    } else if (!full) {
      body = (
        <StepBox n={5} title="Emitir o contrato" steps={["O contrato desta venda ainda não foi gerado. Clique em Gerar o contrato."]}>
          {footer(<PrepareContractButton saleId={sale.id} />)}
        </StepBox>
      );
    } else if (view === 5) {
      body = (
        <StepBox
          n={5}
          title="Emitir o contrato"
          steps={[
            <>
              Clique em <strong>Atualizar prévia</strong> e leia o contrato.
            </>,
            <>
              Clique em <strong>Emitir contrato</strong>. Se aparecer “Falta para emitir”, complete o dado que falta (cliente na etapa 2) e atualize a prévia.
            </>,
          ]}
        >
          <div className="print-area">
            <div className="no-print flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
              <p className="flex flex-1 items-center gap-2 text-sm font-semibold text-ink">
                Contrato da venda {sale.code} <ContractStatusBadge s={full.status} />
              </p>
              <div className="flex flex-wrap gap-2">{actions}</div>
            </div>
            {missing.length > 0 && <p className="no-print border-b border-line bg-amber-50 px-5 py-2 text-xs text-amber-900">Falta para emitir: {missing.join(", ")}.</p>}
            <article className="max-h-[55vh] overflow-auto whitespace-pre-wrap px-8 py-6 font-serif text-[14px] leading-relaxed text-slate-800 print:max-h-none print:overflow-visible">
              {full.content ?? "Nenhum conteúdo gerado ainda. Clique em “Atualizar prévia”."}
            </article>
          </div>
          {reviewing && footer(goCurrent)}
        </StepBox>
      );
    } else {
      const sentAuto = full.status === "ENVIADO" || full.status === "ASSINADO";
      body = (
        <StepBox
          n={6}
          title="Enviar o contrato ao cliente"
          steps={[
            <>
              Clique em <strong>Baixar contrato (PDF)</strong>.
            </>,
            <>
              Clique em <strong>Abrir o WhatsApp do cliente</strong> e anexe o PDF baixado na conversa.
            </>,
            "Depois de enviar, clique em Enviei ao cliente.",
          ]}
        >
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <a href={`/api/contratos/${full.id}/pdf`} download className={`${btn} border border-line bg-white text-ink hover:bg-slate-50`}>
              <Download className="h-4 w-4" /> Baixar contrato (PDF)
            </a>
            {wa && (
              <a
                href={`https://wa.me/${wa}?text=${encodeURIComponent(
                  full.signUrl && full.status === "ENVIADO"
                    ? `Olá ${firstName}! Segue o link para assinar o contrato da sua viagem (${sale.code}): ${full.signUrl}`
                    : `Olá ${firstName}! Segue o contrato da sua viagem (${sale.code}). Qualquer dúvida, estou à disposição.`,
                )}`}
                target="_blank"
                rel="noopener"
                className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
              >
                <MessageCircle className="h-4 w-4" /> Abrir o WhatsApp do cliente
              </a>
            )}
            {zapsignConfigured() && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
          {!wa && <p className="px-5 pb-3 text-xs text-amber-800">O cliente está sem WhatsApp no cadastro. Envie o PDF pelo canal que ele usa.</p>}
          {footer(reviewing || sentAuto ? goCurrent : <FlowMarkButton id={flowId} mark="sent" label="Enviei ao cliente, continuar" />)}
        </StepBox>
      );
    }
  } else if (view === 7 && sale) {
    body = (
      <StepBox n={7} title="Vouchers e comprovantes" optional steps={["Anexe vouchers, bilhetes e comprovantes da viagem (imagem ou PDF). Dá para arrastar ou colar a imagem.", "Clique em Concluir atendimento."]}>
        <AttachmentsPanel target={{ kind: "sale", id: sale.id }} items={sale.attachments} canUpload timezone={ctx.timezone} />
        {footer(reviewing ? goCurrent : <FlowMarkButton id={flowId} mark="finish" label="Concluir atendimento" />)}
      </StepBox>
    );
  } else {
    body = (
      <Card>
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <h1 className="font-display text-xl font-semibold text-ink">Atendimento concluído</h1>
          <p className="text-sm text-muted">
            {client.name}
            {sale && ` · venda ${sale.code} · ${formatBRL(sale.grossCents)}`}
            {contract && " · contrato "}
            {contract && <ContractStatusBadge s={contract.status} />}
          </p>
          <p className="max-w-md text-xs text-muted">Cliente, documentos, venda, contrato e vouchers ficaram registrados no painel de gestão.</p>
          <Link href="/balcao" className={`${btn} mt-2 bg-brand-600 text-white hover:bg-brand-700`}>
            <Plus className="h-4 w-4" /> Novo atendimento
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <>
      <BalcaoHeader ctx={ctx} view={Math.min(view, BALCAO_STEPS.length + 1)} done={d.done} baseHref={base} />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        {reviewing && (
          <Notice title={`Revendo a etapa ${view}`}>
            O atendimento está na etapa {d.current >= DONE_STEP ? "final" : `${d.current}: ${BALCAO_STEPS[d.current - 1]}`}.{" "}
            <Link href={base} className="font-medium underline">
              Voltar para ela
            </Link>
          </Notice>
        )}
        {body}
      </main>
    </>
  );
}

