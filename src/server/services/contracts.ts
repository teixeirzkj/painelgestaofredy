import { z } from "zod";
import { prisma, Prisma, type Tx } from "../db";
import { assertCan, can, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { emitEvent, isAutomationEnabled } from "./automations";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYMENT_METHODS, PRODUCT_TYPES } from "@/lib/constants";
import { formatDocument } from "@/lib/utils";
import { clientIdentity } from "@/lib/client-identity";
import { PRODUCT_TYPES as PT } from "@/lib/constants";
import { SUGGESTED_TEMPLATES, SUGGESTED_TEMPLATE_BODY } from "./contract-defaults";

/** Variáveis disponíveis nos modelos de contrato. */
export const CONTRACT_VARIABLES: { key: string; label: string; required?: boolean }[] = [
  { key: "agencia.nome", label: "Nome da agência", required: true },
  { key: "agencia.documento", label: "CNPJ da agência" },
  { key: "cliente.nome", label: "Nome do cliente", required: true },
  { key: "cliente.identificacao", label: "Documento do cliente (CPF, CNPJ, passaporte ou RNE)", required: true },
  { key: "cliente.documento", label: "CPF/CNPJ do cliente (ou passaporte/RNE do estrangeiro)", required: true },
  { key: "cliente.nascimento", label: "Data de nascimento do cliente" },
  { key: "cliente.nacionalidade", label: "Nacionalidade do cliente" },
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

const SALE_FOR_CONTRACT = {
  company: true,
  client: true,
  seller: { select: { name: true } },
  items: { include: { supplier: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
  passengers: true,
} satisfies Prisma.SaleInclude;

async function loadSaleForContract(tx: Tx, companyId: string, saleId: string) {
  return tx.sale.findFirst({ where: { id: saleId, companyId }, include: SALE_FOR_CONTRACT });
}

type ClientForContract = SaleForContract["client"];

const FOREIGN_NO_DOC = "#cliente.estrangeiro_sem_cpf";
/** "CPF/CNPJ {{cliente.documento}}" dos modelos antigos (gravados antes de existir {{cliente.identificacao}}). */
const OLD_DOC_RE = /CPF\/CNPJ:?\s*\{\{\s*cliente\.documento\s*\}\}/g;

/** Variáveis do cliente (cliente.*). Estrangeiro sem CPF é identificado pelo passaporte ou RNE. */
export function clientVars(c: ClientForContract): Record<string, string> {
  const address = [c.street && `${c.street}${c.number ? `, ${c.number}` : ""}`, c.complement, c.district, c.city && `${c.city}${c.state ? `/${c.state}` : ""}`, c.zipCode && `CEP ${c.zipCode}`]
    .filter(Boolean)
    .join(" - ");
  // modelos antigos usam "CPF/CNPJ {{cliente.documento}}": para o estrangeiro sai o passaporte/RNE e o contrato não trava
  const foreignDoc = c.foreigner ? (c.passportNumber ? `${c.passportNumber} (passaporte)` : c.rne ? `${c.rne} (RNE/RNM)` : "") : "";
  return {
    "cliente.nome": c.name,
    "cliente.identificacao": clientIdentity(c, { mask: false }) ?? "",
    "cliente.documento": c.document ? formatDocument(c.document) : foreignDoc,
    "cliente.nascimento": c.birthDate ? formatDate(c.birthDate) : "",
    "cliente.nacionalidade": c.nationality ?? (c.foreigner || c.personType === "PJ" ? "" : "brasileira"),
    "cliente.endereco": c.street && c.city ? address : "",
    "cliente.email": c.email ?? "",
    "cliente.telefone": c.whatsapp ?? c.phone ?? "",
    // marca interna (fora do padrão {{...}}): estrangeiro sem CPF, para adaptar modelos antigos em renderTemplate
    [FOREIGN_NO_DOC]: c.foreigner && !c.document ? "1" : "",
  };
}

function agencyVars(company: SaleForContract["company"]): Record<string, string> {
  return {
    "agencia.nome": company.name,
    "agencia.documento": company.document ? formatDocument(company.document) : "",
  };
}

type PlanRow = { dueDate: string; amountCents: number; method: string };

function itemLine(i: SaleForContract["items"][number]) {
  return `- ${PRODUCT_TYPES.label(i.productType)}${i.description ? `: ${i.description}` : ""}${i.supplier ? ` (fornecedor: ${i.supplier.name})` : ""}${i.locator ? ` — localizador ${i.locator}` : ""} — ${formatBRL(i.priceCents)}`;
}

function planLines(plan: PlanRow[]) {
  return plan.map((p, idx) => `${idx + 1}) ${formatBRL(p.amountCents)} em ${formatDate(p.dueDate)} via ${PAYMENT_METHODS.label(p.method)}`).join("\n");
}

export function buildVariables(sale: SaleForContract): Record<string, string> {
  const plan = JSON.parse(sale.paymentPlanJson) as PlanRow[];
  return {
    ...agencyVars(sale.company),
    ...clientVars(sale.client),
    "venda.codigo": sale.code,
    "venda.data": formatDate(sale.saleDate),
    "venda.destino": sale.destination ?? "",
    "venda.inicio": sale.tripStart ? formatDate(sale.tripStart) : "",
    "venda.retorno": sale.tripEnd ? formatDate(sale.tripEnd) : "",
    "venda.passageiros": String(sale.passengerCount),
    "venda.localizador": sale.locator ?? "",
    "venda.valor_total": formatBRL(sale.grossCents),
    "venda.produtos": sale.items.map(itemLine).join("\n"),
    "venda.pagamento": plan.length ? planLines(plan) : "",
    "venda.lista_passageiros": sale.passengers.map((p) => `- ${p.name}`).join("\n"),
    "vendedor.nome": sale.seller.name,
  };
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/**
 * Variáveis do contrato da viagem: as mesmas chaves do contrato da venda (os modelos atuais servem sem mudar nada),
 * somando produtos, pagamentos e passageiros de todas as vendas. O contratante é o cliente da viagem (o mesmo de todas as vendas).
 */
export function buildTripVariables(trip: { code: string; destination: string | null }, sales: SaleForContract[]): Record<string, string> {
  const first = sales[0];
  const multi = sales.length > 1;
  const starts = sales.map((s) => s.tripStart).filter(Boolean) as string[];
  const ends = sales.map((s) => s.tripEnd ?? s.tripStart).filter(Boolean) as string[];
  const start = starts.sort()[0];
  const end = ends.sort().at(-1);
  // passageiros sem repetição (mesma pessoa em várias vendas)
  const pax = new Map<string, string>();
  for (const s of sales) for (const p of s.passengers) pax.set((p.document || p.name).toLowerCase(), p.name);
  const locators = uniq(sales.flatMap((s) => [s.locator, ...s.items.map((i) => i.locator)]).filter(Boolean) as string[]);
  const payments = sales
    .map((s) => {
      const plan = JSON.parse(s.paymentPlanJson) as PlanRow[];
      if (!plan.length) return "";
      return multi ? `Venda ${s.code} (${PRODUCT_TYPES.label(s.mainProductType)}):\n${planLines(plan)}` : planLines(plan);
    })
    .filter(Boolean);
  return {
    ...agencyVars(first.company),
    ...clientVars(first.client),
    "venda.codigo": `${trip.code} (vendas ${sales.map((s) => s.code).join(", ")})`,
    "venda.data": formatDate(sales.map((s) => s.saleDate).sort().at(-1)!),
    "venda.destino": trip.destination || uniq(sales.map((s) => s.destination).filter(Boolean) as string[]).join(" / "),
    "venda.inicio": start ? formatDate(start) : "",
    "venda.retorno": end ? formatDate(end) : "",
    "venda.passageiros": String(pax.size || Math.max(0, ...sales.map((s) => s.passengerCount))),
    "venda.localizador": locators.join(", "),
    "venda.valor_total": formatBRL(sales.reduce((a, s) => a + s.grossCents, 0)),
    "venda.produtos": sales.flatMap((s) => s.items.map((i) => (multi ? `${itemLine(i)} · venda ${s.code}` : itemLine(i)))).join("\n"),
    "venda.pagamento": payments.join("\n\n"),
    "venda.lista_passageiros": [...pax.values()].map((n) => `- ${n}`).join("\n"),
    "vendedor.nome": uniq(sales.map((s) => s.seller.name)).join(", "),
  };
}

export function renderTemplate(body: string, clauses: string, vars: Record<string, string>) {
  // Estrangeiro sem CPF em modelo antigo: "CPF/CNPJ {{cliente.documento}}" vira a identificação completa
  // (passaporte com a nacionalidade e RNE/RNM), sem precisar alterar os modelos já salvos.
  if (vars[FOREIGN_NO_DOC]) {
    body = body.replace(OLD_DOC_RE, "{{cliente.identificacao}}");
    clauses = clauses.replace(OLD_DOC_RE, "{{cliente.identificacao}}");
  }
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

// --------------------------- Contrato da viagem ---------------------------
//
// O contrato da viagem é UMA linha Contract com tripId preenchido e saleId = venda-base (a venda coberta mais antiga).
// Vendas COBERTAS = vendas da viagem confirmadas/concluídas e sem contrato próprio. Assim o escopo por venda
// (vendedor, painel, pendências) continua valendo, e "está no contrato da viagem" é só uma regra, sem status novo.
// Gerar é pedido na mão (botão) e NÃO depende da automação venda_confirmada.contrato.

const COVERED_SALE = ["CONFIRMADA", "CONCLUIDA"];
/** Contrato da viagem ainda aceita vendas novas (não foi enviado ao cliente nem cancelado). */
const TRIP_JOINABLE = ["NAO_GERADO", "EM_PREPARACAO", "AGUARDANDO_ENVIO"];

/** Contrato que nunca chegou ao cliente (pode ser trocado pelo contrato da viagem). Envio pela Frédy/WhatsApp grava sentAt. */
export function contractNeverSent(c: { status: string; externalId: string | null; sentAt?: Date | null }) {
  return !c.externalId && !c.sentAt && c.status !== "ENVIADO" && c.status !== "ASSINADO";
}

/** Nome curto do contrato nas telas, no PDF e na ZapSign: código da viagem ou da venda. */
export function contractLabel(c: { sale: { code: string }; trip?: { code: string } | null }) {
  return c.trip ? c.trip.code : c.sale.code;
}

/**
 * O contrato da viagem vale para a venda (sem contrato próprio)? Enquanto ainda aceita vendas, sim;
 * depois de enviado, só para as vendas que estão no texto dele.
 */
export function tripContractCovers(c: { status: string; saleIdsJson: string }, saleId: string) {
  if (c.status === "CANCELADO") return false;
  return TRIP_JOINABLE.includes(c.status) || (JSON.parse(c.saleIdsJson) as string[]).includes(saleId);
}

/**
 * Contrato que vale para a venda: o próprio (inclusive quando ela é a venda-base do contrato da viagem)
 * ou, se ela está confirmada numa viagem com contrato que a cobre, o contrato da viagem.
 */
export function effectiveContract<C, T extends { status: string; saleIdsJson: string }>(sale: {
  id: string;
  status: string;
  contracts: C[];
  trip?: { contracts: T[] } | null;
}): C | T | null {
  if (sale.contracts[0]) return sale.contracts[0];
  if (!COVERED_SALE.includes(sale.status)) return null;
  const tc = sale.trip?.contracts[0];
  return tc && tripContractCovers(tc, sale.id) ? tc : null;
}

/** Include para telas que usam effectiveContract (contrato da viagem não cancelado; status e vendas do texto sempre vêm). */
export function tripContractInclude<S extends Prisma.ContractSelect>(select: S) {
  return {
    select: { id: true, code: true, contracts: { where: { status: { not: "CANCELADO" } }, select: { ...select, status: true, saleIdsJson: true } as S & { status: true; saleIdsJson: true }, take: 1 } },
  } as const;
}

async function coveredSales(tx: Tx, companyId: string, tripId: string, contractId: string | null) {
  return tx.sale.findMany({
    where: { companyId, tripId, status: { in: COVERED_SALE }, contracts: { none: contractId ? { id: { not: contractId } } : {} } },
    include: SALE_FOR_CONTRACT,
    orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
  });
}

const clausesOf = (t: { clauses: string }) => t.clauses.trim();

/**
 * Modelos do contrato da viagem: corpo = modelo do produto de maior valor; cláusulas = de cada tipo de produto,
 * sem repetir modelo, com o nome do produto como título quando há mais de um.
 */
async function pickTripTemplates(tx: Tx, companyId: string, sales: SaleForContract[]) {
  const items = sales.flatMap((s) => s.items);
  const top = items.reduce<SaleForContract["items"][number] | null>((a, i) => (!a || i.priceCents > a.priceCents ? i : a), null);
  const body = await pickTemplate(tx, companyId, top?.productType ?? sales[0].mainProductType);
  if (!body) return null;
  const types = uniq(items.map((i) => i.productType));
  if (!types.length) types.push(sales[0].mainProductType);
  const groups = new Map<string, { template: NonNullable<Awaited<ReturnType<typeof pickTemplate>>>; types: string[] }>();
  for (const t of types) {
    const tpl = await pickTemplate(tx, companyId, t);
    if (!tpl) continue;
    const g = groups.get(tpl.id);
    if (g) g.types.push(t);
    else groups.set(tpl.id, { template: tpl, types: [t] });
  }
  const withClauses = [...groups.values()].filter((g) => clausesOf(g.template));
  const clauses =
    withClauses.length === 1
      ? clausesOf(withClauses[0].template)
      : withClauses.map((g) => `${g.types.map((t) => PRODUCT_TYPES.label(t)).join(" / ")}:\n${clausesOf(g.template)}`).join("\n\n");
  return { body, clauses };
}

/** Refaz a prévia do contrato da viagem com as vendas cobertas. Devolve false se não há modelo. */
async function renderTripContract(tx: Tx, companyId: string, contractId: string) {
  const c = await tx.contract.findUniqueOrThrow({ where: { id: contractId }, include: { trip: true } });
  const sales = await coveredSales(tx, companyId, c.tripId!, c.id);
  if (!sales.length || !c.trip) return { ok: false as const, empty: true };
  const ids = sales.map((s) => s.id);
  const base = ids.includes(c.saleId) ? {} : { saleId: ids[0] };
  const t = await pickTripTemplates(tx, companyId, sales);
  if (!t) {
    await tx.contract.update({
      where: { id: c.id },
      data: { ...base, status: "NAO_GERADO", missingFieldsJson: JSON.stringify(["Modelo de contrato para o produto"]), saleIdsJson: JSON.stringify(ids), outdated: false },
    });
    return { ok: false as const, empty: false };
  }
  const { content, missing } = renderTemplate(t.body.body, t.clauses, buildTripVariables(c.trip, sales));
  await tx.contract.update({
    where: { id: c.id },
    data: {
      ...base,
      templateId: t.body.id,
      templateVersion: t.body.version,
      status: "EM_PREPARACAO",
      content,
      missingFieldsJson: JSON.stringify(missing),
      saleIdsJson: JSON.stringify(ids),
      outdated: false,
    },
  });
  return { ok: true as const, empty: false };
}

function tripScopeWhere(ctx: Ctx): Prisma.TripWhereInput {
  if (can(ctx, "sales.view_all")) return { companyId: ctx.companyId };
  return { companyId: ctx.companyId, OR: [{ sales: { some: { sellerId: ctx.userId } } }, { client: { ownerId: ctx.userId } }] };
}

/**
 * Botão "Gerar um contrato para a viagem toda": junta as vendas confirmadas da viagem que ainda não tiveram contrato
 * enviado. Os contratos próprios delas (nunca enviados) saem, com o texto guardado na auditoria.
 */
export async function generateTripContract(ctx: Ctx, tripId: string) {
  assertCan(ctx, "contracts.manage");
  const trip = await prisma.trip.findFirst({ where: { id: tripId, ...tripScopeWhere(ctx), cancelledAt: null } });
  if (!trip) throw new AppError("Viagem não encontrada.", "NOT_FOUND");
  try {
    return await prisma.$transaction(async (tx) => {
      if (await tx.contract.findUnique({ where: { companyId_tripId: { companyId: ctx.companyId, tripId } } }))
        throw new AppError("Esta viagem já tem contrato. Abra o contrato da viagem.", "CONFLICT");
      const sales = await tx.sale.findMany({
        where: { companyId: ctx.companyId, tripId, status: { in: COVERED_SALE } },
        select: { id: true, code: true, sellerId: true, contracts: true },
        orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
      });
      const candidates = sales.filter((s) => s.contracts.every(contractNeverSent));
      if (candidates.length < 2)
        throw new AppError("Para juntar em um contrato só, a viagem precisa de pelo menos 2 vendas confirmadas que ainda não tiveram contrato enviado.");
      if (!can(ctx, "sales.view_all") && candidates.some((s) => s.sellerId !== ctx.userId))
        throw new AppError("Esta viagem tem vendas de outro vendedor. Peça ao gestor para gerar o contrato da viagem.", "FORBIDDEN");
      for (const s of candidates)
        for (const old of s.contracts) {
          await tx.contract.delete({ where: { id: old.id } });
          await audit(tx, ctx, "contrato.substituido_pela_viagem", "Contract", old.id, {
            saleId: s.id,
            venda: s.code,
            tripId,
            status: old.status,
            version: old.version,
            content: old.content,
          });
        }
      // o atendimento dessas vendas volta a ter o envio do contrato pendente (o da viagem ainda vai ser enviado)
      await tx.balcaoFlow.updateMany({ where: { companyId: ctx.companyId, saleId: { in: candidates.map((s) => s.id) } }, data: { contractSent: false } });
      const c = await tx.contract.create({ data: { companyId: ctx.companyId, saleId: candidates[0].id, tripId, status: "EM_PREPARACAO" } });
      await renderTripContract(tx, ctx.companyId, c.id);
      await audit(tx, ctx, "contrato_viagem.gerado", "Trip", tripId, { contractId: c.id, vendas: candidates.map((s) => s.code) });
      return { id: c.id };
    });
  } catch (e) {
    // dois cliques ao mesmo tempo: o índice único da viagem barra o segundo
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("Esta viagem já tem contrato. Abra o contrato da viagem.", "CONFLICT");
    throw e;
  }
}

/**
 * Mantém o contrato da viagem em dia quando uma venda da viagem muda, entra, sai ou é cancelada.
 * - troca a venda-base se ela não está mais coberta;
 * - em preparação: refaz a prévia; já emitido/enviado/assinado: marca como desatualizado;
 * - sem nenhuma venda coberta: some (se nunca foi enviado) ou fica cancelado.
 * Não depende da automação venda_confirmada.contrato.
 */
export async function syncTripContract(tx: Tx, companyId: string, tripId: string, opts: { changed?: boolean; ctx?: Ctx } = {}) {
  const c = await tx.contract.findUnique({ where: { companyId_tripId: { companyId, tripId } } });
  if (!c) return;
  const sales = await tx.sale.findMany({
    where: { companyId, tripId, status: { in: COVERED_SALE }, contracts: { none: { id: { not: c.id } } } },
    select: { id: true, code: true },
    orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
  });
  // contrato já enviado/assinado não ganha vendas novas: só contam as que estão no texto dele
  const inText = JSON.parse(c.saleIdsJson) as string[];
  const ids = TRIP_JOINABLE.includes(c.status) || c.status === "CANCELADO" ? sales.map((s) => s.id) : sales.map((s) => s.id).filter((id) => inText.includes(id));
  if (!ids.length) {
    if (contractNeverSent(c)) {
      await tx.contract.delete({ where: { id: c.id } });
      if (opts.ctx)
        await audit(tx, opts.ctx, "contrato_viagem.removido", "Trip", tripId, { contractId: c.id, status: c.status, version: c.version, content: c.content, motivo: "a viagem ficou sem vendas confirmadas" });
    } else if (c.status !== "CANCELADO") {
      await tx.contract.update({ where: { id: c.id }, data: { status: "CANCELADO" } });
    }
    return;
  }
  if (!ids.includes(c.saleId)) await tx.contract.update({ where: { id: c.id }, data: { saleId: ids[0] } });
  if (c.status === "NAO_GERADO" || c.status === "EM_PREPARACAO") {
    await renderTripContract(tx, companyId, c.id);
    return;
  }
  if (c.status === "CANCELADO") return;
  const sameSales = JSON.stringify([...ids].sort()) === JSON.stringify([...inText].sort());
  if ((opts.changed || !sameSales) && !c.outdated) await tx.contract.update({ where: { id: c.id }, data: { outdated: true } });
}

/** Vendas da viagem para mostrar no contrato: as que estão no texto e as que ficaram de fora (contrato próprio). */
async function tripContractSales(companyId: string, c: { id: string; tripId: string | null; saleIdsJson: string }) {
  if (!c.tripId) return { included: [], outside: [] };
  const ids = JSON.parse(c.saleIdsJson) as string[];
  const [included, outside] = await Promise.all([
    prisma.sale.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, code: true, sellerId: true }, orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }] }),
    prisma.sale.findMany({
      where: { companyId, tripId: c.tripId, status: { in: COVERED_SALE }, contracts: { some: { id: { not: c.id } } } },
      select: { id: true, code: true },
      orderBy: [{ saleDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return { included, outside };
}

// --------------------------- Contrato da venda ---------------------------

/** Monta (ou refaz) o contrato próprio da venda, sem olhar a automação. */
async function prepareSaleContractNow(tx: Tx, companyId: string, sale: SaleForContract) {
  const saleId = sale.id;
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

/**
 * Prepara (ou atualiza) o contrato da venda. Chamado ao confirmar/alterar uma venda e ao incluí-la ou tirá-la de uma viagem.
 * - Venda numa viagem cujo contrato ainda não foi enviado: entra no contrato da viagem (sem contrato próprio).
 * - Em preparação: re-renderiza a prévia.
 * - Já emitido/enviado/assinado: não altera o conteúdo; marca como desatualizado para conferência.
 * `force` (botão "Preparar contrato") ignora a automação venda_confirmada.contrato.
 */
export async function prepareContractForSale(tx: Tx, companyId: string, saleId: string, opts: { force?: boolean; ctx?: Ctx } = {}) {
  const sale = await loadSaleForContract(tx, companyId, saleId);
  if (!sale) return;
  const confirmed = COVERED_SALE.includes(sale.status);
  let existing = await tx.contract.findUnique({ where: { companyId_saleId: { companyId, saleId } } });

  // a venda é a base de um contrato de viagem
  if (existing?.tripId) {
    if (existing.tripId === sale.tripId && confirmed) {
      await syncTripContract(tx, companyId, existing.tripId, { changed: true, ctx: opts.ctx });
      return;
    }
    // saiu da viagem: a viagem troca a base (ou o contrato some) e a venda segue com contrato próprio
    await syncTripContract(tx, companyId, existing.tripId, { ctx: opts.ctx });
    existing = await tx.contract.findUnique({ where: { companyId_saleId: { companyId, saleId } } });
    if (existing?.tripId) return; // ainda presa a um contrato de viagem já enviado
  }

  if (sale.tripId && confirmed) {
    const tripContract = await tx.contract.findUnique({ where: { companyId_tripId: { companyId, tripId: sale.tripId } } });
    // venda que já está no texto do contrato da viagem continua nele, mesmo depois de enviado (só fica desatualizado)
    const inTripText = !!tripContract && (JSON.parse(tripContract.saleIdsJson) as string[]).includes(saleId);
    // (contrato da viagem cancelado não segura a venda: ela passa a ter contrato próprio)
    if (tripContract && tripContract.status !== "CANCELADO" && !existing && inTripText) {
      await syncTripContract(tx, companyId, sale.tripId, { changed: true, ctx: opts.ctx });
      return;
    }
    if (tripContract && TRIP_JOINABLE.includes(tripContract.status)) {
      // contrato próprio ainda não emitido sai: a venda passa a constar no contrato da viagem
      if (existing && contractNeverSent(existing) && ["NAO_GERADO", "EM_PREPARACAO", "CANCELADO"].includes(existing.status)) {
        await tx.balcaoFlow.updateMany({ where: { companyId, saleId }, data: { contractSent: false } });
        await tx.contract.delete({ where: { id: existing.id } });
        if (opts.ctx)
          await audit(tx, opts.ctx, "contrato.substituido_pela_viagem", "Contract", existing.id, {
            saleId,
            venda: sale.code,
            tripId: sale.tripId,
            status: existing.status,
            version: existing.version,
            content: existing.content,
          });
        existing = null;
      }
      if (!existing) {
        await syncTripContract(tx, companyId, sale.tripId, { changed: true, ctx: opts.ctx });
        return;
      }
    }
    // contrato da viagem já enviado/assinado e a venda não está no texto: ela precisa de contrato próprio,
    // com ou sem a automação (senão pareceria coberta pelo contrato da viagem sem estar nele)
    if (tripContract && !existing && tripContract.status !== "CANCELADO" && !TRIP_JOINABLE.includes(tripContract.status) && !inTripText) {
      await prepareSaleContractNow(tx, companyId, sale);
      return;
    }
  }

  if (!opts.force && !(await isAutomationEnabled(tx, companyId, "venda_confirmada.contrato"))) return;
  await prepareSaleContractNow(tx, companyId, sale);
}

/** Vendedor vê o contrato da própria venda e o contrato da viagem em que tem venda confirmada. */
function visibleContractWhere(ctx: Ctx): Prisma.ContractWhereInput {
  if (can(ctx, "sales.view_all")) return {};
  return { OR: [{ sale: { sellerId: ctx.userId } }, { tripId: { not: null }, trip: { sales: { some: { sellerId: ctx.userId, status: { in: COVERED_SALE } } } } }] };
}

export async function listContracts(ctx: Ctx, opts: { status?: string; q?: string } = {}) {
  const rows = await prisma.contract.findMany({
    where: {
      companyId: ctx.companyId,
      ...(opts.status ? { status: opts.status } : {}),
      AND: [
        visibleContractWhere(ctx),
        opts.q ? { OR: [{ sale: { code: { contains: opts.q } } }, { sale: { client: { name: { contains: opts.q } } } }, { trip: { code: { contains: opts.q } } }] } : {},
      ],
    },
    include: {
      sale: { select: { id: true, code: true, sellerId: true, destination: true, mainProductType: true, client: { select: { name: true } } } },
      trip: { select: { id: true, code: true, title: true, destination: true } },
      template: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  if (can(ctx, "sales.view_all")) return rows;
  // contrato da viagem de outra venda-base: só aparece para quem tem venda no texto dele
  const tripIds = rows.filter((c) => c.tripId && c.sale.sellerId !== ctx.userId).flatMap((c) => JSON.parse(c.saleIdsJson) as string[]);
  const mine = new Set(
    tripIds.length ? (await prisma.sale.findMany({ where: { companyId: ctx.companyId, id: { in: tripIds }, sellerId: ctx.userId }, select: { id: true } })).map((x) => x.id) : [],
  );
  return rows.filter((c) => !c.tripId || c.sale.sellerId === ctx.userId || (JSON.parse(c.saleIdsJson) as string[]).some((id) => mine.has(id)));
}

export async function getContract(ctx: Ctx, id: string) {
  const c = await prisma.contract.findFirst({
    where: { id, companyId: ctx.companyId, ...visibleContractWhere(ctx) },
    include: { sale: { include: { client: true } }, trip: { select: { id: true, code: true, title: true } }, template: true },
  });
  if (!c) throw new AppError("Contrato não encontrado.", "NOT_FOUND");
  const tripSales = await tripContractSales(ctx.companyId, c);
  // contrato da viagem: o vendedor só vê se tem venda no texto dele (ter venda na viagem não basta)
  if (c.tripId && !can(ctx, "sales.view_all") && c.sale.sellerId !== ctx.userId && !tripSales.included.some((s) => s.sellerId === ctx.userId))
    throw new AppError("Contrato não encontrado.", "NOT_FOUND");
  return { ...c, tripSales };
}

/**
 * Mudar o contrato da viagem (atualizar, emitir, cancelar, reabrir, separar, enviar para assinatura) segue a regra
 * de gerar: vendedor sem acesso a todas as vendas não mexe em contrato que tem venda de outro vendedor.
 */
export function assertCanChangeTripContract(ctx: Ctx, c: { tripId: string | null; tripSales: { included: { sellerId: string }[] } }, extraSellerIds: string[] = []) {
  if (!c.tripId || can(ctx, "sales.view_all")) return;
  if (c.tripSales.included.some((s) => s.sellerId !== ctx.userId) || extraSellerIds.some((id) => id !== ctx.userId))
    throw new AppError("Este contrato tem vendas de outro vendedor. Peça ao gestor.", "FORBIDDEN");
}

async function assertTripHasSales(c: { id: string; tripId: string | null; companyId: string }) {
  if (!c.tripId) return;
  const n = await prisma.sale.count({ where: { companyId: c.companyId, tripId: c.tripId, status: { in: COVERED_SALE }, contracts: { none: { id: { not: c.id } } } } });
  if (!n) throw new AppError("Nenhuma venda confirmada nesta viagem.");
}

/** Atualiza a prévia com os dados atuais da venda ou da viagem (somente antes do envio). */
export async function refreshContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  assertCanChangeTripContract(ctx, c);
  if (!["NAO_GERADO", "EM_PREPARACAO", "AGUARDANDO_ENVIO"].includes(c.status))
    throw new AppError("Contrato já enviado: não é possível regenerar. Cancele e gere uma nova versão.");
  await assertTripHasSales(c);
  await prisma.$transaction(async (tx) => {
    if (c.tripId) {
      const r = await renderTripContract(tx, ctx.companyId, id);
      if (!r.ok) throw new AppError(r.empty ? "Nenhuma venda confirmada nesta viagem." : "Cadastre um modelo de contrato para este tipo de produto.");
    } else {
      const sale = (await loadSaleForContract(tx, ctx.companyId, c.saleId))!;
      const template = (c.templateId && (await tx.contractTemplate.findFirst({ where: { id: c.templateId, companyId: ctx.companyId, active: true } }))) || (await pickTemplate(tx, ctx.companyId, sale.mainProductType));
      if (!template) throw new AppError("Cadastre um modelo de contrato para este tipo de produto.");
      const { content, missing } = renderTemplate(template.body, template.clauses, buildVariables(sale));
      await tx.contract.update({
        where: { id },
        data: { templateId: template.id, templateVersion: template.version, content, missingFieldsJson: JSON.stringify(missing), status: "EM_PREPARACAO", outdated: false },
      });
    }
    await audit(tx, ctx, "contrato.previa_atualizada", "Contract", id);
  });
}

/** Emite o contrato: congela o conteúdo, incrementa a versão e registra a data. */
export async function issueContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  assertCanChangeTripContract(ctx, c);
  if (c.status !== "EM_PREPARACAO" && c.status !== "AGUARDANDO_ENVIO") throw new AppError("Só é possível emitir contratos em preparação.");
  if (c.tripId) await assertTripHasSales(c);
  else if (c.sale.status === "CANCELADA") throw new AppError("A venda está cancelada.");
  const missing = JSON.parse(c.missingFieldsJson) as string[];
  if (missing.length) throw new AppError(`Complete os dados obrigatórios antes de emitir: ${missing.join(", ")}.`);
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({ where: { id }, data: { status: "AGUARDANDO_ENVIO", version: { increment: 1 }, issuedAt: new Date(), outdated: false } });
    await audit(tx, ctx, "contrato.emitido", "Contract", id, { version: c.version + 1, ...(c.tripId ? { vendas: c.tripSales.included.map((s) => s.code) } : {}) });
  });
}

export async function cancelContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  assertCanChangeTripContract(ctx, c);
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
  assertCanChangeTripContract(ctx, c);
  if (c.status === "ASSINADO") throw new AppError("Contrato assinado não pode ser reaberto.");
  if (c.tripId) await assertTripHasSales(c);
  else if (c.sale.status === "CANCELADA") throw new AppError("A venda está cancelada.");
  await prisma.contract.update({ where: { id }, data: { status: "EM_PREPARACAO" } });
  await refreshContract(ctx, id);
}

/** "Separar em contratos por venda": o contrato da viagem (nunca enviado) vira um contrato para cada venda. */
export async function splitTripContract(ctx: Ctx, id: string) {
  assertCan(ctx, "contracts.manage");
  const c = await getContract(ctx, id);
  if (!c.tripId) throw new AppError("Este contrato já é de uma venda só.");
  if (!contractNeverSent(c)) throw new AppError("Este contrato já foi enviado ao cliente e não pode ser separado.");
  assertCanChangeTripContract(ctx, c);
  await prisma.$transaction(async (tx) => {
    const sales = await coveredSales(tx, ctx.companyId, c.tripId!, c.id);
    assertCanChangeTripContract(ctx, c, sales.map((s) => s.sellerId));
    // a venda-base fica com esta linha (vira contrato normal); as outras ganham contrato próprio
    const base = sales.find((s) => s.id === c.saleId) ?? null;
    await tx.contract.update({ where: { id }, data: { tripId: null, saleIdsJson: "[]", status: "EM_PREPARACAO", outdated: false, ...(base || !sales[0] ? {} : { saleId: sales[0].id }) } });
    for (const s of sales) await prepareSaleContractNow(tx, ctx.companyId, s);
    await audit(tx, ctx, "contrato_viagem.separado", "Trip", c.tripId, { contractId: id, vendas: sales.map((s) => s.code) });
  });
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
        payload: { contractId: c.id, saleId: c.saleId, tripId: c.tripId, version: c.version },
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
    for (const c of stuck) await prepareContractForSale(tx, ctx.companyId, c.saleId, { ctx });
    return { created: SUGGESTED_TEMPLATES.length, refreshed: stuck.length };
  });
}
