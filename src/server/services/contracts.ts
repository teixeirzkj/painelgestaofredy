import { z } from "zod";
import { prisma, type Tx } from "../db";
import { assertCan, can, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { emitEvent, isAutomationEnabled } from "./automations";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYMENT_METHODS, PRODUCT_TYPES } from "@/lib/constants";
import { formatDocument } from "@/lib/utils";
import { PRODUCT_TYPES as PT } from "@/lib/constants";
import { SUGGESTED_TEMPLATES, SUGGESTED_TEMPLATE_BODY } from "./contract-defaults";

/** Variáveis disponíveis nos modelos de contrato. */
export const CONTRACT_VARIABLES: { key: string; label: string; required?: boolean }[] = [
  { key: "agencia.nome", label: "Nome da agência", required: true },
  { key: "agencia.documento", label: "CNPJ da agência" },
  { key: "cliente.nome", label: "Nome do cliente", required: true },
  { key: "cliente.documento", label: "CPF/CNPJ do cliente", required: true },
  { key: "cliente.endereco", label: "Endereço do cliente", required: true },
  { key: "cliente.email", label: "E-mail do cliente" },
  { key: "cliente.telefone", label: "Telefone do cliente" },
  { key: "venda.codigo", label: "Código da venda", required: true },
  { key: "venda.data", label: "Data da venda", required: true },
  { key: "venda.destino", label: "Destino", required: true },
  { key: "venda.inicio", label: "Data de início da viagem", required: true },
  { key: "venda.retorno", label: "Data de retorno" },
  { key: "venda.passageiros", label: "Quantidade de passageiros" },
  { key: "venda.localizador", label: "Localizador" },
  { key: "venda.valor_total", label: "Valor total", required: true },
  { key: "venda.produtos", label: "Lista de produtos", required: true },
  { key: "venda.pagamento", label: "Condições de pagamento", required: true },
  { key: "venda.lista_passageiros", label: "Lista de passageiros" },
  { key: "vendedor.nome", label: "Vendedor" },
  { key: "clausulas", label: "Cláusulas específicas do produto" },
];

type SaleForContract = NonNullable<Awaited<ReturnType<typeof loadSaleForContract>>>;

async function loadSaleForContract(tx: Tx, companyId: string, saleId: string) {
  return tx.sale.findFirst({
    where: { id: saleId, companyId },
    include: {
      company: true,
      client: true,
      seller: { select: { name: true } },
      items: { include: { supplier: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
      passengers: true,
    },
  });
}

export function buildVariables(sale: SaleForContract): Record<string, string> {
  const c = sale.client;
  const address = [c.street && `${c.street}${c.number ? `, ${c.number}` : ""}`, c.complement, c.district, c.city && `${c.city}${c.state ? `/${c.state}` : ""}`, c.zipCode && `CEP ${c.zipCode}`]
    .filter(Boolean)
    .join(" - ");
  const plan = JSON.parse(sale.paymentPlanJson) as { dueDate: string; amountCents: number; method: string }[];
  return {
    "agencia.nome": sale.company.name,
    "agencia.documento": sale.company.document ? formatDocument(sale.company.document) : "",
    "cliente.nome": c.name,
    "cliente.documento": c.document ? formatDocument(c.document) : "",
    "cliente.endereco": c.street && c.city ? address : "",
    "cliente.email": c.email ?? "",
    "cliente.telefone": c.whatsapp ?? c.phone ?? "",
    "venda.codigo": sale.code,
    "venda.data": formatDate(sale.saleDate),
    "venda.destino": sale.destination ?? "",
    "venda.inicio": sale.tripStart ? formatDate(sale.tripStart) : "",
    "venda.retorno": sale.tripEnd ? formatDate(sale.tripEnd) : "",
    "venda.passageiros": String(sale.passengerCount),
    "venda.localizador": sale.locator ?? "",
    "venda.valor_total": formatBRL(sale.grossCents),
    "venda.produtos": sale.items
      .map((i) => `- ${PRODUCT_TYPES.label(i.productType)}${i.description ? `: ${i.description}` : ""}${i.supplier ? ` (fornecedor: ${i.supplier.name})` : ""}${i.locator ? ` — localizador ${i.locator}` : ""} — ${formatBRL(i.priceCents)}`)
      .join("\n"),
    "venda.pagamento": plan.length
      ? plan.map((p, idx) => `${idx + 1}) ${formatBRL(p.amountCents)} em ${formatDate(p.dueDate)} via ${PAYMENT_METHODS.label(p.method)}`).join("\n")
      : "",
    "venda.lista_passageiros": sale.passengers.map((p) => `- ${p.name}`).join("\n"),
    "vendedor.nome": sale.seller.name,
  };
}

export function renderTemplate(body: string, clauses: string, vars: Record<string, string>) {
  const missing = new Set<string>();
  const used = new Set<string>();
  const fill = (text: string) =>
    text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_, key: string) => {
      used.add(key);
      const v = vars[key];
      if (!v) {
        const def = CONTRACT_VARIABLES.find((d) => d.key === key);
        if (def?.required) missing.add(def.label);
        return `[${def?.label ?? key} não informado]`;
      }
      return v;
    });
  const renderedClauses = fill(clauses);
  const content = fill(body.replace(/\{\{\s*clausulas\s*\}\}/g, renderedClauses));
  return { content, missing: [...missing] };
}

