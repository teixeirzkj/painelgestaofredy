/**
 * Integração com o CRM Frédy pela API pública WTS (https://api.wts.chat), conforme a documentação oficial.
 *
 * - A agência cola o token (pn_...) em Configurações → Integrações; ele é validado listando os painéis do CRM
 *   e fica criptografado no banco, sem nunca voltar para o navegador.
 * - Ao salvar o mapeamento, o sistema cria no Frédy a assinatura de webhook (Core › Webhooks) apontando para
 *   /api/integracoes/fredy/webhook/<chave secreta da agência>.
 * - Card do painel de vendas marcado como ganho → venda em rascunho na gestão, com cliente vinculado ao contato.
 * - Venda confirmada na gestão → card marcado como ganho, com valor e nota com o código da venda.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "../db";
import { assertCan, loadContext, today, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { encryptSecret, decryptSecret } from "../secrets";
import { createSale } from "./sales";
import { PRODUCT_TYPES } from "@/lib/constants";
import { formatBRL } from "@/lib/money";

const BASES = { crm: "https://api.wts.chat/crm", core: "https://api.wts.chat/core", chat: "https://api.wts.chat/chat" } as const;
const WEBHOOK_EVENTS = ["PANEL_CARD_UPDATE", "PANEL_CARD_STEP_CHANGE", "CONTACT_UPDATE"];
const CARD_DETAILS = ["Contacts", "CustomFields", "StepTitle", "ResponsibleUser"];

// ------------------------------ Tipos (schemas da doc WTS) ------------------------------
export type FredyStep = { id: string; title: string; position: number; isInitial: boolean; isFinal: boolean; archived: boolean };
export type FredyPanel = { id: string; title: string; type: string; archived: boolean; steps?: FredyStep[] | null };
export type FredyField = { id: string; key: string; name: string; type: string; parentId?: string | null; options?: { id: string; name: string }[] | null; children?: FredyField[] | null };
type FredyCard = {
  id: string;
  panelId: string;
  stepId: string;
  stepTitle?: string;
  title: string;
  description?: string | null;
  number?: number;
  monetaryAmount?: number | null;
  responsibleUserId?: string | null;
  contactIds?: string[] | null;
  contacts?: { id: string; name: string }[] | null;
  customFields?: Record<string, unknown> | null;
  status: "OPEN" | "WON" | "LOST" | "ARCHIVED";
};
type FredyContact = { id: string; name?: string | null; phoneNumber?: string | null; email?: string | null };
type Paged<T> = { items: T[]; hasMorePages: boolean };

export type FieldMap = { destination?: string; tripStart?: string; tripEnd?: string; passengerCount?: string };
export const FIELD_TARGETS: { key: keyof FieldMap; label: string }[] = [
  { key: "destination", label: "Destino" },
  { key: "tripStart", label: "Data de ida" },
  { key: "tripEnd", label: "Data de volta" },
  { key: "passengerCount", label: "Quantidade de passageiros" },
];

// ------------------------------ Cliente HTTP ------------------------------
async function wts<T>(token: string, mod: keyof typeof BASES, path: string, opts: { method?: string; query?: Record<string, string | number | string[]>; body?: unknown } = {}): Promise<T> {
  const url = new URL(BASES[mod] + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, String(v));
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
  } catch {
    throw new AppError("Não foi possível falar com o Frédy agora. Tente de novo em instantes.");
  }
  if (res.status === 401 || res.status === 403)
    throw new AppError("O Frédy recusou o token. Confira se ele está ativo em Frédy → Ajustes → Integrações → Integração via API.", "FORBIDDEN");
  if (res.status === 404) throw new AppError("Registro não encontrado no Frédy.", "NOT_FOUND");
  if (res.status === 429) throw new AppError("Limite de requisições do Frédy atingido. Tente de novo em alguns minutos.");
  if (!res.ok) {
    const txt = (await res.text().catch(() => "")).slice(0, 200);
    throw new AppError(`O Frédy respondeu com erro (HTTP ${res.status})${txt ? `: ${txt}` : "."}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function allPages<T>(fetchPage: (page: number) => Promise<Paged<T>>, maxPages = 10): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchPage(page);
    out.push(...(r.items ?? []));
    if (!r.hasMorePages) break;
  }
  return out;
}

export function publicBaseUrl(): string | null {
  const raw = process.env.APP_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!raw || /localhost|127\.0\.0\.1/.test(raw)) return null;
  return raw.replace(/\/+$/, "");
}

function webhookUrl(webhookKey: string) {
  const base = publicBaseUrl();
  return base ? `${base}/api/integracoes/fredy/webhook/${webhookKey}` : null;
}

async function tokenFor(companyId: string) {
  const integ = await prisma.fredyIntegration.findUnique({ where: { companyId } });
  if (!integ) throw new AppError("Conecte o Frédy primeiro, colando o token da API.", "NOT_FOUND");
  return { integ, token: decryptSecret(integ.tokenEnc) };
}

// ------------------------------ Leitura do CRM ------------------------------
async function fetchPanels(token: string): Promise<FredyPanel[]> {
  const items = await allPages((page) => wts<Paged<FredyPanel>>(token, "crm", "/v2/panel", { query: { PageNumber: page, PageSize: 100, IncludeDetails: ["Steps"] } }));
  return items.filter((p) => !p.archived).map((p) => ({ ...p, steps: (p.steps ?? []).filter((s) => !s.archived).sort((a, b) => a.position - b.position) }));
}

function flattenFields(list: FredyField[]): FredyField[] {
  return list.flatMap((f) => [...(f.type === "GROUP" ? [] : [f]), ...flattenFields(f.children ?? [])]);
}

export async function fetchPanelSetup(token: string, panelId: string) {
  const [panel, fields] = await Promise.all([
    wts<FredyPanel>(token, "crm", `/v1/panel/${encodeURIComponent(panelId)}`, { query: { IncludeDetails: ["Steps"] } }),
    wts<FredyField[]>(token, "crm", `/v1/panel/${encodeURIComponent(panelId)}/custom-fields`),
  ]);
  return {
    id: panel.id,
    title: panel.title,
    steps: (panel.steps ?? []).filter((s) => !s.archived).sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, title: s.title, isFinal: s.isFinal })),
    fields: flattenFields(fields ?? []).map((f) => ({ key: f.key, name: f.name, type: f.type })),
  };
}

// ------------------------------ Configuração (tela da agência) ------------------------------
export async function getFredyIntegration(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const integ = await prisma.fredyIntegration.findUnique({ where: { companyId: ctx.companyId } });
  const events = await prisma.fredyWebhookEvent.findMany({ where: { companyId: ctx.companyId }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!integ) return { connected: false as const, events, publicUrl: publicBaseUrl() };
  const { tokenEnc: _omit, webhookKey: _k, ...safe } = integ;
  return { connected: true as const, ...safe, fieldMap: JSON.parse(integ.fieldMapJson || "{}") as FieldMap, events, publicUrl: publicBaseUrl() };
}

export async function connectFredy(ctx: Ctx, rawToken: unknown) {
  assertCan(ctx, "settings.manage");
  const token = z.string().trim().min(10, "Cole o token completo (começa com pn_).").max(500).parse(rawToken).replace(/^Bearer\s+/i, "");
  const panels = await fetchPanels(token); // valida o token na API do Frédy
  const existing = await prisma.fredyIntegration.findUnique({ where: { companyId: ctx.companyId } });
  await prisma.$transaction(async (tx) => {
    const data = { tokenEnc: encryptSecret(token), tokenLast4: token.slice(-4), status: "CONECTADA", lastError: null, connectedAt: new Date() };
    if (existing) await tx.fredyIntegration.update({ where: { companyId: ctx.companyId }, data });
    else await tx.fredyIntegration.create({ data: { ...data, companyId: ctx.companyId, webhookKey: randomBytes(24).toString("base64url") } });
    await audit(tx, ctx, existing ? "integracao.fredy.token_trocado" : "integracao.fredy.conectada", "FredyIntegration", ctx.companyId, { panels: panels.length });
  });
  return { panels: panels.length };
}

export async function listFredyPanels(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const { token } = await tokenFor(ctx.companyId);
  return (await fetchPanels(token)).map((p) => ({ id: p.id, title: p.title, type: p.type, steps: (p.steps ?? []).length }));
}

export async function getFredyPanelSetup(ctx: Ctx, panelId: string) {
  assertCan(ctx, "settings.manage");
  const { token } = await tokenFor(ctx.companyId);
  return fetchPanelSetup(token, z.string().min(1).max(60).parse(panelId));
}

const optId = z.string().trim().max(60).optional().nullable().transform((v) => v || null);
const mappingSchema = z.object({
  salesPanelId: z.string().trim().min(1, "Escolha o painel de vendas.").max(60),
  quoteStepId: optId,
  wonStepId: optId,
  lostStepId: optId,
  fieldMap: z.object({ destination: optId, tripStart: optId, tripEnd: optId, passengerCount: optId }).prefault({}),
  defaultSellerId: optId,
  defaultProductType: z.enum(PRODUCT_TYPES.values).default("PACOTE"),
  autoCreateSale: z.boolean().default(true),
  syncBack: z.boolean().default(true),
});

/** Salva o mapeamento e garante a assinatura de webhook no Frédy. */
export async function saveFredyMapping(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const d = mappingSchema.parse(raw);
  const { token } = await tokenFor(ctx.companyId);
  const setup = await fetchPanelSetup(token, d.salesPanelId); // confere que o painel existe nesta conta
  const stepIds = new Set(setup.steps.map((s) => s.id));
  for (const [field, v] of [["quoteStepId", d.quoteStepId], ["wonStepId", d.wonStepId], ["lostStepId", d.lostStepId]] as const)
    if (v && !stepIds.has(v)) throw new AppError("Etapa não pertence ao painel escolhido.", "VALIDATION", [{ field, message: "Etapa inválida." }]);
  if (d.defaultSellerId && !(await prisma.user.findFirst({ where: { id: d.defaultSellerId, companyId: ctx.companyId, active: true } })))
    throw new AppError("Vendedor padrão inválido.");
  const fieldMap = Object.fromEntries(Object.entries(d.fieldMap).filter(([, v]) => v));
  await prisma.$transaction(async (tx) => {
    await tx.fredyIntegration.update({
      where: { companyId: ctx.companyId },
      data: {
        salesPanelId: d.salesPanelId,
        salesPanelTitle: setup.title,
        quoteStepId: d.quoteStepId,
        wonStepId: d.wonStepId,
        lostStepId: d.lostStepId,
        fieldMapJson: JSON.stringify(fieldMap),
        defaultSellerId: d.defaultSellerId,
        defaultProductType: d.defaultProductType,
        autoCreateSale: d.autoCreateSale,
        syncBack: d.syncBack,
      },
    });
    await audit(tx, ctx, "integracao.fredy.mapeamento", "FredyIntegration", ctx.companyId, { panel: setup.title });
  });
  return registerFredyWebhook(ctx.companyId);
}

