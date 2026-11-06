import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";
import { prisma } from "@/server/db";
import { can, today } from "@/server/context";
import { clientScope } from "@/server/services/registry";
import { fredyCardPrefill } from "@/server/services/fredy";
import { AppError } from "@/server/errors";
import { Card, CardHeader, Notice } from "@/components/ui";
import { formatDocument, onlyDigits } from "@/lib/utils";
import { str, type SearchParams } from "@/lib/params";
import { EditClientButton } from "@/app/(app)/clientes/client-buttons";
import { ClientDocuments } from "@/app/(app)/clientes/[id]/client-documents";
import { saleScope } from "@/server/services/sales";
import { formatBRL } from "@/lib/money";
import { balcaoContext, carry, clientMissing, flowKeyFor } from "./shared";
import { BalcaoGuide, GatedContinue, type GuideFacts } from "./guide";
import { ClientPicker } from "./client-picker";

/**
 * Etapa 1 da venda rápida: escolher ou cadastrar o cliente e anexar os documentos.
 * Aceita ?card=<id do card no Frédy> (pré-preenche pelo contato do card) ou ?nome=&telefone=&email=&cpf=.
 */
export default async function BalcaoClientePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const card = str(sp, "card") ?? null;
  const ctx = await balcaoContext(`/balcao${carry(card, { cliente: str(sp, "cliente"), nome: str(sp, "nome"), telefone: str(sp, "telefone"), email: str(sp, "email"), cpf: str(sp, "cpf") })}`);

  let prefill: Awaited<ReturnType<typeof fredyCardPrefill>> | null = null;
  let cardError: string | null = null;
  if (card) {
    try {
      prefill = await fredyCardPrefill(ctx, card);
    } catch (e) {
      cardError = e instanceof AppError ? e.message : "Não foi possível ler o card do Frédy.";
    }
  }
  const name = prefill?.contact?.name ?? str(sp, "nome") ?? "";
  const email = (prefill?.contact?.email ?? str(sp, "email") ?? "").toLowerCase();
  const phone = onlyDigits(prefill?.contact?.phone ?? str(sp, "telefone"));
  const cpf = onlyDigits(str(sp, "cpf"));

  // cliente escolhido
  const clientId = str(sp, "cliente");
  const selected = clientId
    ? await prisma.client.findFirst({
        where: { AND: [{ id: clientId }, clientScope(ctx)] },
        include: { attachments: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, fileName: true, mimeType: true, docNumber: true, docExpiry: true, createdAt: true } } },
      })
    : null;

  // sugestões pelo contato do card / dados do link
  let matches: { id: string; name: string; document: string | null; whatsapp: string | null; email: string | null; reason: string }[] = [];
  if (!selected) {
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
  }

  const canManage = can(ctx, "clients.manage");
  const flowKey = flowKeyFor(prefill ? card : null);
  const missing = selected ? clientMissing(selected) : [];
  const guide: GuideFacts = {
    page: "cliente",
    flowKey,
    cardTitle: prefill?.title ?? null,
    clientChosen: !!selected,
    clientComplete: !!selected && missing.length === 0,
    clientMissing: missing,
    docs: selected?.attachments.length ?? 0,
    saleExists: false,
    saleConfirmed: false,
    contractStatus: null,
    canContract: can(ctx, "contracts.manage"),
    attachments: 0,
  };
  // rascunhos do cliente (ex.: o que chegou do Frédy quando o card virou ganho): continuar por eles evita venda duplicada
  const drafts = selected
    ? await prisma.sale.findMany({
        where: { ...saleScope(ctx), clientId: selected.id, status: "ORCAMENTO" },
        select: { id: true, code: true, destination: true, origin: true, externalRef: true, grossCents: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];
  const continueCls = "inline-flex h-11 items-center gap-2 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700";
  return (
    <div className="space-y-5">
      <BalcaoGuide facts={guide} />
      {cardError && <Notice tone="amber" title="Card do Frédy">{cardError} Você pode continuar normalmente: a venda só não ficará ligada ao card.</Notice>}
      {prefill && (
        <Notice title={`Card do Frédy: ${prefill.title}`}>
          {prefill.existingSale ? (
            <>
              Este card já virou a venda {prefill.existingSale.code}.{" "}
              <Link href={`/balcao/${prefill.existingSale.id}`} className="font-medium underline">
                Abrir a venda
              </Link>
            </>
          ) : (
            <>Os dados do contato e do card já vêm preenchidos. Ao confirmar a venda, o card é marcado como ganho no Frédy com o valor final.</>
          )}
        </Notice>
      )}

      {selected ? (
        <>
          <Card>
            <CardHeader
              title={selected.name}
              icon={UserRound}
              description={[selected.document && formatDocument(selected.document), selected.whatsapp || selected.phone, selected.email].filter(Boolean).join(" · ") || "Cadastro sem documento e contato"}
              action={
                <div className="flex gap-2">
                  <Link href={`/balcao${carry(card)}`} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-muted hover:bg-slate-100">
                    Trocar cliente
                  </Link>
                  {canManage && <EditClientButton id={selected.id} initial={selected} />}
                </div>
              }
            />
            {(!selected.document || !selected.street) && (
              <p className="border-t border-line bg-amber-50 px-5 py-2 text-xs text-amber-900">Para emitir o contrato, o cadastro precisa de CPF/CNPJ e endereço. Clique em Editar para completar.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Documentos do cliente" description="Fotos do RG, CPF, CNH ou passaporte. No celular, o botão da câmera tira a foto na hora." />
            <ClientDocuments clientId={selected.id} docs={selected.attachments} canManage={canManage} todayStr={today(ctx)} />
          </Card>
          {drafts.length > 0 && (
            <Notice tone="amber" title="Este cliente já tem venda em rascunho">
              <p>Se é esta venda, continue por ela em vez de lançar outra (a venda que chega do Frédy quando o card vira ganho fica aqui).</p>
              <ul className="mt-2 space-y-1">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <Link href={`/balcao/${d.id}/editar`} className="font-medium underline">
                      Continuar {d.code}
                    </Link>{" "}
                    · {d.destination ?? "sem destino"} · <span className="tabular">{formatBRL(d.grossCents)}</span>
                    {d.externalRef?.startsWith("fredy:") && " · veio do Frédy"}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="flex justify-end">
            <GatedContinue flowKey={flowKey} href={`/balcao/venda${carry(card, { cliente: selected.id })}`} className={continueCls}>
              Continuar: lançar a venda <ArrowRight className="h-4 w-4" />
            </GatedContinue>
          </div>
        </>
      ) : (
        <ClientPicker
          card={card}
          canCreate={canManage}
          matches={matches}
          prefill={{ name, email, whatsapp: phone ? (phone.startsWith("55") && phone.length > 11 ? phone.slice(2) : phone) : "", document: cpf }}
        />
      )}
    </div>
  );
}
