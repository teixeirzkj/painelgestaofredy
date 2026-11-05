/**
 * Assinatura eletrônica pela ZapSign (API v1, conforme docs.zapsign.com.br).
 *
 * - A conta ZapSign é da plataforma (token em ZAPSIGN_API_TOKEN); cada envio fica registrado por agência
 *   (SignatureRequest) e gera na agência a despesa do envio (ZAPSIGN_COST_CENTS, padrão R$ 1,00, categoria Sistemas).
 * - O contrato só vira "Assinado" quando a ZapSign confirma: o webhook avisa e o sistema consulta o documento
 *   na API antes de marcar (o conteúdo do webhook não é aceito sozinho).
 * - O PDF assinado é baixado e anexado à venda.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db";
import { assertCan, today, type Ctx } from "../context";
import { audit } from "../audit";
import { AppError } from "../errors";
import { applySignatureCallback, getContract } from "./contracts";
import { saveFile } from "../storage";
import { publicBaseUrl } from "./fredy";
import { formatBRL } from "@/lib/money";
import { onlyDigits } from "@/lib/utils";

const PROVIDER = "ZAPSIGN";
const WEBHOOK_SETTING = "zapsign.webhook";
const WEBHOOK_HEADER = "X-Fredy-Webhook-Secret";

function apiUrl() {
  return (process.env.ZAPSIGN_API_URL?.trim() || "https://api.zapsign.com.br/api/v1").replace(/\/+$/, "");
}
export function zapsignConfigured() {
  return !!process.env.ZAPSIGN_API_TOKEN?.trim();
}
export function signatureCostCents() {
  const v = parseInt(process.env.ZAPSIGN_COST_CENTS ?? "", 10);
  return Number.isFinite(v) && v >= 0 ? v : 100;
}
/** Segredo do webhook derivado do AUTH_SECRET (não exige variável extra). */
export function zapsignWebhookSecret() {
  const base = process.env.AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("AUTH_SECRET ausente.");
  return createHmac("sha256", base).update("zapsign-webhook").digest("hex");
}
export function checkWebhookSecret(given: string | null) {
  const expected = zapsignWebhookSecret();
  return !!given && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function zs<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = process.env.ZAPSIGN_API_TOKEN?.trim();
  if (!token) throw new AppError("A assinatura online ainda não está ativada: falta configurar o token da ZapSign (ZAPSIGN_API_TOKEN).");
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
  } catch {
    throw new AppError("Não foi possível falar com a ZapSign agora. Tente de novo em instantes.");
  }
  if (res.status === 401 || res.status === 403) throw new AppError("A ZapSign recusou o token da API. Confira ZAPSIGN_API_TOKEN.");
  if (!res.ok) {
    const txt = (await res.text().catch(() => "")).slice(0, 300);
    throw new AppError(`A ZapSign respondeu com erro (HTTP ${res.status})${txt ? `: ${txt}` : "."}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

type ZsSigner = { token: string; sign_url: string; status: string; name: string; email?: string; signed_at?: string | null };
type ZsDoc = { token: string; status: "pending" | "signed" | string; external_id?: string | null; signed_file?: string | null; signers: ZsSigner[] };

/** Texto do contrato → Markdown que preserva as quebras de linha (formato aceito pela ZapSign). */
export function contractToMarkdown(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/([\\*_#`>[\]|])/g, "\\$1"))
    .map((l) => (l.trim() === "" ? "" : `${l}  `))
    .join("\n");
}

/** Garante a assinatura de webhook da plataforma na ZapSign (uma vez). */
async function ensureWebhook() {
  if (await prisma.platformSetting.findUnique({ where: { key: WEBHOOK_SETTING } })) return;
  const base = publicBaseUrl();
  if (!base) return; // ambiente local: sem endereço público, o status é atualizado pelo botão "Consultar status"
  const r = await zs<{ id: number | string }>("/user/company/webhook/", {
    method: "POST",
    body: { url: `${base}/api/integracoes/zapsign/webhook`, type: "", headers: [{ name: WEBHOOK_HEADER, value: zapsignWebhookSecret() }] },
  });
  await prisma.platformSetting.upsert({ where: { key: WEBHOOK_SETTING }, create: { key: WEBHOOK_SETTING, value: String(r?.id ?? "ok") }, update: { value: String(r?.id ?? "ok") } });
}

const sendSchema = z.object({ whatsapp: z.boolean().default(false), signAgency: z.boolean().default(true) });