/** Cria (ou recria) a assinatura de webhook no Frédy apontando para este sistema. */
export async function registerFredyWebhook(companyId: string) {
  const { integ, token } = await tokenFor(companyId);
  const url = webhookUrl(integ.webhookKey);
  if (!url) {
    await prisma.fredyIntegration.update({ where: { companyId }, data: { lastError: "Sistema sem endereço público: o webhook só é registrado na versão publicada." } });
    return { webhook: false, reason: "O webhook só pode ser registrado na versão publicada do sistema (endereço público)." };
  }
  try {
    // remove assinaturas anteriores deste mesmo destino para não receber eventos em dobro
    const subs = await wts<{ id: string; url: string }[]>(token, "core", "/v1/webhook/subscription");
    for (const s of subs ?? []) if (s.id === integ.webhookSubscriptionId || s.url === url) await wts(token, "core", `/v1/webhook/subscription/${s.id}`, { method: "DELETE" }).catch(() => {});
    const sub = await wts<{ id: string }>(token, "core", "/v1/webhook/subscription", {
      method: "POST",
      body: { name: "Frédy Gestão", url, enabled: true, events: WEBHOOK_EVENTS },
    });
    await prisma.fredyIntegration.update({ where: { companyId }, data: { webhookSubscriptionId: sub.id, status: "CONECTADA", lastError: null } });
    return { webhook: true };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Falha ao registrar o webhook no Frédy.";
    await prisma.fredyIntegration.update({ where: { companyId }, data: { status: "ERRO", lastError: msg } });
    throw e instanceof AppError ? e : new AppError(msg);
  }
}

