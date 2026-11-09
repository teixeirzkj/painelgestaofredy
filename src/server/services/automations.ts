import { createHmac } from "node:crypto";
import { prisma, type Tx } from "../db";
import { assertCan, today, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { deliverToFredy, hasActiveFredy } from "./fredy";
import { assertPublicHttpsUrl } from "../net-guard";

/**
 * Automações prontas. Cada automação pode ser ativada/desativada pela agência.
 * As automações "core" (lançamentos financeiros da venda) sempre executam e aparecem como fixas.
 *
 * Eventos são gravados na tabela AutomationEvent com chave de idempotência única por empresa:
 * o mesmo fato nunca gera dois eventos. A entrega acontece por adaptadores desacoplados
 * (webhook genérico configurável ou consulta pela API /api/v1/events). Nenhum endpoint do
 * Frédy é presumido.
 */
export const AUTOMATIONS = [
  {
    key: "venda_confirmada.financeiro",
    group: "Venda confirmada",
    title: "Gerar lançamentos financeiros",
    description: "Cria parcelas a receber, contas a pagar aos fornecedores e a comissão do vendedor, sem duplicidade.",
    core: true,
    defaultEnabled: true,
  },
  {
    key: "venda_confirmada.contrato",
    group: "Venda confirmada",
    title: "Preparar contrato",
    description: "Seleciona o modelo pelo tipo de produto, preenche os dados da venda e deixa a prévia pronta para conferência.",
    core: false,
    defaultEnabled: true,
  },
  {
    key: "venda_confirmada.evento",
    group: "Venda confirmada",
    title: "Disparar evento de venda confirmada",
    description: "Publica o evento venda.confirmada para integrações (ex.: mover card no CRM Frédy).",
    core: false,
    defaultEnabled: true,
    eventType: "venda.confirmada",
  },
  {
    key: "contrato_assinado.evento",
    group: "Contrato assinado",
    title: "Atualizar status e preparar próxima etapa",
    description: "Ao receber a confirmação do provedor de assinatura, marca o contrato como assinado e publica contrato.assinado.",
    core: false,
    defaultEnabled: true,
    eventType: "contrato.assinado",
  },
  {
    key: "pagamento_identificado.evento",
    group: "Pagamento identificado",
    title: "Atualizar venda e publicar evento",
    description: "Ao baixar um recebimento, atualiza a situação financeira da venda e publica pagamento.identificado.",
    core: false,
    defaultEnabled: true,
    eventType: "pagamento.identificado",
  },
  {
    key: "viagem_concluida.evento",
    group: "Viagem concluída",
    title: "Marcar venda como concluída",
    description: "No dia seguinte ao retorno, marca a venda como concluída e publica viagem.concluida.",
    core: false,
    defaultEnabled: false,
    eventType: "viagem.concluida",
  },
] as const;

/** Dados do cliente para quem envia a mensagem (n8n, CRM). Telefone com DDI 55 quando vier sem. */
export function clientContact(c: { id: string; name: string; whatsapp: string | null; phone: string | null; email: string | null; fredyContactId: string | null; consentMessaging: boolean }) {
  const digits = (c.whatsapp || c.phone || "").replace(/\D/g, "");
  const whatsapp = digits ? (digits.length <= 11 ? "55" + digits : digits) : null;
  return { id: c.id, name: c.name, firstName: c.name.split(/\s+/)[0], whatsapp, email: c.email, fredyContactId: c.fredyContactId };
}

export type AutomationKey = (typeof AUTOMATIONS)[number]["key"];

export async function isAutomationEnabled(tx: Tx | typeof prisma, companyId: string, key: AutomationKey): Promise<boolean> {
  const def = AUTOMATIONS.find((a) => a.key === key)!;
  if (def.core) return true;
  const s = await tx.automationSetting.findUnique({ where: { companyId_key: { companyId, key } } });
  return s ? s.enabled : def.defaultEnabled;
}

export async function listAutomationSettings(ctx: Ctx) {
  const settings = await prisma.automationSetting.findMany({ where: { companyId: ctx.companyId } });
  return AUTOMATIONS.map((a) => ({
    ...a,
    enabled: a.core ? true : settings.find((s) => s.key === a.key)?.enabled ?? a.defaultEnabled,
  }));
}

export async function setAutomationEnabled(ctx: Ctx, key: string, enabled: boolean) {
  assertCan(ctx, "automations.manage");
  const def = AUTOMATIONS.find((a) => a.key === key);
  if (!def || def.core) throw new AppError("Automação inválida.");
  await prisma.$transaction(async (tx) => {
    await tx.automationSetting.upsert({
      where: { companyId_key: { companyId: ctx.companyId, key } },
      create: { companyId: ctx.companyId, key, enabled },
      update: { enabled },
    });
    await audit(tx, ctx, enabled ? "automacao.ativada" : "automacao.desativada", "AutomationSetting", key);
  });
}

/** Registra um evento de forma idempotente. Retorna false se já existia ou se a automação está desativada. */
export async function emitEvent(
  tx: Tx,
  companyId: string,
  automation: AutomationKey,
  e: { type: string; entityType: string; entityId: string; idempotencyKey: string; payload: unknown },
): Promise<boolean> {
  if (!(await isAutomationEnabled(tx, companyId, automation))) return false;
  const existing = await tx.automationEvent.findUnique({
    where: { companyId_idempotencyKey: { companyId, idempotencyKey: e.idempotencyKey } },
  });
  if (existing) return false;
  await tx.automationEvent.create({
    data: {
      companyId,
      type: e.type,
      entityType: e.entityType,
      entityId: e.entityId,
      idempotencyKey: e.idempotencyKey,
      payloadJson: JSON.stringify({ type: e.type, occurredAt: new Date().toISOString(), data: e.payload }),
      status: "PENDENTE",
    },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Adaptadores de entrega (desacoplados). O do Frédy usa só endpoints documentados da API WTS.
// ---------------------------------------------------------------------------

export interface EventDeliveryAdapter {
  name: string;
  isConfigured(): boolean;
  deliver(event: { id: string; type: string; payloadJson: string }): Promise<void>;
}

/** Webhook genérico configurado pela agência, assinado com HMAC-SHA256 (cabeçalho X-Fredy-Signature). */
export class WebhookAdapter implements EventDeliveryAdapter {
  name = "webhook";
  constructor(private url: string | null, private secret: string | null) {}
  isConfigured() {
    return !!this.url;
  }
  async deliver(event: { id: string; type: string; payloadJson: string }) {
    const signature = this.secret ? createHmac("sha256", this.secret).update(event.payloadJson).digest("hex") : "";
    await assertPublicHttpsUrl(this.url!); // nada de rede interna (SSRF)
    const res = await fetch(this.url!, {
      redirect: "manual",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Fredy-Event": event.type,
        "X-Fredy-Event-Id": event.id,
        "X-Fredy-Signature": signature,
      },
      body: event.payloadJson,
      signal: AbortSignal.timeout(10000),
    });
    if (res.status >= 300 && res.status < 400) throw new AppError("O endereço respondeu com redirecionamento: use a URL final do webhook.");
    if (!res.ok) throw new AppError(`HTTP ${res.status}`);
  }
}

/** CRM Frédy (API WTS): venda confirmada marca o card como ganho, com valor e nota; pagamento recebido vira nota. */
export class FredyCrmAdapter implements EventDeliveryAdapter {
  name = "fredy-crm";
  constructor(private companyId: string, private active: boolean) {}
  isConfigured() {
    return this.active;
  }
  async deliver(event: { id: string; type: string; payloadJson: string }) {
    await deliverToFredy(this.companyId, event);
  }
}

/** Entrega eventos pendentes pelos adaptadores configurados. Eventos sem destino ficam disponíveis na API. */
export async function dispatchPendingEvents(companyId: string, limit = 50) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const adapters: EventDeliveryAdapter[] = [new WebhookAdapter(company.webhookUrl, company.webhookSecret), new FredyCrmAdapter(companyId, await hasActiveFredy(companyId))].filter(
    (a) => a.isConfigured(),
  );
  if (adapters.length === 0) return { delivered: 0, failed: 0, skipped: true };
  const events = await prisma.automationEvent.findMany({
    where: { companyId, status: { in: ["PENDENTE", "FALHOU"] }, attempts: { lt: 5 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let delivered = 0;
  let failed = 0;
  for (const ev of events) {
    try {
      for (const a of adapters) await a.deliver(ev);
      await prisma.automationEvent.update({
        where: { id: ev.id },
        data: { status: "ENTREGUE", deliveredAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      delivered++;
    } catch (err) {
      await prisma.automationEvent.update({
        where: { id: ev.id },
        data: { status: "FALHOU", attempts: { increment: 1 }, lastError: String((err as Error).message).slice(0, 300) },
      });
      failed++;
    }
  }
  return { delivered, failed, skipped: false };
}

/**
 * Varredura periódica (cron ou botão "Executar agora"): gera eventos baseados em datas.
 * Idempotente: pode ser executada várias vezes por dia sem duplicar eventos.
 */
export async function runScheduledAutomations(companyId: string, todayStr?: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const t = todayStr ?? today(company);
  const result = { concluidas: 0 };

  await prisma.$transaction(async (tx) => {
    // Viagens concluídas
    if (await isAutomationEnabled(tx, companyId, "viagem_concluida.evento")) {
      const done = await tx.sale.findMany({
        where: { companyId, status: "CONFIRMADA", tripEnd: { lt: t } },
        include: { client: true, seller: { select: { name: true } } },
      });
      for (const s of done) {
        await tx.sale.update({ where: { id: s.id }, data: { status: "CONCLUIDA" } });
        await emitEvent(tx, companyId, "viagem_concluida.evento", {
          type: "viagem.concluida",
          entityType: "Sale",
          entityId: s.id,
          idempotencyKey: `viagem.concluida:${s.id}`,
          payload: {
            saleId: s.id,
            saleCode: s.code,
            destination: s.destination,
            tripEnd: s.tripEnd,
            sellerName: s.seller?.name ?? null,
            agencyName: company.tradeName || company.name,
            client: clientContact(s.client),
            messagingAllowed: s.client.consentMessaging,
          },
        });
        result.concluidas++;
      }
    }
  });
  const dispatch = await dispatchPendingEvents(companyId);
  return { ...result, dispatch };
}

export async function listEvents(ctx: Ctx, opts: { page?: number; type?: string } = {}) {
  assertCan(ctx, "automations.manage");
  const where = { companyId: ctx.companyId, ...(opts.type ? { type: opts.type } : {}) };
  const page = Math.max(1, opts.page ?? 1);
  const [items, total] = await Promise.all([
    prisma.automationEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25 }),
    prisma.automationEvent.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / 25)) };
}

/** Envia um evento de exemplo ao webhook da agência. Não grava nada. */
export async function sendTestWebhook(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  if (!company.webhookUrl) throw new AppError("Salve a URL do webhook antes de testar.");
  const payloadJson = JSON.stringify({
    type: "venda.confirmada",
    occurredAt: new Date().toISOString(),
    test: true,
    data: { saleId: "exemplo", saleCode: "V-0000", grossCents: 100000, client: { id: "exemplo", name: "Maria Exemplo da Silva", fredyContactId: null } },
  });
  try {
    await new WebhookAdapter(company.webhookUrl, company.webhookSecret).deliver({ id: "teste", type: "venda.confirmada", payloadJson });
  } catch (e) {
    throw new AppError(`O webhook não aceitou o evento de teste (${(e as Error).message}). Confira a URL e se o destino está ativo.`);
  }
}
