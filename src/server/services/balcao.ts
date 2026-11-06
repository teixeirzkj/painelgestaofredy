/**
 * Atendimento da venda rápida (popup do atendente).
 *
 * As etapas saem do que está gravado na gestão (cliente, venda, contrato) e de quatro confirmações
 * do atendente guardadas no atendimento. Assim, quem sai da tela e volta cai na mesma etapa.
 */
import { prisma } from "@/server/db";
import { assertCan, can, type Ctx } from "@/server/context";
import { AppError } from "@/server/errors";
import { clientScope } from "./registry";
import { saleScope } from "./sales";

export const BALCAO_STEPS = ["Card do Frédy", "Cliente", "Documentos", "Venda", "Contrato", "Enviar contrato", "Vouchers"] as const;
export const DONE_STEP = BALCAO_STEPS.length + 1;

const ISSUED = ["AGUARDANDO_ENVIO", "ENVIADO", "ASSINADO"];
const SENT = ["ENVIADO", "ASSINADO"];

/** O que falta no cadastro para emitir o contrato. */
export function clientMissing(c: { document: string | null; street: string | null }) {
  return [!c.document && "CPF/CNPJ", !c.street && "endereço"].filter(Boolean) as string[];
}

type StepInput = {
  cardDone: boolean;
  dataChecked: boolean;
  docsDone: boolean;
  contractSent: boolean;
  finishedAt: Date | null;
  clientComplete: boolean;
  saleStatus: string | null;
  contractStatus: string | null;
  canContract: boolean;
};

/** Etapas feitas (1 a 7) e a etapa atual (8 = atendimento concluído). */
export function flowSteps(f: StepInput) {
  const saleOk = !!f.saleStatus && f.saleStatus !== "ORCAMENTO" && f.saleStatus !== "CANCELADA";
  const issued = ISSUED.includes(f.contractStatus ?? "");
  const done = [
    f.cardDone,
    f.dataChecked && f.clientComplete,
    f.docsDone,
    saleOk,
    saleOk && (!f.canContract || issued),
    saleOk && (!f.canContract || (issued && (f.contractSent || SENT.includes(f.contractStatus ?? "")))),
    !!f.finishedAt,
  ];
  const first = done.findIndex((d) => !d);
  return { done, current: first === -1 ? DONE_STEP : first + 1 };
}

function flowScope(ctx: Ctx) {
  return { companyId: ctx.companyId, ...(can(ctx, "sales.view_all") ? {} : { userId: ctx.userId }) };
}

async function findFlow(ctx: Ctx, id: string) {
  const flow = await prisma.balcaoFlow.findFirst({ where: { id, ...flowScope(ctx) } });
  if (!flow) throw new AppError("Atendimento não encontrado.", "NOT_FOUND");
  return flow;
}

/** Abre (ou retoma) o atendimento do cliente. A etapa 1 já foi confirmada antes de escolher o cliente. */
export async function startFlow(ctx: Ctx, input: { clientId: string; card?: string | null }) {
  assertCan(ctx, "sales.create");
  const client = await prisma.client.findFirst({ where: { AND: [{ id: input.clientId }, clientScope(ctx)] }, select: { id: true } });
  if (!client) throw new AppError("Cliente não encontrado.", "NOT_FOUND");
  const card = input.card?.trim() || null;
  const open = await prisma.balcaoFlow.findFirst({ where: { ...flowScope(ctx), clientId: client.id, finishedAt: null }, orderBy: { updatedAt: "desc" } });
  if (open) {
    await prisma.balcaoFlow.update({ where: { id: open.id }, data: { cardDone: true, ...(card && !open.fredyCardId ? { fredyCardId: card } : {}) } });
    return { id: open.id };
  }
  const sale = card ? await prisma.sale.findFirst({ where: { ...saleScope(ctx), externalRef: `fredy:${card}`, clientId: client.id }, select: { id: true } }) : null;
  const flow = await prisma.balcaoFlow.create({ data: { companyId: ctx.companyId, userId: ctx.userId, clientId: client.id, fredyCardId: card, saleId: sale?.id ?? null, cardDone: true } });
  return { id: flow.id };
}

/** Atendimento ligado a um card do Frédy (link do card): o aberto, ou o da venda que o card já gerou. */
export async function flowFromCard(ctx: Ctx, card: string) {
  const open = await prisma.balcaoFlow.findFirst({ where: { ...flowScope(ctx), fredyCardId: card }, orderBy: [{ finishedAt: "asc" }, { updatedAt: "desc" }] });
  if (open) return open.id;
  const sale = await prisma.sale.findFirst({ where: { ...saleScope(ctx), externalRef: `fredy:${card}` }, select: { id: true, clientId: true } });
  if (!sale) return null;
  const bySale = await prisma.balcaoFlow.findFirst({ where: { ...flowScope(ctx), saleId: sale.id } });
  if (bySale) return bySale.id;
  const flow = await prisma.balcaoFlow.create({ data: { companyId: ctx.companyId, userId: ctx.userId, clientId: sale.clientId, saleId: sale.id, fredyCardId: card, cardDone: true } });
  return flow.id;
}