export async function testFredyConnection(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const { token } = await tokenFor(ctx.companyId);
  try {
    const panels = await fetchPanels(token);
    await prisma.fredyIntegration.update({ where: { companyId: ctx.companyId }, data: { status: "CONECTADA", lastError: null } });
    return { panels: panels.length };
  } catch (e) {
    await prisma.fredyIntegration.update({ where: { companyId: ctx.companyId }, data: { status: "ERRO", lastError: e instanceof AppError ? e.message : "Falha de conexão." } });
    throw e;
  }
}

export async function disconnectFredy(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const integ = await prisma.fredyIntegration.findUnique({ where: { companyId: ctx.companyId } });
  if (!integ) return;
  if (integ.webhookSubscriptionId) {
    try {
      await wts(decryptSecret(integ.tokenEnc), "core", `/v1/webhook/subscription/${integ.webhookSubscriptionId}`, { method: "DELETE" });
    } catch {
      /* token já revogado: a assinatura deixa de funcionar de qualquer forma */
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.fredyIntegration.delete({ where: { companyId: ctx.companyId } });
    await audit(tx, ctx, "integracao.fredy.desconectada", "FredyIntegration", ctx.companyId);
  });
}

// ------------------------------ Webhook recebido do Frédy ------------------------------
type Integ = NonNullable<Awaited<ReturnType<typeof prisma.fredyIntegration.findUnique>>>;