async function pickTemplate(tx: Tx, companyId: string, productType: string) {
  return (
    (await tx.contractTemplate.findFirst({ where: { companyId, productType, active: true }, orderBy: { updatedAt: "desc" } })) ??
    (await tx.contractTemplate.findFirst({ where: { companyId, productType: "OUTROS", active: true }, orderBy: { updatedAt: "desc" } }))
  );
}

/**
 * Prepara (ou atualiza) o contrato da venda. Chamado ao confirmar/alterar uma venda.
 * - Em preparação: re-renderiza a prévia.
 * - Já emitido/enviado/assinado: não altera o conteúdo; marca como desatualizado para conferência.
 */
export async function prepareContractForSale(tx: Tx, companyId: string, saleId: string) {
  if (!(await isAutomationEnabled(tx, companyId, "venda_confirmada.contrato"))) return;
  const sale = await loadSaleForContract(tx, companyId, saleId);
  if (!sale) return;
  const existing = await tx.contract.findUnique({ where: { companyId_saleId: { companyId, saleId } } });
  if (existing && existing.status !== "EM_PREPARACAO" && existing.status !== "NAO_GERADO") {
    if (existing.status !== "CANCELADO") await tx.contract.update({ where: { id: existing.id }, data: { outdated: true } });
    return;
  }
  const template = await pickTemplate(tx, companyId, sale.mainProductType);
  if (!template) {
    await tx.contract.upsert({
      where: { companyId_saleId: { companyId, saleId } },
      create: { companyId, saleId, status: "NAO_GERADO", missingFieldsJson: JSON.stringify(["Modelo de contrato para o produto"]) },
      update: { status: "NAO_GERADO", missingFieldsJson: JSON.stringify(["Modelo de contrato para o produto"]) },
    });
    return;
  }
  const { content, missing } = renderTemplate(template.body, template.clauses, buildVariables(sale));
  await tx.contract.upsert({
    where: { companyId_saleId: { companyId, saleId } },
    create: {
      companyId,
      saleId,
      templateId: template.id,
      templateVersion: template.version,
      status: "EM_PREPARACAO",
      content,
      missingFieldsJson: JSON.stringify(missing),
    },
    update: {
      templateId: template.id,
      templateVersion: template.version,
      status: "EM_PREPARACAO",
      content,
      missingFieldsJson: JSON.stringify(missing),
    },
  });
}

function visibleSaleWhere(ctx: Ctx) {
  return can(ctx, "sales.view_all") ? {} : { sellerId: ctx.userId };
}

export async function listContracts(ctx: Ctx, opts: { status?: string; q?: string } = {}) {
  return prisma.contract.findMany({
    where: {
      companyId: ctx.companyId,
      ...(opts.status ? { status: opts.status } : {}),
      sale: {
        ...visibleSaleWhere(ctx),
        ...(opts.q ? { OR: [{ code: { contains: opts.q } }, { client: { name: { contains: opts.q } } }] } : {}),
      },
    },
    include: { sale: { select: { id: true, code: true, destination: true, mainProductType: true, client: { select: { name: true } } } }, template: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export async function getContract(ctx: Ctx, id: string) {
  const c = await prisma.contract.findFirst({
    where: { id, companyId: ctx.companyId, sale: visibleSaleWhere(ctx) },
    include: { sale: { include: { client: true } }, template: true },
  });
  if (!c) throw new AppError("Contrato não encontrado.", "NOT_FOUND");
  return c;
}

/** Atualiza a prévia com os dados atuais da venda (somente antes do envio). */
export async function refreshContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  if (!["NAO_GERADO", "EM_PREPARACAO", "AGUARDANDO_ENVIO"].includes(c.status))
    throw new AppError("Contrato já enviado: não é possível regenerar. Cancele e gere uma nova versão.");
  await prisma.$transaction(async (tx) => {
    const sale = (await loadSaleForContract(tx, ctx.companyId, c.saleId))!;
    const template = (c.templateId && (await tx.contractTemplate.findFirst({ where: { id: c.templateId, companyId: ctx.companyId, active: true } }))) || (await pickTemplate(tx, ctx.companyId, sale.mainProductType));
    if (!template) throw new AppError("Cadastre um modelo de contrato para este tipo de produto.");
    const { content, missing } = renderTemplate(template.body, template.clauses, buildVariables(sale));
    await tx.contract.update({
      where: { id },
      data: { templateId: template.id, templateVersion: template.version, content, missingFieldsJson: JSON.stringify(missing), status: "EM_PREPARACAO", outdated: false },
    });
    await audit(tx, ctx, "contrato.previa_atualizada", "Contract", id);
  });
}

/** Emite o contrato: congela o conteúdo, incrementa a versão e registra a data. */
export async function issueContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  if (c.status !== "EM_PREPARACAO" && c.status !== "AGUARDANDO_ENVIO") throw new AppError("Só é possível emitir contratos em preparação.");
  if (c.sale.status === "CANCELADA") throw new AppError("A venda está cancelada.");
  const missing = JSON.parse(c.missingFieldsJson) as string[];
  if (missing.length) throw new AppError(`Complete os dados obrigatórios antes de emitir: ${missing.join(", ")}.`);
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id }, data: { status: "AGUARDANDO_ENVIO", version: { increment: 1 }, issuedAt: new Date(), outdated: false } });
    await audit(tx, ctx, "contrato.emitido", "Contract", id, { version: c.version + 1 });
  });
}

