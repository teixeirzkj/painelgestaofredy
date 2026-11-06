import "server-only";
import { redirect } from "next/navigation";
import { getContext } from "@/server/auth";
import { can, type Ctx } from "@/server/context";
import { prisma } from "@/server/db";
import { clientScope } from "@/server/services/registry";
import { saleScope } from "@/server/services/sales";
import type { GuideFacts } from "./guide";

/** Contexto da tela do vendedor: sem login, vai para o login e volta para a mesma tela. */
export async function balcaoContext(path: string): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (!ctx.permissions.has("sales.create")) redirect("/?negado=1");
  return ctx;
}

/** Repassa o card do Frédy entre as etapas. */
export function carry(card?: string | null, extra: Record<string, string | null | undefined> = {}) {
  const p = new URLSearchParams();
  if (card) p.set("card", card);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Chave do atendimento antes da venda existir (as confirmações do passo a passo ficam nela). */
export function flowKeyFor(card?: string | null) {
  return card ? `card:${card}` : "novo";
}

/** O que falta no cadastro para emitir o contrato. */
export function clientMissing(c: { document: string | null; street: string | null }) {
  return [!c.document && "CPF/CNPJ", !c.street && "endereço"].filter(Boolean) as string[];
}

/** Situação do cliente para o passo a passo. */
export async function clientGuideFacts(ctx: Ctx, clientId: string | null | undefined) {
  const c = clientId
    ? await prisma.client.findFirst({ where: { AND: [{ id: clientId }, clientScope(ctx)] }, select: { document: true, street: true, _count: { select: { attachments: true } } } })
    : null;
  const missing = c ? clientMissing(c) : [];
  return { clientChosen: !!c, clientComplete: !!c && missing.length === 0, clientMissing: missing, docs: c?._count.attachments ?? 0 };
}

/** Situação de uma venda já criada (rascunho ou confirmada) para o passo a passo. */
export async function saleGuideFacts(ctx: Ctx, saleId: string, page: GuideFacts["page"]): Promise<GuideFacts | null> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, ...saleScope(ctx) },
    select: {
      status: true,
      externalRef: true,
      clientId: true,
      contracts: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { attachments: true } },
    },
  });
  if (!sale) return null;
  const card = sale.externalRef?.startsWith("fredy:") ? sale.externalRef.slice(6) : null;
  return {
    page,
    flowKey: `venda:${saleId}`,
    inheritKey: flowKeyFor(card),
    cardTitle: null,
    ...(await clientGuideFacts(ctx, sale.clientId)),
    saleExists: true,
    saleConfirmed: sale.status !== "ORCAMENTO",
    contractStatus: sale.contracts[0]?.status ?? null,
    canContract: can(ctx, "contracts.manage"),
    attachments: sale._count.attachments,
  };
}