/** Tudo o que a tela do atendimento precisa, com as etapas calculadas. */
export async function loadFlow(ctx: Ctx, id: string) {
  let flow = await findFlow(ctx, id);
  // card marcado como ganho no Frédy depois de abrir o atendimento: a venda chega como rascunho e entra aqui
  if (!flow.saleId && flow.fredyCardId) {
    const s = await prisma.sale.findFirst({ where: { ...saleScope(ctx), externalRef: `fredy:${flow.fredyCardId}`, clientId: flow.clientId }, select: { id: true } });
    if (s) flow = await prisma.balcaoFlow.update({ where: { id: flow.id }, data: { saleId: s.id } });
  }
  const client = await prisma.client.findFirst({
    where: { AND: [{ id: flow.clientId }, clientScope(ctx)] },
    include: { attachments: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, fileName: true, mimeType: true, docNumber: true, docExpiry: true, createdAt: true } } },
  });
  if (!client) throw new AppError("Cliente do atendimento não encontrado.", "NOT_FOUND");
  const sale = flow.saleId
    ? await prisma.sale.findFirst({
        where: { id: flow.saleId, ...saleScope(ctx) },
        select: {
          id: true,
          code: true,
          status: true,
          destination: true,
          tripStart: true,
          grossCents: true,
          externalRef: true,
          contracts: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 1 },
          attachments: { orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true, kind: true, createdAt: true } },
        },
      })
    : null;
  const missing = clientMissing(client);
  const canContract = can(ctx, "contracts.manage");
  const steps = flowSteps({
    ...flow,
    clientComplete: missing.length === 0,
    saleStatus: sale?.status ?? null,
    contractStatus: sale?.contracts[0]?.status ?? null,
    canContract,
  });
  // rascunhos do cliente que podem ser esta venda (ex.: o que chegou do Frédy quando o card virou ganho)
  const drafts = !sale
    ? await prisma.sale.findMany({
        where: { ...saleScope(ctx), clientId: client.id, status: "ORCAMENTO" },
        select: { id: true, code: true, destination: true, grossCents: true, externalRef: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];
  return { flow, client, missing, sale, contract: sale?.contracts[0] ?? null, canContract, drafts, ...steps };
}

export type FlowMark = "data" | "docs" | "sent" | "finish";

/** Confirmações do atendente (etapas 2, 3, 6 e 7). */
export async function markFlow(ctx: Ctx, id: string, mark: FlowMark) {
  const d = await loadFlow(ctx, id);
  if (mark === "data") {
    if (d.missing.length) throw new AppError(`Complete o cadastro antes: falta ${d.missing.join(" e ")}.`);
    await prisma.balcaoFlow.update({ where: { id }, data: { dataChecked: true } });
  } else if (mark === "docs") {
    await prisma.balcaoFlow.update({ where: { id }, data: { docsDone: true } });
  } else if (mark === "sent") {
    if (!d.done[4]) throw new AppError("Emita o contrato antes de marcar como enviado.");
    await prisma.balcaoFlow.update({ where: { id }, data: { contractSent: true } });
  } else {
    if (!d.done.slice(0, 6).every(Boolean)) throw new AppError("Ainda há etapas obrigatórias pendentes.");
    await prisma.balcaoFlow.update({ where: { id }, data: { finishedAt: new Date() } });
  }
}

/** Liga ao atendimento a venda criada nele (ou um rascunho do mesmo cliente). */
export async function attachSale(ctx: Ctx, id: string, saleId: string) {
  const flow = await findFlow(ctx, id);
  const sale = await prisma.sale.findFirst({ where: { id: saleId, ...saleScope(ctx), clientId: flow.clientId }, select: { id: true } });
  if (!sale) throw new AppError("Venda não encontrada para este cliente.");
  await prisma.balcaoFlow.update({ where: { id }, data: { saleId: sale.id } });
}

/** Tira o atendimento da lista de andamento (a venda e o cliente continuam na gestão). */
export async function discardFlow(ctx: Ctx, id: string) {
  await findFlow(ctx, id);
  await prisma.balcaoFlow.delete({ where: { id } });
}

/** Atendimentos em andamento do atendente, com a etapa em que cada um parou. */
export async function listOpenFlows(ctx: Ctx) {
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const flows = await prisma.balcaoFlow.findMany({
    where: { ...flowScope(ctx), finishedAt: null, updatedAt: { gte: since } },
    orderBy: { updatedAt: "desc" },
    take: 20,
    include: {
      client: { select: { name: true, document: true, street: true } },
      sale: { select: { code: true, status: true, contracts: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 } } },
    },
  });
  const canContract = can(ctx, "contracts.manage");
  return flows.map((f) => {
    const { current } = flowSteps({
      ...f,
      clientComplete: clientMissing(f.client).length === 0,
      saleStatus: f.sale?.status ?? null,
      contractStatus: f.sale?.contracts[0]?.status ?? null,
      canContract,
    });
    return { id: f.id, clientName: f.client.name, saleCode: f.sale?.code ?? null, current, updatedAt: f.updatedAt };
  });
}