/** Envia o contrato emitido para assinatura do cliente (e da agência, se houver responsável com e-mail). */
export async function sendContractToZapSign(ctx: Ctx, contractId: string, raw: unknown = {}) {
  assertCan(ctx, "contracts.manage");
  const opts = sendSchema.parse(raw ?? {});
  const c = await getContract(ctx, contractId);
  if (c.status !== "AGUARDANDO_ENVIO") throw new AppError("Emita o contrato antes de enviar para assinatura.");
  if (c.outdated) throw new AppError("A venda mudou depois da emissão. Atualize a prévia e emita de novo.");
  if (!c.content) throw new AppError("Contrato sem conteúdo.");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  const cl = c.sale.client;
  const email = cl.email?.trim() || null;
  let phone = onlyDigits(cl.whatsapp || cl.phone || "");
  if (phone.length >= 12 && phone.startsWith("55")) phone = phone.slice(2);
  if (!email && !(opts.whatsapp && phone.length >= 10))
    throw new AppError("O cliente precisa de e-mail (ou WhatsApp, marcando o envio por WhatsApp) para receber o contrato.");

  const signers: Record<string, unknown>[] = [
    {
      name: cl.name,
      ...(email ? { email, send_automatic_email: true, lock_email: true } : { blank_email: true }),
      ...(phone.length >= 10 ? { phone_country: "55", phone_number: phone } : {}),
      ...(opts.whatsapp && phone.length >= 10 ? { send_automatic_whatsapp: true } : {}),
      auth_mode: "assinaturaTela",
      ...(cl.document?.length === 11 ? { cpf: cl.document } : {}),
      external_id: `cliente:${cl.id}`,
    },
  ];
  const agencyEmail = company.contactEmail?.trim();
  if (opts.signAgency && company.responsibleName && agencyEmail)
    signers.push({ name: company.responsibleName, email: agencyEmail, send_automatic_email: true, auth_mode: "assinaturaTela", qualification: "contratada", external_id: `agencia:${company.id}` });

  await ensureWebhook();
  const doc = await zs<ZsDoc>("/docs/", {
    method: "POST",
    body: {
      name: `Contrato ${c.sale.code} v${c.version} - ${cl.name}`.slice(0, 255),
      markdown_text: contractToMarkdown(c.content),
      lang: "pt-br",
      brand_name: (company.tradeName || company.name).slice(0, 100),
      external_id: c.id,
      signers,
      metadata: [
        { key: "companyId", value: company.id },
        { key: "saleCode", value: c.sale.code },
      ],
    },
  });
  if (!doc?.token) throw new AppError("A ZapSign não devolveu o documento criado.");
  const signUrl = doc.signers?.[0]?.sign_url ?? null;
  const cost = signatureCostCents();
  await applySignatureCallback({ companyId: ctx.companyId, contractId: c.id, externalId: doc.token, provider: PROVIDER, event: "sent" });
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id: c.id }, data: { signUrl } });
    await tx.signatureRequest.create({ data: { companyId: ctx.companyId, contractId: c.id, saleId: c.saleId, provider: PROVIDER, externalId: doc.token, costCents: cost, status: "ENVIADO" } });
    if (cost > 0)
      await tx.payable.upsert({
        where: { companyId_sourceKey: { companyId: ctx.companyId, sourceKey: `assinatura:${doc.token}` } },
        create: {
          companyId: ctx.companyId,
          sourceKey: `assinatura:${doc.token}`,
          origin: "ASSINATURA",
          saleId: c.saleId,
          description: `Assinatura online do contrato ${c.sale.code} (ZapSign)`,
          category: "SISTEMAS",
          amountCents: cost,
          dueDate: today(ctx),
          status: "PENDENTE",
        },
        update: {},
      });
    await audit(tx, ctx, "contrato.enviado_assinatura", "Contract", c.id, { provider: PROVIDER, token: doc.token, custo: formatBRL(cost) });
  });
  return { signUrl };
}

/** Consulta o documento na ZapSign e aplica o resultado (usado pelo webhook e pelo botão "Consultar status"). */
export async function syncZapSignDocument(docToken: string) {
  const req = await prisma.signatureRequest.findUnique({ where: { externalId: docToken } });
  if (!req) return { found: false as const };
  const doc = await zs<ZsDoc>(`/docs/${encodeURIComponent(docToken)}/`);
  if (doc.status !== "signed") return { found: true as const, status: doc.status };
  if (req.status === "ASSINADO") return { found: true as const, status: "signed" };
  await applySignatureCallback({ companyId: req.companyId, contractId: req.contractId, externalId: docToken, provider: PROVIDER, event: "signed" });
  await prisma.signatureRequest.update({ where: { id: req.id }, data: { status: "ASSINADO", signedAt: new Date() } });
  // arquiva o PDF assinado na venda (o link da ZapSign expira em 60 minutos)
  if (doc.signed_file) {
    try {
      const res = await fetch(doc.signed_file, { signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        const key = await saveFile(req.companyId, bytes, "pdf");
        const sale = await prisma.sale.findUnique({ where: { id: req.saleId }, select: { code: true } });
        await prisma.attachment.create({
          data: { companyId: req.companyId, saleId: req.saleId, kind: "DOCUMENTO", fileName: `Contrato assinado ${sale?.code ?? ""}.pdf`.trim(), mimeType: "application/pdf", sizeBytes: bytes.length, storageKey: key },
        });
      }
    } catch (e) {
      console.error("zapsign: falha ao arquivar PDF assinado", e);
    }
  }
  return { found: true as const, status: "signed" };
}

/** Recusa do signatário: o contrato é cancelado (pode ser reaberto como nova versão). */
export async function refuseZapSignDocument(docToken: string) {
  const req = await prisma.signatureRequest.findUnique({ where: { externalId: docToken } });
  if (!req || req.status !== "ENVIADO") return;
  await applySignatureCallback({ companyId: req.companyId, contractId: req.contractId, externalId: docToken, provider: PROVIDER, event: "cancelled" });
  await prisma.signatureRequest.update({ where: { id: req.id }, data: { status: "RECUSADO" } });
}

/** Botão "Consultar status" na tela do contrato. */
export async function checkContractSignature(ctx: Ctx, contractId: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, contractId);
  if (c.signatureProvider !== PROVIDER || !c.externalId) throw new AppError("Este contrato não foi enviado pela ZapSign.");
  const r = await syncZapSignDocument(c.externalId);
  return { signed: r.found && r.status === "signed" };
}

/** Uso por agência e mês (painel da plataforma: base para cobrança). */
export async function signatureUsageByCompany(month: string) {
  const start = new Date(`${month}-01T00:00:00-03:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const rows = await prisma.signatureRequest.groupBy({ by: ["companyId"], where: { createdAt: { gte: start, lt: end } }, _count: { _all: true }, _sum: { costCents: true } });
  return new Map(rows.map((r) => [r.companyId, { count: r._count._all, costCents: r._sum.costCents ?? 0 }]));
}