export async function cancelContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  if (c.status === "CANCELADO") return;
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id }, data: { status: "CANCELADO" } });
    await audit(tx, ctx, "contrato.cancelado", "Contract", id);
  });
}

/** Reabre um contrato cancelado/desatualizado como nova preparação (nova versão na próxima emissão). */
export async function reopenContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  if (c.status === "ASSINADO") throw new AppError("Contrato assinado não pode ser reaberto.");
  if (c.sale.status === "CANCELADA") throw new AppError("A venda está cancelada.");
  await prisma.contract.update({ where: { id }, data: { status: "EM_PREPARACAO" } });
  await refreshContract(ctx, id);
}

/**
 * Confirmação vinda do provedor de assinatura eletrônica (webhook). É a ÚNICA forma de
 * marcar um contrato como assinado — o sistema não simula assinatura.
 */
export async function applySignatureCallback(input: { companyId: string; contractId: string; externalId: string; provider: string; event: "sent" | "signed" | "cancelled" }) {
  await prisma.$transaction(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id: input.contractId, companyId: input.companyId } });
    if (!c) throw new AppError("Contrato não encontrado.", "NOT_FOUND");
    if (input.event === "sent") {
      await tx.contract.update({ where: { id: c.id }, data: { status: "ENVIADO", sentAt: new Date(), externalId: input.externalId, signatureProvider: input.provider } });
    } else if (input.event === "signed") {
      if (c.externalId && c.externalId !== input.externalId) throw new AppError("Identificador externo divergente.", "CONFLICT");
      await tx.contract.update({ where: { id: c.id }, data: { status: "ASSINADO", signedAt: new Date(), externalId: input.externalId, signatureProvider: input.provider } });
      await emitEvent(tx, input.companyId, "contrato_assinado.evento", {
        type: "contrato.assinado",
        entityType: "Contract",
        entityId: c.id,
        idempotencyKey: `contrato.assinado:${c.id}:v${c.version}`,
        payload: { contractId: c.id, saleId: c.saleId, version: c.version },
      });
    } else {
      await tx.contract.update({ where: { id: c.id }, data: { status: "CANCELADO" } });
    }
  });
}

// --------------------------- Modelos ---------------------------

export const templateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  productType: z.enum(PT.values),
  body: z.string().min(20, "O modelo está muito curto.").max(50000),
  clauses: z.string().max(20000).default(""),
  active: z.boolean().default(true),
});

export async function listTemplates(ctx: Ctx) {
  return prisma.contractTemplate.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ productType: "asc" }, { name: "asc" }] });
}

export async function saveTemplate(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const data = templateSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const t = await tx.contractTemplate.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!t) throw new AppError("Modelo não encontrado.", "NOT_FOUND");
      const updated = await tx.contractTemplate.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await audit(tx, ctx, "modelo_contrato.alterado", "ContractTemplate", id, { version: updated.version });
      return updated;
    }
    const created = await tx.contractTemplate.create({ data: { ...data, companyId: ctx.companyId } });
    await audit(tx, ctx, "modelo_contrato.criado", "ContractTemplate", created.id);
    return created;
  });
}

/**
 * Agência nova sem modelos: cria os modelos sugeridos (rascunhos para revisão jurídica)
 * e atualiza os contratos que estavam parados por falta de modelo.
 */
export async function createSuggestedTemplates(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  return prisma.$transaction(async (tx) => {
    if (await tx.contractTemplate.count({ where: { companyId: ctx.companyId } }))
      throw new AppError("A agência já tem modelos de contrato. Edite os existentes ou crie um novo.", "CONFLICT");
    for (const t of SUGGESTED_TEMPLATES) await tx.contractTemplate.create({ data: { companyId: ctx.companyId, name: t.name, productType: t.productType, body: SUGGESTED_TEMPLATE_BODY, clauses: t.clauses } });
    await audit(tx, ctx, "modelo_contrato.sugeridos_criados", "ContractTemplate", null, { quantidade: SUGGESTED_TEMPLATES.length });
    const stuck = await tx.contract.findMany({ where: { companyId: ctx.companyId, status: "NAO_GERADO" }, select: { saleId: true } });
    for (const c of stuck) await prepareContractForSale(tx, ctx.companyId, c.saleId);
    return { created: SUGGESTED_TEMPLATES.length, refreshed: stuck.length };
  });
}
