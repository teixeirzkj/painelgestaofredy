import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Download, MessageCircle, UserRound } from "lucide-react";
import { today } from "@/server/context";
import { AppError } from "@/server/errors";
import { BALCAO_STEPS, DONE_STEP, loadFlow } from "@/server/services/balcao";
import { fredyCardPrefill, fredyConnected } from "@/server/services/fredy";
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
import { clientDocHint } from "@/lib/client-identity";
import { str, type Params, type SearchParams } from "@/lib/params";
import { balcaoContext } from "../../shared";
import { BalcaoHeader, StepBox } from "../../header";
import { AttachDraftButton, AutoClose, DiscardFlowButton, FlowMarkButton, PrepareContractButton, SendViaFredyButton } from "../../flow-buttons";
import { GenerateTripContractButton } from "@/components/trip-contract-button";

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
  // contrato da viagem: um contrato só para as vendas da mesma viagem
  const contractCode = d.tripContract?.code ?? sale?.code ?? "";
  const tripOfferButton = d.tripOffer && (!contract || contract.status === "NAO_GERADO" || contract.status === "EM_PREPARACAO") && (
    <GenerateTripContractButton tripId={d.tripOffer.tripId} codes={d.tripOffer.codes} openAfter={false} label="Juntar com as outras vendas da viagem em um contrato só" />
  );
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
      <StepBox n={2} title="Cadastrar ou conferir o cliente" steps={["Confira nome, documento (CPF ou, se estrangeiro, passaporte/RNE), endereço, WhatsApp e e-mail.", "Se algo estiver errado ou faltando, clique em Editar."]}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-25 text-brand-700">
            <UserRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink">{client.name}</p>
            <p className="text-sm text-muted">{[clientDocHint(client), client.whatsapp || client.phone, client.email].filter(Boolean).join(" · ") || "sem documento e contato"}</p>
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
      <StepBox n={3} title="Fotos dos documentos do cliente" optional steps={["Envie ou fotografe RG, CPF, CNH, passaporte ou RNE de quem vai viajar, com o número.", "Se o cliente ainda não mandou, pule e anexe depois."]}>
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
    const contractSent = contract && (contract.status === "ENVIADO" || contract.status === "ASSINADO");
    if (sale && sale.status !== "ORCAMENTO" && sale.status !== "CANCELADA" && !contractSent) {
      // venda confirmada, contrato ainda não enviado: dá para voltar e ajustar (ex.: passageiros esquecidos)
      const { sale: _s, ...form } = await editSaleFormData(ctx, sale.id);
      void _s;
      body = (
        <div className="space-y-4">
          <StepBox n={4} title="Ajustar a venda" steps={["Corrija o que precisar (passageiros, datas, valores, pagamento) e clique em salvar.", "Depois, na etapa 5, atualize a prévia e emita o contrato de novo."]}>
            <p className="px-5 py-3 text-sm text-slate-600">
              Venda {sale.code} já confirmada.{" "}
              {contract && ["AGUARDANDO_ENVIO"].includes(contract.status) ? "O contrato já emitido fica marcado como desatualizado e precisa ser emitido de novo." : ""}
            </p>
          </StepBox>
          <SaleForm {...form} afterSaveHref={base} />
        </div>
      );
    } else if (sale && sale.status !== "ORCAMENTO") {
      body = (
        <StepBox n={4} title="Lançar e confirmar a venda">
          <div className="flex flex-wrap items-center gap-2 px-5 py-4 text-sm">
            <span className="font-semibold text-ink">{sale.code}</span> <SaleStatusBadge s={sale.status} />
            <span className="text-muted">
              {sale.destination ?? "sem destino"}
              {sale.tripStart && ` · ${formatDate(sale.tripStart)}`} · <span className="tabular">{formatBRL(sale.grossCents)}</span>
            </span>
          </div>
          <p className="px-5 pb-4 text-xs text-muted">Venda confirmada e contrato já enviado ao cliente. Para alterar agora, peça ao gestor.</p>
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
          {d.tripOffer && (
            <p className="px-5 pt-4 text-sm text-slate-600">
              Esta venda está na viagem {d.tripOffer.code} com {d.tripOffer.codes.filter((c) => c !== sale.code).join(", ")}. Se quiser, junte tudo em um contrato só.
            </p>
          )}
          {footer(
            <>
              {tripOfferButton}
              <PrepareContractButton saleId={sale.id} />
            </>,
          )}
        </StepBox>
      );
    } else if (view === 5) {
      // campos que o modelo pediu e a venda não tem (ex.: lista de passageiros) aparecem no texto como "[... não informado]"
      const blanks = [...new Set([...(full.content ?? "").matchAll(/\[([^\]\n]{2,60}?) não informad[oa]s?\]/g)].map((m) => m[1]))];
      const backToSale = (
        <Link href={`${base}?etapa=4`} className={`${btn} border border-line bg-white text-ink hover:bg-slate-50`}>
          <ArrowLeft className="h-4 w-4" /> Voltar para a venda e ajustar
        </Link>
      );
      body = (
        <StepBox
          n={5}
          title="Emitir o contrato"
          steps={[
            <>
              Clique em <strong>Atualizar prévia</strong> e leia o contrato.
            </>,
            "Se faltar alguma informação (passageiros, datas, valores), clique em Voltar para a venda e ajustar.",
            <>
              Com tudo certo, clique em <strong>Emitir contrato</strong>.
            </>,
          ]}
        >
          {(full.tripId || tripOfferButton) && (
            <div className="no-print flex flex-wrap items-center gap-3 border-b border-line bg-brand-25 px-5 py-3 text-sm text-slate-700">
              {full.tripId && d.tripContract ? (
                <p className="flex-1">
                  Este é o contrato da viagem {d.tripContract.code}: junta as vendas {full.tripSales.included.map((s) => s.code).join(", ")}.
                </p>
              ) : (
                <>
                  <p className="flex-1">Esta venda está numa viagem com outras vendas confirmadas. Você pode juntar todas em um contrato só.</p>
                  {tripOfferButton}
                </>
              )}
            </div>
          )}
          {(missing.length > 0 || blanks.length > 0 || full.outdated) && (
            <div className="no-print space-y-2 border-b border-line bg-amber-50 px-5 py-3 text-sm text-amber-900">
              {full.outdated &&
                (full.tripId ? (
                  <p><strong>Uma venda da viagem foi alterada, incluída ou retirada depois da emissão.</strong> Clique em Atualizar prévia e emita o contrato de novo.</p>
                ) : (
                  <p><strong>A venda foi alterada depois da emissão.</strong> Clique em Atualizar prévia e emita o contrato de novo.</p>
                ))}
              {missing.length > 0 && (
                <p>
                  <strong>Falta para emitir:</strong> {missing.join(", ")}. {missing.some((m) => /cliente|cpf|passaporte|rne|documento|endere/i.test(m)) && <Link href={`${base}?etapa=2`} className="underline">Completar o cliente</Link>}
                </p>
              )}
              {blanks.length > 0 && (
                <p>
                  <strong>Em branco no contrato:</strong> {blanks.join(", ")}. Se precisar, volte para a venda e preencha.
                </p>
              )}
            </div>
          )}
          <div className="print-area">
            <div className="no-print flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
              <p className="flex flex-1 items-center gap-2 text-sm font-semibold text-ink">
                {d.tripContract ? `Contrato da viagem ${d.tripContract.code}` : `Contrato da venda ${sale.code}`} <ContractStatusBadge s={full.status} />
              </p>
              <div className="flex flex-wrap gap-2">{actions}</div>
            </div>
            <article className="max-h-[55vh] overflow-auto whitespace-pre-wrap px-8 py-6 font-serif text-[14px] leading-relaxed text-slate-800 print:max-h-none print:overflow-visible">
              {full.content ?? "Nenhum conteúdo gerado ainda. Clique em “Atualizar prévia”."}
            </article>
          </div>
          <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            {backToSale}
            {reviewing && goCurrent}
          </div>
        </StepBox>
      );
    } else {
      const sentAuto = full.status === "ENVIADO" || full.status === "ASSINADO";
      const viaFredy = await fredyConnected(ctx.companyId);
      body = (
        <StepBox
          n={6}
          title="Enviar o contrato ao cliente"
          steps={
            viaFredy
              ? [
                  <>
                    Clique em <strong>Enviar contrato pelo Frédy</strong>: o PDF vai direto na conversa aberta do cliente.
                  </>,
                  "Se o cliente não tiver conversa aberta no Frédy, abra a conversa com ele e clique de novo.",
                ]
              : [
                  <>
                    Clique em <strong>Baixar contrato (PDF)</strong>.
                  </>,
                  <>
                    Clique em <strong>Abrir o WhatsApp do cliente</strong> e anexe o PDF baixado na conversa.
                  </>,
                  "Depois de enviar, clique em Enviei ao cliente.",
                ]
          }
        >
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            {viaFredy && !sentAuto && !reviewing && <SendViaFredyButton id={flowId} />}
            <a href={`/api/contratos/${full.id}/pdf`} download className={`${btn} border border-line bg-white text-ink hover:bg-slate-50`}>
              <Download className="h-4 w-4" /> Baixar contrato (PDF)
            </a>
            {!viaFredy && wa && (
              <a
                href={`https://wa.me/${wa}?text=${encodeURIComponent(
                  full.signUrl && full.status === "ENVIADO"
                    ? `Olá ${firstName}! Segue o link para assinar o contrato da sua viagem (${contractCode}): ${full.signUrl}`
                    : `Olá ${firstName}! Segue o contrato da sua viagem (${contractCode}). Qualquer dúvida, estou à disposição.`,
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
          {!viaFredy && !wa && <p className="px-5 pb-3 text-xs text-amber-800">O cliente está sem WhatsApp no cadastro. Envie o PDF pelo canal que ele usa.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <Link href={`${base}?etapa=4`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar para a venda e ajustar
            </Link>
            {reviewing || sentAuto ? (
              goCurrent
            ) : (
              <FlowMarkButton id={flowId} mark="sent" label={viaFredy ? "Já enviei por outro meio" : "Enviei ao cliente, continuar"} variant={viaFredy ? "outline" : "primary"} />
            )}
          </div>
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
          <h1 className="font-display text-xl font-semibold text-ink">Tudo confirmado e concluído</h1>
          <ul className="space-y-1 text-sm text-slate-600">
            <li>Cliente: {client.name}</li>
            {sale && (
              <li>
                Venda {sale.code} confirmada · <span className="tabular">{formatBRL(sale.grossCents)}</span>
              </li>
            )}
            {contract &&
              (d.flow.contractSent && contract.status === "AGUARDANDO_ENVIO" ? (
                <li>{d.tripContract ? `Contrato da viagem ${d.tripContract.code} emitido e enviado ao cliente` : "Contrato emitido e enviado ao cliente"}</li>
              ) : (
                <li>
                  {d.tripContract ? `Contrato da viagem ${d.tripContract.code}` : "Contrato"} <ContractStatusBadge s={contract.status} />
                </li>
              ))}
          </ul>
          <p className="max-w-md text-xs text-muted">Tudo ficou registrado no painel de gestão{d.flow.fredyCardId || sale?.externalRef?.startsWith("fredy:") ? " e o card do Frédy recebeu a anotação de concluído" : ""}.</p>
          <AutoClose saleCode={sale?.code ?? null} />
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

