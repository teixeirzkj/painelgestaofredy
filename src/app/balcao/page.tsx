import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, History } from "lucide-react";
import { prisma } from "@/server/db";
import { can } from "@/server/context";
import { clientScope } from "@/server/services/registry";
import { fredyCardPrefill } from "@/server/services/fredy";
import { BALCAO_STEPS, DONE_STEP, flowFromCard, listOpenFlows } from "@/server/services/balcao";
import { AppError } from "@/server/errors";
import { Card, CardHeader, Notice } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { onlyDigits } from "@/lib/utils";
import { str, type SearchParams } from "@/lib/params";
import { balcaoContext, carry } from "./shared";
import { BalcaoHeader, StepBox } from "./header";
import { ClientPicker } from "./client-picker";
import { DiscardFlowButton } from "./flow-buttons";

/**
 * Venda rápida (popup do atendente): etapa 1 (card do Frédy) e etapa 2 (escolher ou cadastrar o cliente).
 * Escolhido o cliente, abre-se o atendimento (/balcao/a/:id), que guarda em que etapa parou.
 * Aceita ?card=<id do card no Frédy> e ?nome=&telefone=&email=&cpf= para pré-preencher.
 */
export default async function BalcaoInicioPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const card = str(sp, "card") ?? null;
  const etapa = str(sp, "etapa") === "2" ? 2 : 1;
  const keep = { nome: str(sp, "nome"), telefone: str(sp, "telefone"), email: str(sp, "email"), cpf: str(sp, "cpf") };
  const ctx = await balcaoContext(`/balcao${carry(card, { etapa: etapa === 2 ? "2" : null, ...keep })}`);

  // aberto pelo card: se o card já tem atendimento (ou venda), volta direto para a etapa em que parou
  if (card) {
    const flowId = await flowFromCard(ctx, card);
    if (flowId) redirect(`/balcao/a/${flowId}`);
  }

  let prefill: Awaited<ReturnType<typeof fredyCardPrefill>> | null = null;
  let cardError: string | null = null;
  if (card) {
    try {
      prefill = await fredyCardPrefill(ctx, card);
    } catch (e) {
      cardError = e instanceof AppError ? e.message : "Não foi possível ler o card do Frédy.";
    }
  }

  if (etapa === 1) {
    const open = await listOpenFlows(ctx);
    const next = `/balcao${carry(card, { etapa: "2", ...keep })}`;
    return (
      <>
        <BalcaoHeader ctx={ctx} view={1} done={[]} />
        <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
          <StepBox
            n={1}
            title="Card do cliente no Frédy"
            steps={[
              "No Frédy, abra a conversa do cliente e encontre o card dele.",
              "Confira se o card está preenchido: campos personalizados, anotação e descrição.",
              <>
                Marque o card como <strong>ganho</strong> (ou mova para venda fechada). Assim a venda vai para o painel de gestão.
              </>,
            ]}
          >
            {cardError && (
              <div className="px-5 pt-4">
                <Notice tone="amber" title="Card do Frédy">
                  {cardError} Dá para seguir normalmente: a venda só não fica ligada ao card.
                </Notice>
              </div>
            )}
            {prefill && (
              <div className="px-5 pt-4">
                <Notice title={`Card: ${prefill.title}`}>
                  {[prefill.contact?.name, prefill.priceCents ? formatBRL(prefill.priceCents) : null, prefill.destination].filter(Boolean).join(" · ") || "Card sem contato e valor."}
                </Notice>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-4">
              <Link href={next} className="text-sm text-muted hover:text-ink hover:underline">
                O cliente não veio pelo Frédy
              </Link>
              <Link href={next} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700">
                Já fiz, continuar <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </StepBox>

          {open.length > 0 && (
            <Card>
              <CardHeader title="Atendimentos em andamento" icon={History} description="Continue de onde parou. A tela volta na mesma etapa." />
              <ul className="divide-y divide-line border-t border-line">
                {open.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{f.clientName}</span>
                      <span className="block text-xs text-muted">
                        {f.current >= DONE_STEP ? "Pronto para concluir" : `Parou na etapa ${f.current}: ${BALCAO_STEPS[f.current - 1]}`}
                        {f.saleCode && ` · venda ${f.saleCode}`}
                      </span>
                    </span>
                    <DiscardFlowButton id={f.id} confirmText={`Tirar o atendimento de ${f.clientName} da lista? O cliente e a venda continuam na gestão.`} />
                    <Link href={`/balcao/a/${f.id}`} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-slate-50">
                      Continuar <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </main>
      </>
    );
  }

  // etapa 2: achar ou cadastrar o cliente
  const name = prefill?.contact?.name ?? keep.nome ?? "";
  const email = (prefill?.contact?.email ?? keep.email ?? "").toLowerCase();
  const phone = onlyDigits(prefill?.contact?.phone ?? keep.telefone);
  const cpf = onlyDigits(keep.cpf);
  let matches: { id: string; name: string; document: string | null; whatsapp: string | null; email: string | null; reason: string }[] = [];
  const or = [
    ...(prefill?.contact?.id ? [{ fredyContactId: prefill.contact.id }] : []),
    ...(cpf.length >= 11 ? [{ document: cpf }] : []),
    ...(email ? [{ email }] : []),
    ...(phone.length >= 8 ? [{ whatsapp: { contains: phone.slice(-4) } }, { phone: { contains: phone.slice(-4) } }] : []),
  ];
  if (or.length) {
    const found = await prisma.client.findMany({ where: { AND: [clientScope(ctx), { archivedAt: null }, { OR: or }] }, take: 20, select: { id: true, name: true, document: true, whatsapp: true, phone: true, email: true, fredyContactId: true } });
    matches = found
      .map((c) => {
        const reason =
          prefill?.contact?.id && c.fredyContactId === prefill.contact.id
            ? "mesmo contato do Frédy"
            : cpf && c.document === cpf
              ? "mesmo CPF"
              : email && c.email === email
                ? "mesmo e-mail"
                : phone && [c.whatsapp, c.phone].some((p) => p && onlyDigits(p).slice(-8) === phone.slice(-8))
                  ? "mesmo telefone"
                  : "";
        return { ...c, reason };
      })
      .filter((c) => c.reason);
  }
  return (
    <>
      <BalcaoHeader ctx={ctx} view={2} done={[true]} />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <StepBox
          n={2}
          title="Cadastrar ou conferir o cliente"
          steps={[
            "Busque o cliente pelo nome, CPF ou telefone.",
            "Se não achar, cadastre o cliente novo. Para o contrato precisa de CPF/CNPJ e endereço completo.",
          ]}
        />
        <ClientPicker
          card={prefill ? card : null}
          canCreate={can(ctx, "clients.manage")}
          matches={matches}
          prefill={{ name, email, whatsapp: phone ? (phone.startsWith("55") && phone.length > 11 ? phone.slice(2) : phone) : "", document: cpf }}
        />
        <div>
          <Link href={`/balcao${carry(card, keep)}`} className="text-sm text-muted hover:text-ink hover:underline">
            ← Voltar para a etapa 1
          </Link>
        </div>
      </main>
    </>
  );
}