async function logEvent(companyId: string, eventType: string, entityId: string | null, status: "PROCESSADO" | "IGNORADO" | "ERRO", message: string, saleId?: string) {
  await prisma.fredyWebhookEvent.create({ data: { companyId, eventType, entityId, status, message: message.slice(0, 500), saleId: saleId ?? null } });
}

/** Processa um evento do Frédy. Retorna false se a chave não corresponde a nenhuma agência. */
export async function handleFredyWebhook(webhookKey: string, body: unknown): Promise<boolean> {
  const integ = await prisma.fredyIntegration.findUnique({ where: { webhookKey }, include: { company: { select: { active: true } } } });
  if (!integ || !integ.company.active) return false;
  const ev = (body ?? {}) as { eventType?: string; content?: Record<string, unknown> };
  const type = String(ev.eventType ?? "");
  const entityId = typeof ev.content?.id === "string" ? ev.content.id : null;
  await prisma.fredyIntegration.update({ where: { id: integ.id }, data: { lastEventAt: new Date() } });
  try {
    if (type.startsWith("PANEL_CARD_") && entityId) await onCardEvent(integ, type, entityId);
    else if (type === "CONTACT_UPDATE" && entityId) await onContactUpdate(integ, ev.content as FredyContactEvent);
  } catch (e) {
    await logEvent(integ.companyId, type, entityId, "ERRO", e instanceof Error ? e.message : String(e));
    throw e;
  }
  return true;
}

async function onCardEvent(integ: Integ, type: string, cardId: string) {
  if (!integ.autoCreateSale || !integ.salesPanelId) return;
  const token = decryptSecret(integ.tokenEnc);
  // sempre lê o card atualizado pela API (o formato do conteúdo do webhook de card não é documentado)
  const card = await wts<FredyCard>(token, "crm", `/v2/panel/card/${encodeURIComponent(cardId)}`, { query: { IncludeDetails: CARD_DETAILS } });
  if (card.panelId !== integ.salesPanelId) return;
  const won = card.status === "WON" || (!!integ.wonStepId && card.stepId === integ.wonStepId);
  if (!won) return;
  const externalRef = `fredy:${card.id}`;
  if (await prisma.sale.findFirst({ where: { companyId: integ.companyId, externalRef }, select: { id: true } })) return; // já importado
  if (!card.monetaryAmount || card.monetaryAmount <= 0) {
    // sem valor não há venda; avisa uma vez no card e cria a venda quando o valor for preenchido (novo evento de atualização)
    const warned = await prisma.fredyWebhookEvent.findFirst({ where: { companyId: integ.companyId, entityId: card.id, status: "IGNORADO" }, select: { id: true } });
    if (!warned) {
      await logEvent(integ.companyId, type, card.id, "IGNORADO", `Card "${card.title}" ganho sem valor: a venda será criada quando o valor for preenchido no card.`);
      await wts(token, "crm", `/v1/panel/card/${encodeURIComponent(card.id)}/note`, {
        method: "POST",
        body: { text: "Frédy Gestão: preencha o valor do card para a venda ser criada automaticamente na gestão." },
      }).catch(() => {});
    }
    return;
  }
  const sale = await createSaleFromCard(integ, token, card, externalRef);
  if (sale) await logEvent(integ.companyId, type, card.id, "PROCESSADO", `Card "${card.title}" ganho → venda ${sale.code} criada como rascunho.`, sale.id);
}

function toIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

function fieldText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join(", ") || null;
  if (typeof v === "object" && "name" in (v as object)) return fieldText((v as { name: unknown }).name);
  return null;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

async function createSaleFromCard(integ: Integ, token: string, card: FredyCard, externalRef: string) {
  const companyId = integ.companyId;
  const map = JSON.parse(integ.fieldMapJson || "{}") as FieldMap;
  const cf = card.customFields ?? {};
  const pick = (k?: string) => (k ? cf[k] : undefined);

  // Vendedor: responsável do card (pelo e-mail do usuário no Frédy) → vendedor padrão → primeiro administrador.
  let sellerId: string | null = null;
  if (card.responsibleUserId) {
    const agent = await wts<{ email?: string | null }>(token, "core", `/v1/agent/${encodeURIComponent(card.responsibleUserId)}`).catch(() => null);
    if (agent?.email) sellerId = (await prisma.user.findFirst({ where: { companyId, active: true, email: agent.email.toLowerCase() }, select: { id: true } }))?.id ?? null;
  }
  sellerId ??= integ.defaultSellerId;
  sellerId ??= (await prisma.user.findFirst({ where: { companyId, role: "ADMIN", active: true }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
  if (!sellerId) throw new Error("Nenhum usuário ativo na agência para receber a venda.");
  const ctx = await loadContext(sellerId);
  if (!ctx) throw new Error("Vendedor sem acesso ativo.");

  // Cliente: vinculado ao contato do Frédy (id → e-mail → WhatsApp); se não existir, é criado.
  const contactId = card.contactIds?.[0] ?? card.contacts?.[0]?.id ?? null;
  const contact = contactId ? await wts<FredyContact>(token, "core", `/v1/contact/${encodeURIComponent(contactId)}`).catch(() => null) : null;
  const phone = digits(contact?.phoneNumber);
  const email = contact?.email?.trim().toLowerCase() || null;
  let client =
    (contactId && (await prisma.client.findFirst({ where: { companyId, fredyContactId: contactId } }))) ||
    (email && (await prisma.client.findFirst({ where: { companyId, email } }))) ||
    (phone.length >= 10 && (await prisma.client.findFirst({ where: { companyId, OR: [{ whatsapp: phone }, { phone }] } }))) ||
    null;
  const name = (contact?.name || card.contacts?.[0]?.name || card.title || "Cliente do Frédy").trim().slice(0, 150);
  if (!client) {
    client = await prisma.client.create({
      data: { companyId, name: name.length >= 2 ? name : "Cliente do Frédy", email, whatsapp: phone || null, fredyContactId: contactId, ownerId: sellerId },
    });
  } else if (contactId && !client.fredyContactId) {
    client = await prisma.client.update({ where: { id: client.id }, data: { fredyContactId: contactId } });
  }

  const priceCents = Math.max(0, Math.round((card.monetaryAmount ?? 0) * 100));
  const pax = parseInt(fieldText(pick(map.passengerCount)) ?? "", 10);
  const tripStart = toIsoDate(pick(map.tripStart));
  const tripEnd = toIsoDate(pick(map.tripEnd));
  try {
    const sale = await createSale(
      ctx,
      {
        saleDate: today(ctx),
        clientId: client.id,
        sellerId,
        destination: fieldText(pick(map.destination))?.slice(0, 120) ?? null,
        tripStart,
        tripEnd: tripEnd && tripStart && tripEnd < tripStart ? null : tripEnd,
        passengerCount: Number.isFinite(pax) && pax >= 1 && pax <= 500 ? pax : 1,
        notes: [`Venda criada pelo card #${card.number ?? ""} "${card.title}", ganho no CRM Frédy.`, "Confira a forma de pagamento e confirme a venda para gerar o financeiro e o contrato.", card.description?.slice(0, 1500)]
          .filter(Boolean)
          .join("\n"),
        commission: { mode: "VALOR", amountCents: 0 },
        items: [{ productType: integ.defaultProductType, description: card.title.slice(0, 300), priceCents, costCents: 0, commercialModel: "INTERMEDIACAO", supplierCommissionCents: 0 }],
        payments: [],
        passengers: [],
        confirm: false,
      },
      { origin: "FREDY", externalRef },
    );
    await prisma.$transaction((tx) => audit(tx, ctx, "venda.recebida_fredy", "Sale", sale.id, { cardId: card.id }));
    const base = publicBaseUrl();
    await wts(token, "crm", `/v1/panel/card/${encodeURIComponent(card.id)}/note`, {
      method: "POST",
      body: { text: `Venda ${sale.code} criada no Frédy Gestão (rascunho). O vendedor confere a forma de pagamento e confirma para gerar o contrato.${base ? `\n${base}/vendas/${sale.id}` : ""}` },
    }).catch(() => {});
    return sale;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; // outro evento simultâneo já criou
    throw e;
  }
}

type FredyContactEvent = { id: string; name?: string | null; email?: string | null; phonenumber?: string | null };

/** Contato atualizado no Frédy → atualiza nome, e-mail e WhatsApp do cliente vinculado. */
async function onContactUpdate(integ: Integ, c: FredyContactEvent) {
  const clients = await prisma.client.findMany({ where: { companyId: integ.companyId, fredyContactId: c.id }, select: { id: true } });
  if (clients.length === 0) return;
  const phone = digits(c.phonenumber?.split("|").join(""));
  const data: Prisma.ClientUpdateManyMutationInput = {};
  if (c.name && c.name.trim().length >= 2) data.name = c.name.trim().slice(0, 150);
  if (c.email) data.email = c.email.trim().toLowerCase();
  if (phone.length >= 10) data.whatsapp = phone;
  if (Object.keys(data).length === 0) return;
  await prisma.client.updateMany({ where: { companyId: integ.companyId, fredyContactId: c.id }, data });
  await logEvent(integ.companyId, "CONTACT_UPDATE", c.id, "PROCESSADO", `Contato atualizado no Frédy → ${clients.length} cliente(s) atualizado(s).`);
}

// ------------------------------ Gestão → Frédy ------------------------------
/** Entrega eventos da gestão no card do Frédy (só para vendas que vieram de um card). */
export async function deliverToFredy(companyId: string, event: { type: string; payloadJson: string }) {
  const integ = await prisma.fredyIntegration.findUnique({ where: { companyId } });
  if (!integ || !integ.syncBack) return;
  const payload = (JSON.parse(event.payloadJson) as { data?: { saleId?: string; settledCents?: number; amountCents?: number } }).data ?? {};
  if (!payload.saleId) return;
  const sale = await prisma.sale.findFirst({ where: { id: payload.saleId, companyId }, select: { id: true, code: true, externalRef: true, grossCents: true } });
  const cardId = sale?.externalRef?.startsWith("fredy:") ? sale.externalRef.slice(6) : null;
  if (!sale || !cardId) return;
  const token = decryptSecret(integ.tokenEnc);
  const base = publicBaseUrl();
  const link = base ? `\n${base}/vendas/${sale.id}` : "";
  if (event.type === "venda.confirmada") {
    await wts(token, "crm", `/v3/panel/card/${encodeURIComponent(cardId)}`, {
      method: "PUT",
      body: {
        fields: ["Status", "MonetaryAmount", ...(integ.wonStepId ? ["StepId"] : [])],
        status: "WON",
        monetaryAmount: sale.grossCents / 100,
        ...(integ.wonStepId ? { stepId: integ.wonStepId } : {}),
      },
    });
    await wts(token, "crm", `/v1/panel/card/${encodeURIComponent(cardId)}/note`, { method: "POST", body: { text: `Venda ${sale.code} confirmada no Frédy Gestão: ${formatBRL(sale.grossCents)}.${link}` } });
  } else if (event.type === "pagamento.identificado") {
    await wts(token, "crm", `/v1/panel/card/${encodeURIComponent(cardId)}/note`, { method: "POST", body: { text: `Pagamento recebido na venda ${sale.code}.${link}` } });
  }
}

export async function hasActiveFredy(companyId: string) {
  const i = await prisma.fredyIntegration.findUnique({ where: { companyId }, select: { syncBack: true, status: true } });
  return !!i && i.syncBack;
}

// ------------------------------ Tela do vendedor (popup) ------------------------------

/**
 * Lê o card do Frédy para pré-preencher a tela do vendedor: contato (nome, e-mail, telefone),
 * valor e os campos mapeados (destino, datas, passageiros). Só leitura.
 */
export async function fredyCardPrefill(ctx: Ctx, cardId: string) {
  const { integ, token } = await tokenFor(ctx.companyId);
  const card = await wts<FredyCard>(token, "crm", `/v2/panel/card/${encodeURIComponent(cardId)}`, { query: { IncludeDetails: CARD_DETAILS } }).catch(() => null);
  if (!card) throw new AppError("Card do Frédy não encontrado. Confira o link.", "NOT_FOUND");
  const map = JSON.parse(integ.fieldMapJson || "{}") as FieldMap;
  const cf = card.customFields ?? {};
  const pick = (k?: string) => (k ? cf[k] : undefined);
  const contactId = card.contactIds?.[0] ?? card.contacts?.[0]?.id ?? null;
  const contact = contactId ? await wts<FredyContact>(token, "core", `/v1/contact/${encodeURIComponent(contactId)}`).catch(() => null) : null;
  const pax = parseInt(fieldText(pick(map.passengerCount)) ?? "", 10);
  const existing = await prisma.sale.findFirst({ where: { companyId: ctx.companyId, externalRef: `fredy:${card.id}` }, select: { id: true, code: true, status: true } });
  return {
    cardId: card.id,
    title: card.title,
    priceCents: Math.max(0, Math.round((card.monetaryAmount ?? 0) * 100)),
    destination: fieldText(pick(map.destination))?.slice(0, 120) ?? null,
    tripStart: toIsoDate(pick(map.tripStart)),
    tripEnd: toIsoDate(pick(map.tripEnd)),
    passengerCount: Number.isFinite(pax) && pax >= 1 && pax <= 500 ? pax : null,
    contact: contact ? { id: contact.id, name: contact.name?.trim() || null, email: contact.email?.trim().toLowerCase() || null, phone: digits(contact.phoneNumber) || null } : null,
    existingSale: existing,
  };
}

/** Garante que o card existe e ainda não virou venda, para a venda feita na tela do vendedor ficar ligada a ele. */
export async function assertCardAvailable(ctx: Ctx, cardId: string) {
  const p = await fredyCardPrefill(ctx, cardId);
  if (p.existingSale) throw new AppError(`Este card já virou a venda ${p.existingSale.code}.`, "CONFLICT");
  return { meta: { origin: "FREDY" as const, externalRef: `fredy:${p.cardId}` }, contactId: p.contact?.id ?? null };
}

// ------------------------------ Envio de arquivo na conversa (venda rápida) ------------------------------
type FredySession = { id: string; status: string; contactId?: string | null; previewUrl?: string | null; windowStatus?: string | null; lastInteractionDate?: string | null; updatedAt?: string | null };

/** Contato do cliente no Frédy: o já ligado ao cadastro, o do card ou, por último, pelo telefone. */
async function findContactId(token: string, who: { contactId?: string | null; cardId?: string | null; phone?: string | null }) {
  if (who.contactId) return who.contactId;
  if (who.cardId) {
    const card = await wts<FredyCard>(token, "crm", `/v2/panel/card/${encodeURIComponent(who.cardId)}`, { query: { IncludeDetails: ["Contacts"] } }).catch(() => null);
    const id = card?.contactIds?.[0] ?? card?.contacts?.[0]?.id;
    if (id) return id;
  }
  const d = digits(who.phone);
  if (d.length >= 10) {
    for (const p of [d.length <= 11 ? `55${d}` : d, d.length <= 11 ? `+55${d}` : `+${d}`]) {
      const c = await wts<FredyContact>(token, "core", `/v1/contact/phonenumber/${encodeURIComponent(p)}`).catch(() => null);
      if (c?.id) return c.id;
    }
  }
  return null;
}

/**
 * Manda um arquivo (ex.: o PDF do contrato) na conversa aberta do cliente no Frédy.
 * Pelas regras do WhatsApp, só dá para mandar arquivo dentro de um atendimento em andamento; sem ele, avisa o atendente.
 */
export async function sendFileToClientChat(
  ctx: Ctx,
  who: { contactId?: string | null; cardId?: string | null; phone?: string | null },
  file: { bytes: Uint8Array; name: string; mimeType: string; type: "PDF" | "IMAGE" | "DOCUMENT" },
  text: string,
) {
  const { token } = await tokenFor(ctx.companyId);
  const contactId = await findContactId(token, who);
  if (!contactId) throw new AppError("Não achei este cliente no Frédy. Confira o WhatsApp no cadastro ou abra pelo link do card.");
  const sessions = await wts<Paged<FredySession>>(token, "chat", "/v2/session", {
    query: { ContactId: contactId, Status: ["IN_PROGRESS", "PENDING", "STARTED"], PageSize: 20 },
  });
  const open = (sessions.items ?? []).sort((a, b) => String(b.lastInteractionDate ?? b.updatedAt ?? "").localeCompare(String(a.lastInteractionDate ?? a.updatedAt ?? "")))[0];
  if (!open) throw new AppError("O cliente não tem atendimento aberto no Frédy. Abra a conversa com ele no Frédy e clique de novo.");
  if (open.windowStatus === "EXPIRED") throw new AppError("A janela de 24 horas do WhatsApp com este cliente fechou. Peça para ele responder no Frédy e clique de novo.");

  // upload: pega a URL temporária, envia o arquivo e registra (o ID serve para o envio)
  const up = await wts<{ tempFileId: string; urlUpload: string }>(token, "core", "/v2/file", { query: { Type: file.type, Name: file.name, MimeType: file.mimeType } });
  const put = await fetch(up.urlUpload, { method: "PUT", headers: { "Content-Type": file.mimeType }, body: Buffer.from(file.bytes), signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!put || !put.ok) throw new AppError("Não foi possível enviar o arquivo para o Frédy agora. Tente de novo.");
  const saved = await wts<{ id: string }>(token, "core", "/v2/file", { method: "POST", body: { tempFileId: up.tempFileId } });

  const msg = await wts<{ id: string; status?: string; failureReason?: string | null }>(token, "chat", `/v1/session/${encodeURIComponent(open.id)}/message`, {
    method: "POST",
    body: { text, fileId: saved.id },
  });
  if (msg?.status === "FAILED") throw new AppError(`O Frédy não conseguiu entregar: ${msg.failureReason ?? "motivo não informado"}.`);
  return { sessionId: open.id, previewUrl: open.previewUrl ?? null, contactId, status: msg?.status ?? null };
}

/** Anotação no card do Frédy (ex.: atendimento concluído na venda rápida). Falha não interrompe quem chamou. */
export async function noteOnCard(companyId: string, cardId: string, text: string) {
  const integ = await prisma.fredyIntegration.findUnique({ where: { companyId } });
  if (!integ) return false;
  await wts(decryptSecret(integ.tokenEnc), "crm", `/v1/panel/card/${encodeURIComponent(cardId)}/note`, { method: "POST", body: { text } });
  return true;
}

/** Integração com o Frédy conectada (token salvo): libera o envio do contrato pela conversa. */
export async function fredyConnected(companyId: string) {
  return !!(await prisma.fredyIntegration.findUnique({ where: { companyId }, select: { id: true } }));
}
