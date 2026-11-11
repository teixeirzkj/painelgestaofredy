/**
 * Integração com o Monde pela API oficial v3 (https://web.monde.com.br/api/v3/documentation):
 * - autenticação por credencial gerada no Monde (Cadastros > Integrações > API Monde), header Bearer;
 * - listas paginadas por cursor ({ data, pagination: { has_next_page, next_cursor } });
 * - limite documentado: 10 requisições a cada 3 segundos por IP (429 = nada processado).
 *
 * Importa os clientes (GET /people) e as vendas (GET /sales e GET /sales/{id}), com o financeiro:
 * as parcelas do cliente seguem as contas a receber da venda no Monde e o que já está liquidado lá
 * entra baixado na gestão, numa conta própria ("Monde (baixas importadas)") para não mexer no saldo
 * dos bancos. Venda importada não gera contrato novo nem avisa integrações (não marca card no CRM).
 */
import { prisma } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../secrets";
import { upsertImportedClient, type ImportedClient } from "./client-import";
import { createSale } from "./sales";
import { settleEntryTx } from "./finance";
import { saveMondeFlights } from "./flights";
import { calculateSale } from "@/lib/finance";
import type { CommercialModel, PaymentMethod, ProductType } from "@/lib/constants";
import { ZodError } from "zod";

const BASE = "https://web.monde.com.br/api/v3";
const spacingMs = () => Number(process.env.MONDE_SPACING_MS ?? 320); // 10 a cada 3 s: ~9 por segundo no máximo
const BATCH_BUDGET_MS = () => Number(process.env.MONDE_BATCH_MS ?? 25_000); // a tela chama de novo até terminar
export const IMPORT_ACCOUNT_NAME = "Monde (baixas importadas)";

// ------------------------------ Cliente HTTP ------------------------------

type Obj = Record<string, unknown>;
type Ref = { id: string } | null | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function paced() {
  const wait = lastCall + spacingMs() - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

async function mondeGet<T = Obj>(token: string, path: string, opts: { allowNotFound?: boolean } = {}): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    await paced();
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 2) {
      await sleep(3_500); // a janela do limite é de 3 segundos
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => null)) as { errors?: string[] } | null;
    const why = body?.errors?.[0];
    if (res.status === 404 && opts.allowNotFound) return null;
    if (res.status === 401) throw new AppError("O Monde recusou a credencial da API. Confira se ela foi copiada inteira e se não foi revogada.");
    if (res.status === 403) throw new AppError(`O Monde negou o acesso${why ? `: ${why}` : ""}. Na credencial (Cadastros > Integrações > API Monde), marque a permissão "Visualizar" desse recurso.`);
    if (res.status === 429) throw new AppError("O Monde pediu para aguardar (limite de requisições). Tente de novo em 1 minuto.");
    throw new AppError(`O Monde respondeu com erro ${res.status}${why ? `: ${why}` : ""}.`);
  }
}

type Page<T> = { data: T[]; pagination: { has_next_page: boolean; next_cursor: string | null } };
const withCursor = (path: string, cursor: string | null | undefined) => (cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : path);

/** Consultas com cache (pessoas, cidades, contas e formas de pagamento se repetem entre vendas). */
class MondeReader {
  private cache = new Map<string, Promise<Obj | null>>();
  constructor(readonly token: string) {}
  get(path: string) {
    let p = this.cache.get(path);
    if (!p) {
      p = mondeGet<Obj>(this.token, path, { allowNotFound: true });
      this.cache.set(path, p);
      p.catch(() => this.cache.delete(path));
    }
    return p;
  }
  person = (id: string) => this.get(`/people/${id}`) as Promise<MondePerson | null>;
  bill = (id: string) => this.get(`/bills/${id}`) as Promise<MondeBill | null>;
  async cityOf(p: MondePerson) {
    const id = p.address?.city?.id;
    if (!id) return null;
    const c = (await this.get(`/cities/${id}`)) as { name?: string; state?: { acronym?: string } } | null;
    return c ? { name: c.name ?? null, state: c.state?.acronym ?? null } : null;
  }
  private methods: Promise<Map<string, string>> | null = null;
  /** Nome de cada forma de pagamento (para traduzir para as formas da gestão). */
  paymentMethodName(id: string | undefined) {
    if (!id) return Promise.resolve(null);
    this.methods ??= listAll<{ id: string; name: string }>(this.token, "/payment_methods?size=50").then((l) => new Map(l.map((m) => [m.id, m.name])));
    return this.methods.then((m) => m.get(id) ?? null);
  }
  private sellerPeople: Promise<Map<string, string>> | null = null;
  /** id do vendedor no Monde -> id da pessoa do vendedor. */
  sellers() {
    this.sellerPeople ??= listAll<{ id: string; person?: Ref }>(this.token, "/sellers?size=50").then(
      (l) => new Map(l.filter((s) => s.person?.id).map((s) => [s.id, s.person!.id])),
    );
    return this.sellerPeople;
  }
}

async function listAll<T>(token: string, path: string) {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 40; i++) {
    const r: Page<T> | null = await mondeGet<Page<T>>(token, withCursor(path, cursor));
    out.push(...(r?.data ?? []));
    if (!r?.pagination?.has_next_page || !r.pagination.next_cursor) break;
    cursor = r.pagination.next_cursor;
  }
  return out;
}

// ------------------------------ Pessoas ------------------------------

export type MondePerson = {
  id: string;
  person_kind?: "individual" | "company";
  name?: string | null;
  legal_name?: string | null;
  cpf_cnpj?: string | null;
  rg_ie?: string | null;
  gender?: "female" | "male" | null;
  birthdate?: string | null;
  passport_number?: string | null;
  passport_expiration_date?: string | null;
  foreigner?: boolean | null;
  foreign_identity_document?: string | null;
  email?: string | null;
  phone_number?: string | null;
  mobile_number?: string | null;
  business_phone?: string | null;
  observations?: string | null;
  airline?: { code?: string | null } | null;
  address?: { postal_code?: string | null; street?: string | null; street_number?: string | null; neighborhood?: string | null; additional_info?: string | null; city?: Ref } | null;
};

/** Converte uma pessoa do Monde (API v3) para o cadastro de cliente da gestão. */
export function mapMondePerson(p: MondePerson, city?: { name: string | null; state: string | null } | null): ImportedClient {
  const company = p.person_kind === "company";
  const a = p.address ?? {};
  return {
    name: (company ? p.legal_name || p.name : p.name) ?? "",
    tradeName: company && p.legal_name && p.name !== p.legal_name ? p.name : null,
    document: p.cpf_cnpj ?? null,
    rg: p.rg_ie ?? null,
    birthDate: p.birthdate ?? null,
    email: p.email ?? null,
    whatsapp: p.mobile_number ?? null,
    phone: p.phone_number || p.business_phone || null,
    zipCode: a.postal_code ?? null,
    street: a.street ?? null,
    number: a.street_number ?? null,
    complement: a.additional_info ?? null,
    district: a.neighborhood ?? null,
    city: city?.name ?? null,
    state: city?.state ?? null,
    passportNumber: p.passport_number ?? null,
    passportExpiry: p.passport_expiration_date ?? null,
    notes: p.observations ?? null,
    gender: p.gender === "female" ? "F" : p.gender === "male" ? "M" : null,
    // o Monde não tem nacionalidade: o documento de estrangeiro vira o RNE
    foreigner: !company && !!p.foreigner,
    rne: !company && p.foreigner ? (p.foreign_identity_document ?? null) : null,
  };
}

// ------------------------------ Conexão ------------------------------

export async function getMonde(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const m = await prisma.mondeIntegration.findUnique({ where: { companyId: ctx.companyId } });
  if (!m) return null;
  const { passwordEnc: _p, salesErrorsJson, ...rest } = m;
  void _p;
  return { ...rest, salesErrors: JSON.parse(salesErrorsJson || "[]") as SaleError[] };
}

/** Conecta com a credencial da API v3 (o login e a senha da v2 deixaram de ser usados). */
export async function connectMonde(ctx: Ctx, input: { token: string }) {
  assertCan(ctx, "settings.manage");
  const token = String(input.token ?? "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 20 || /\s/.test(token)) throw new AppError("Cole a credencial da API do Monde (Cadastros > Integrações > API Monde).");
  const r = await mondeGet<Page<{ id: string; name?: string }>>(token, "/companies?size=1"); // valida antes de salvar
  const label = r?.data?.[0]?.name ? `Credencial da API · ${r.data[0].name}` : "Credencial da API";
  const data = { login: label.slice(0, 120), passwordEnc: encryptSecret(token), status: "CONECTADA", lastError: null };
  await prisma.mondeIntegration.upsert({
    where: { companyId: ctx.companyId },
    create: { companyId: ctx.companyId, ...data },
    // credencial nova: as importações recomeçam do início (o que já veio é reconhecido e não duplica)
    update: { ...data, nextPage: 1, peopleCursor: null, importing: false, salesCursor: null, salesImporting: false },
  });
  await prisma.$transaction((tx) => audit(tx, ctx, "monde.conectado", "MondeIntegration", null, { versao: "v3" }));
}

export async function disconnectMonde(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  await prisma.mondeIntegration.deleteMany({ where: { companyId: ctx.companyId } });
  await prisma.$transaction((tx) => audit(tx, ctx, "monde.desconectado", "MondeIntegration", null));
}

async function loadConnection(ctx: Ctx) {
  const m = await prisma.mondeIntegration.findUnique({ where: { companyId: ctx.companyId } });
  if (!m) throw new AppError("Conecte o Monde primeiro.");
  let token: string;
  try {
    token = decryptSecret(m.passwordEnc);
  } catch {
    throw new AppError("Conecte o Monde de novo com a credencial da API.");
  }
  // conexão antiga (API v2, login e senha) não serve para a v3
  if (m.login.includes("@")) throw new AppError("A conexão com o Monde mudou: desconecte e conecte de novo com a credencial da API (Cadastros > Integrações > API Monde).");
  return { m, token };
}

// ------------------------------ Importação de clientes ------------------------------

/** Recomeça a importação de clientes do início (traz os cadastrados depois). */
export async function restartMondeImport(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  await prisma.mondeIntegration.update({
    where: { companyId: ctx.companyId },
    data: { nextPage: 1, peopleCursor: null, totalPages: null, importing: true, createdCount: 0, updatedCount: 0, skippedCount: 0, lastError: null },
  });
}

/**
 * Importa as páginas de pessoas que couberem em ~25 s e devolve o progresso. A tela chama de novo
 * até `done`. Retomável: guarda o cursor da próxima página. Vendedores e companhias aéreas não são clientes.
 */
export async function importMondeBatch(ctx: Ctx) {
  assertCan(ctx, "clients.manage");
  assertCan(ctx, "settings.manage");
  const { m, token } = await loadConnection(ctx);
  const reader = new MondeReader(token);
  const started = Date.now();
  let cursor = m.nextPage > 1 ? m.peopleCursor : null;
  let pages = m.nextPage - 1;
  let done = false;
  const count = { created: 0, updated: 0, skipped: 0 };
  try {
    const sellerPeople = new Set((await reader.sellers()).values());
    while (Date.now() - started < BATCH_BUDGET_MS()) {
      const r = await mondeGet<Page<MondePerson>>(token, withCursor("/people?size=50", cursor));
      for (const p of r?.data ?? []) {
        if (sellerPeople.has(p.id) || p.airline?.code) {
          count.skipped++;
          continue;
        }
        try {
          const city = await reader.cityOf(p);
          const out = await prisma.$transaction((tx) => upsertImportedClient(tx, ctx, mapMondePerson(p, city), { mondeId: p.id }));
          if (out.outcome === "criado") count.created++;
          else if (out.outcome === "atualizado") count.updated++;
          else count.skipped++;
        } catch {
          count.skipped++; // sem nome ou dado inválido
        }
      }
      pages++;
      if (!r?.pagination?.has_next_page || !r.pagination.next_cursor) {
        done = true;
        break;
      }
      cursor = r.pagination.next_cursor;
    }
    const saved = await prisma.mondeIntegration.update({
      where: { companyId: ctx.companyId },
      data: {
        nextPage: done ? 1 : pages + 1,
        peopleCursor: done ? null : cursor,
        totalPages: null,
        importing: !done,
        createdCount: { increment: count.created },
        updatedCount: { increment: count.updated },
        skippedCount: { increment: count.skipped },
        status: "CONECTADA",
        lastError: null,
        ...(done ? { lastImportAt: new Date() } : {}),
      },
    });
    if (done) await prisma.$transaction((tx) => audit(tx, ctx, "clientes.importados", "Client", null, { origem: "monde", criados: saved.createdCount, atualizados: saved.updatedCount }));
    return { done, page: pages, totalPages: null, created: saved.createdCount, updated: saved.updatedCount, skipped: saved.skippedCount };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Falha de comunicação com o Monde.";
    await prisma.mondeIntegration.update({ where: { companyId: ctx.companyId }, data: { nextPage: pages + 1, peopleCursor: cursor, status: "ERRO", lastError: msg } });
    throw e instanceof AppError ? e : new AppError(msg);
  }
}

// ------------------------------ Importação de vendas ------------------------------

type MondeBill = { id: string; amount?: number; final_amount?: number; due_date?: string; settlement_date?: string | null; canceled?: boolean; payment_method?: Ref };
type ProductPassenger = { canceled_at?: string | null; person?: Ref };
type MondeProduct = Obj & {
  id: string;
  status?: string;
  currency?: string;
  commission_amount?: number;
  over?: number;
  agency_fee?: number;
  cc_rav_fee?: number;
  cc_du_fee?: number;
  totals?: { customer_amount?: number; rav_fee?: number; rav_fee_discount?: number; du_fee?: number; du_fee_discount?: number; agency_fee?: number };
  supplier?: Ref;
  representative?: Ref;
  passengers?: ProductPassenger[];
};
type PaymentRow = { id?: string; due_date?: string; amount?: number; payment_method?: Ref; products?: { sale_product?: Ref }[] };
export type MondeSale = {
  id: string;
  sale_number?: number;
  sale_date: string;
  departure_date?: string | null;
  return_date?: string | null;
  status?: string;
  observations?: string | null;
  seller?: Ref;
  payer?: Ref;
  intermediary?: Ref;
  payments?: {
    agency?: { bills?: Ref[]; credit?: PaymentRow[]; to_invoice?: { bill?: Ref; amount?: number }[]; retained_by_intermediary?: PaymentRow[]; legacy?: PaymentRow[] };
    vendor?: Record<string, PaymentRow[] | undefined>;
  };
  commissions?: { amount?: number; balance?: number; person?: Ref }[];
  financial?: { vendor_items?: { kind?: string; amount?: number; due_date?: string; sale_product?: Ref; bill?: Ref }[] };
} & Partial<Record<(typeof KINDS)[number], MondeProduct[]>>;
type SaleError = { id: string; numero: number | null; motivo: string };

const KINDS = [
  "airline_tickets",
  "hotels",
  "travel_packages",
  "cvc_packages",
  "cruises",
  "insurances",
  "car_rentals",
  "ground_transportations",
  "train_tickets",
  "excursions",
  "visas",
  "operations",
  "others",
] as const;
const PRODUCT_TYPE: Record<(typeof KINDS)[number], ProductType> = {
  airline_tickets: "AEREO",
  hotels: "HOTEL",
  travel_packages: "PACOTE",
  cvc_packages: "PACOTE",
  cruises: "CRUZEIRO",
  insurances: "SEGURO",
  car_rentals: "LOCACAO",
  ground_transportations: "TRANSFER",
  train_tickets: "TRANSFER",
  excursions: "EXCURSAO",
  visas: "OUTROS",
  operations: "OUTROS",
  others: "OUTROS",
};
const SUPPLIER_CATEGORY: Record<ProductType, string> = {
  AEREO: "CIA_AEREA",
  HOTEL: "HOTEL",
  PACOTE: "OPERADORA",
  CRUZEIRO: "OPERADORA",
  SEGURO: "SEGURADORA",
  TRANSFER: "TRANSPORTADORA",
  PASSEIO: "RECEPTIVO",
  LOCACAO: "OUTROS",
  EXCURSAO: "OPERADORA",
  OUTROS: "OUTROS",
};

const cents = (v: unknown) => Math.round((typeof v === "number" ? v : Number(v ?? 0) || 0) * 100);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Forma de pagamento do Monde (nome livre) para as formas da gestão. */
export function mapPaymentMethod(name: string | null): PaymentMethod {
  const n = norm(name ?? "");
  if (!n) return "OUTRO";
  if (n.includes("pix")) return "PIX";
  if (n.includes("boleto")) return "BOLETO";
  if (n.includes("debito em conta") || n.includes("debito automatico")) return "DEBITO_CONTA";
  if (n.includes("debito")) return "CARTAO_DEBITO";
  if (n.includes("cartao") || n.includes("credito") || n.includes("credit")) return "CARTAO_CREDITO";
  if (n.includes("transfer") || n.includes("ted") || n.includes("doc") || n.includes("deposito")) return "TRANSFERENCIA";
  if (n.includes("dinheiro") || n.includes("especie")) return "DINHEIRO";
  return "OUTRO";
}

/** Texto curto do produto (o Monde guarda os detalhes em campos diferentes por tipo). */
function productDescription(kind: (typeof KINDS)[number], p: MondeProduct) {
  const segs = (p.segments as { origin?: string; destination?: string }[] | undefined) ?? [];
  const route = segs.length ? `${segs[0].origin ?? ""} → ${segs[segs.length - 1].destination ?? ""}` : null;
  const parts = [
    kind === "airline_tickets" ? route : null,
    str(p.package_name),
    str(p.ship_name),
    str(p.cruise_destination),
    str(p.room_category),
    str(p.vehicle_category),
    str(p.visa_type),
    str(p.destination_country),
    kind !== "airline_tickets" ? route : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ").slice(0, 300) : null;
}
function productStart(p: MondeProduct) {
  return date(p.begin_date) ?? date(p.check_in) ?? date(p.departure_date) ?? date(p.pickup_date) ?? date((p.segments as { departure_date?: string }[] | undefined)?.[0]?.departure_date);
}
function productLocator(p: MondeProduct) {
  return (str(p.locator) ?? str(p.booking_number) ?? str(p.document))?.slice(0, 60) ?? null;
}
function saleDestination(d: MondeSale) {
  for (const k of KINDS)
    for (const p of d[k] ?? []) {
      if (p.status && p.status !== "active") continue;
      const segs = (p.segments as { destination?: string }[] | undefined) ?? [];
      const dest = str(p.package_name) ?? str(p.cruise_destination) ?? str(p.destination_country) ?? (segs.length ? str(segs[0].destination) : null);
      if (dest) return dest.slice(0, 120);
    }
  return null;
}

/** Monta e grava uma venda do Monde na gestão (com o financeiro) e dá baixa no que já está pago lá. */
async function importOneSale(ctx: Ctx, reader: MondeReader, mondeId: string, env: ImportEnv): Promise<"criada" | "ignorada"> {
  const d = (await reader.get(`/sales/${mondeId}`)) as MondeSale | null;
  if (!d) return "ignorada"; // excluída no Monde
  const notes: string[] = [`Importada do Monde (venda nº ${d.sale_number ?? "?"}).`];

  // produtos ativos com valor
  const products = KINDS.flatMap((k) => (d[k] ?? []).filter((p) => (!p.status || p.status === "active") && cents(p.totals?.customer_amount) > 0).map((p) => ({ kind: k, p })));
  if (!products.length) return "ignorada";
  if (products.some(({ p }) => p.currency && p.currency !== "BRL")) notes.push("Há produto em moeda estrangeira no Monde: os valores vieram convertidos em reais.");

  // cliente (pagante)
  if (!d.payer?.id) throw new AppError("venda sem pagante no Monde");
  const clientId = await ensureClient(ctx, reader, d.payer.id);

  // vendedor: pelo nome da pessoa do vendedor; sem correspondência, fica com quem importou
  const sellerPersonId = d.seller?.id ? (await reader.sellers()).get(d.seller.id) : undefined;
  const sellerPerson = sellerPersonId ? await reader.person(sellerPersonId) : null;
  let sellerId = ctx.userId;
  if (sellerPerson?.name) {
    const match = env.users.find((u) => norm(u.name) === norm(sellerPerson.name!));
    if (match) sellerId = match.id;
    else notes.push(`Vendedor no Monde: ${sellerPerson.name} (não há usuário com esse nome na gestão).`);
  }

  // como o cliente pagou cada produto: o que aparece em "pagamentos ao fornecedor" o cliente pagou direto
  const vendorPaid = new Set(
    Object.values(d.payments?.vendor ?? {})
      .flatMap((rows) => rows ?? [])
      .flatMap((r) => r.products ?? [])
      .map((x) => x.sale_product?.id)
      .filter(Boolean) as string[],
  );
  const vendorItems = (d.financial?.vendor_items ?? []).filter((v) => v.kind === "invoice");

  const items = [];
  const meta: { mondeProductId: string }[] = [];
  for (const { kind, p } of products) {
    const t = p.totals ?? {};
    const charge = cents(t.customer_amount);
    const rav = Math.max(0, cents(t.rav_fee) - cents(t.rav_fee_discount));
    const du = Math.max(0, cents(t.du_fee) - cents(t.du_fee_discount));
    const price = charge - rav - du;
    if (price <= 0) continue;
    const productType = PRODUCT_TYPE[kind];
    const supplierId = p.supplier?.id ? await ensureSupplier(ctx, reader, p.supplier.id, SUPPLIER_CATEGORY[productType]) : null;
    const operatorId = p.representative?.id ? await ensureSupplier(ctx, reader, p.representative.id, "CONSOLIDADORA") : null;
    const commission = Math.max(0, cents(p.commission_amount));
    const agencyFee = Math.max(0, cents(t.agency_fee ?? p.agency_fee));
    const over = Math.max(0, cents(p.over));
    const mine = vendorItems.filter((v) => v.sale_product?.id === p.id);
    const due = mine.map((v) => date(v.due_date)).filter(Boolean).sort()[0] ?? null;
    let model: CommercialModel;
    let costCents = 0;
    let supplierCommissionCents = 0;
    let cardFeeCents = 0;
    if (vendorPaid.has(p.id)) {
      model = "COMISSAO";
      supplierCommissionCents = Math.min(price, commission + agencyFee);
      cardFeeCents = Math.min(rav + du, Math.max(0, cents(p.cc_rav_fee) + cents(p.cc_du_fee)));
    } else {
      model = "INTERMEDIACAO";
      // o repasse ao fornecedor é o que o Monde lançou para ele; sem isso, o valor menos a parte da agência
      const fromMonde = mine.reduce((a, v) => a + cents(v.amount), 0);
      costCents = Math.max(0, Math.min(price, fromMonde > 0 ? fromMonde : price - commission - agencyFee));
    }
    items.push({
      productType,
      description: productDescription(kind, p),
      supplierId,
      operatorId: operatorId && operatorId !== supplierId ? operatorId : null,
      commercialModel: model,
      priceCents: price,
      costCents,
      supplierCommissionCents,
      ravCents: rav,
      duCents: du,
      overCents: over,
      cardFeeCents,
      supplierDueDate: due,
      locator: productLocator(p),
      supplierPayment: model === "COMISSAO" ? "CLIENTE_DIRETO" : "FATURADO",
    });
    meta.push({ mondeProductId: p.id });
  }
  if (!items.length) return "ignorada";

  // parcelas do cliente: as contas a receber da venda no Monde
  type Planned = { key: string; dueDate: string; amountCents: number; method: PaymentMethod; description: string | null; paidAt: string | null };
  const plan: Planned[] = [];
  const agency = d.payments?.agency ?? {};
  for (const ref of agency.bills ?? []) {
    if (!ref?.id) continue;
    const b = await reader.bill(ref.id);
    if (!b || b.canceled) continue;
    const amount = cents(b.amount ?? b.final_amount);
    if (amount <= 0) continue;
    plan.push({
      key: b.id,
      dueDate: date(b.due_date) ?? d.sale_date,
      amountCents: amount,
      method: mapPaymentMethod(await reader.paymentMethodName(b.payment_method?.id)),
      description: null,
      paidAt: date(b.settlement_date),
    });
  }
  for (const f of agency.to_invoice ?? []) {
    const b = f.bill?.id ? await reader.bill(f.bill.id) : null;
    const amount = cents(f.amount);
    if (amount <= 0) continue;
    plan.push({ key: `fat-${f.bill?.id ?? plan.length}`, dueDate: date(b?.due_date) ?? d.sale_date, amountCents: amount, method: "BOLETO", description: "Faturado ao cliente", paidAt: b && !b.canceled ? date(b.settlement_date) : null });
  }
  for (const [rows, label, paid] of [
    [agency.legacy, null, false],
    [agency.credit, "Crédito do cliente", true],
    [agency.retained_by_intermediary, "Retido pelo intermediário", true],
  ] as const) {
    for (const r of rows ?? []) {
      const amount = cents(r.amount);
      if (amount <= 0) continue;
      const dueDate = date(r.due_date) ?? d.sale_date;
      plan.push({
        key: `${label ? "c" : "l"}-${r.id ?? plan.length}`,
        dueDate,
        amountCents: amount,
        method: label ? "OUTRO" : mapPaymentMethod(await reader.paymentMethodName(r.payment_method?.id)),
        description: label,
        paidAt: paid ? dueDate : null,
      });
    }
  }

  // o total das parcelas precisa fechar com o que a agência cobra: a diferença vira taxa ou desconto da venda
  const sellerCommission = sellerPersonId ? (d.commissions ?? []).filter((c) => c.person?.id === sellerPersonId).reduce((a, c) => a + cents(c.amount), 0) : 0;
  const intermediaryId = d.intermediary?.id ? await ensureSupplier(ctx, reader, d.intermediary.id, "INTERMEDIARIO") : null;
  const intermediaryCommission = d.intermediary?.id ? (d.commissions ?? []).filter((c) => c.person?.id === d.intermediary!.id).reduce((a, c) => a + cents(c.amount), 0) : 0;
  const base = calculateSale(items, 0, 0, { mode: "VALOR", amountCents: 0 });
  let feesCents = 0;
  let discountCents = 0;
  const planTotal = plan.reduce((a, p) => a + p.amountCents, 0);
  if (!plan.length && base.clientPayableCents > 0) {
    plan.push({ key: "monde-saldo", dueDate: d.sale_date, amountCents: base.clientPayableCents, method: "OUTRO", description: "Sem parcela lançada no Monde", paidAt: null });
    notes.push("A venda não tinha parcelas no Monde: a gestão criou uma parcela com o valor total. Confira.");
  } else if (planTotal !== base.clientPayableCents) {
    const diff = planTotal - base.clientPayableCents;
    if (diff > 0) feesCents = diff;
    else discountCents = Math.min(-diff, base.clientPayableCents);
    if (base.clientPayableCents + feesCents - discountCents !== planTotal) throw new AppError("as parcelas do Monde não fecham com os produtos");
    const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    notes.push(`Ajuste de ${diff > 0 ? "taxa" : "desconto"} de ${brl(Math.abs(diff))} para fechar com as parcelas do Monde.`);
  }

  // passageiros
  const paxIds = [...new Set(products.flatMap(({ p }) => (p.passengers ?? []).filter((x) => !x.canceled_at).map((x) => x.person?.id)).filter(Boolean) as string[])].slice(0, 50);
  const passengers = [];
  for (const pid of paxIds) {
    const pp = await reader.person(pid);
    if (!pp?.name || pp.name.trim().length < 2) continue;
    const linked = await prisma.client.findFirst({ where: { companyId: ctx.companyId, mondeId: pid }, select: { id: true } });
    passengers.push({
      name: pp.name.trim().slice(0, 120),
      document: str(pp.cpf_cnpj)?.slice(0, 20) ?? null,
      birthDate: date(pp.birthdate),
      passportNumber: str(pp.passport_number)?.replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || null,
      passportExpiry: date(pp.passport_expiration_date),
      clientId: linked?.id ?? null,
    });
  }

  const tripStart = date(d.departure_date) ?? products.map(({ p }) => productStart(p)).filter(Boolean).sort()[0] ?? null;
  const tripEndRaw = date(d.return_date);
  const tripEnd = tripStart && tripEndRaw && tripEndRaw >= tripStart ? tripEndRaw : null;
  if (str(d.observations)) notes.push(`Observações no Monde: ${str(d.observations)}`);

  const r = await createSale(
    ctx,
    {
      saleDate: date(d.sale_date),
      clientId,
      sellerId,
      destination: saleDestination(d),
      tripStart,
      tripEnd,
      passengerCount: Math.max(1, passengers.length),
      locator: productLocator(products[0].p),
      notes: notes.join("\n").slice(0, 2000),
      feesCents,
      discountCents,
      intermediaryId: intermediaryCommission > 0 ? intermediaryId : null,
      intermediaryCommissionCents: intermediaryId ? intermediaryCommission : 0,
      commission: { mode: "VALOR", amountCents: sellerCommission },
      items,
      payments: plan.map(({ paidAt: _p, ...p }) => (void _p, p)),
      passengers,
      confirm: true,
    },
    { origin: "MONDE", externalRef: `monde:${d.id}` },
  );

  // voos dos bilhetes aéreos (Central da Viagem)
  const segments = products.filter(({ kind }) => kind === "airline_tickets").flatMap(({ p }) => (p.segments as Parameters<typeof saveMondeFlights>[3] | undefined) ?? []);
  if (segments.length) await prisma.$transaction((tx) => saveMondeFlights(tx, ctx.companyId, r.id, segments));

  // baixa do que já está pago no Monde
  await prisma.$transaction(async (tx) => {
    const settle = async (kind: "receivable" | "payable", e: { id: string; amountCents: number; settledCents: number; status: string; method?: string | null }, when: string, what: string) => {
      const balance = e.amountCents - e.settledCents;
      if (balance <= 0 || e.status === "CANCELADO") return;
      await settleEntryTx(
        tx,
        ctx,
        kind,
        e.id,
        { date: when, amountCents: balance, interestCents: 0, discountCents: 0, accountId: env.accountId, method: e.method ?? null, notes: `Pago no Monde (${what}).` },
        { viaInvoice: false },
      );
    };
    // parcelas do cliente
    const recs = await tx.receivable.findMany({ where: { companyId: ctx.companyId, saleId: r.id, origin: "VENDA" } });
    for (const p of plan) {
      if (!p.paidAt) continue;
      const e = recs.find((x) => x.sourceKey === `venda:${r.id}:parcela:${p.key}`);
      if (e) await settle("receivable", e, p.paidAt, "parcela");
    }
    // fornecedores: o produto está acertado quando todas as contas do fornecedor dele estão liquidadas no Monde
    const saleItems = await tx.saleItem.findMany({ where: { saleId: r.id }, orderBy: { sortOrder: "asc" }, select: { id: true } });
    const lastPaid: string[] = plan.map((p) => p.paidAt).filter(Boolean) as string[];
    for (let i = 0; i < saleItems.length; i++) {
      const mine = vendorItems.filter((v) => v.sale_product?.id === meta[i]?.mondeProductId && v.bill?.id);
      if (!mine.length) continue;
      const bills = await Promise.all(mine.map((v) => reader.bill(v.bill!.id)));
      if (bills.some((b) => !b || b.canceled || !date(b.settlement_date))) continue;
      const when = bills.map((b) => date(b!.settlement_date)!).sort().at(-1)!;
      lastPaid.push(when);
      const entries = [
        ...(await tx.payable.findMany({ where: { companyId: ctx.companyId, saleId: r.id, saleItemId: saleItems[i].id, origin: "CUSTO_VENDA" } })).map((e) => ["payable", e] as const),
        ...(await tx.receivable.findMany({ where: { companyId: ctx.companyId, saleId: r.id, origin: "COMISSAO_FORNECEDOR", sourceKey: { startsWith: `item:${saleItems[i].id}:` } } })).map((e) => ["receivable", e] as const),
      ];
      for (const [kind, e] of entries) await settle(kind, e, when, "fornecedor");
    }
    // comissões: saldo zerado no Monde = paga
    const commissionPaid = (personId: string | undefined) => {
      const rows = (d.commissions ?? []).filter((c) => personId && c.person?.id === personId && cents(c.amount) > 0);
      return rows.length > 0 && rows.every((c) => cents(c.balance) === 0);
    };
    const when = lastPaid.sort().at(-1) ?? d.sale_date;
    if (commissionPaid(sellerPersonId)) {
      const e = await tx.payable.findFirst({ where: { companyId: ctx.companyId, sourceKey: `comissao:${r.id}` } });
      if (e) await settle("payable", e, when, "comissão do vendedor");
    }
    if (commissionPaid(d.intermediary?.id)) {
      for (const e of await tx.payable.findMany({ where: { companyId: ctx.companyId, saleId: r.id, origin: "COMISSAO_INTERMEDIARIO" } })) await settle("payable", e, when, "comissão do intermediário");
    }
  });
  return "criada";
}

type ImportEnv = { accountId: string; users: { id: string; name: string }[] };

/** Cliente da venda: pelo vínculo com o Monde, pelo CPF/e-mail ou cadastrado agora. */
async function ensureClient(ctx: Ctx, reader: MondeReader, personId: string) {
  const linked = await prisma.client.findFirst({ where: { companyId: ctx.companyId, mondeId: personId }, select: { id: true, archivedAt: true } });
  if (linked && !linked.archivedAt) return linked.id;
  const p = await reader.person(personId);
  if (!p) throw new AppError("o pagante não foi encontrado no Monde");
  const city = await reader.cityOf(p);
  const out = await prisma.$transaction((tx) => upsertImportedClient(tx, ctx, mapMondePerson(p, city), { mondeId: personId }));
  return out.id;
}

/** Fornecedor (ou consolidadora/intermediário) pelo vínculo com o Monde, pelo CNPJ ou pelo nome. */
async function ensureSupplier(ctx: Ctx, reader: MondeReader, personId: string, category: string) {
  const linked = await prisma.supplier.findFirst({ where: { companyId: ctx.companyId, mondeId: personId }, select: { id: true } });
  if (linked) return linked.id;
  const p = await reader.person(personId);
  const name = (p?.name || p?.legal_name || "").trim().slice(0, 150);
  if (!name) return null;
  const doc = (p?.cpf_cnpj ?? "").replace(/\D/g, "") || null;
  const found =
    (doc && (await prisma.supplier.findFirst({ where: { companyId: ctx.companyId, document: doc }, select: { id: true } }))) ||
    (await prisma.supplier.findFirst({ where: { companyId: ctx.companyId, name: { equals: name } }, select: { id: true } }));
  if (found) {
    await prisma.supplier.update({ where: { id: found.id }, data: { mondeId: personId } });
    return found.id;
  }
  const s = await prisma.supplier.create({
    data: { companyId: ctx.companyId, name, document: doc, email: p?.email ?? null, phone: p?.phone_number || p?.mobile_number || null, category, mondeId: personId, notes: "Cadastrado pela importação de vendas do Monde." },
  });
  return s.id;
}

/** Conta onde entram as baixas do que já estava pago no Monde (não mexe no saldo dos bancos). */
async function importAccount(ctx: Ctx) {
  const found = await prisma.financialAccount.findFirst({ where: { companyId: ctx.companyId, name: IMPORT_ACCOUNT_NAME } });
  if (found) {
    if (!found.active) await prisma.financialAccount.update({ where: { id: found.id }, data: { active: true } });
    return found.id;
  }
  const a = await prisma.financialAccount.create({ data: { companyId: ctx.companyId, name: IMPORT_ACCOUNT_NAME, type: "OUTRA" } });
  return a.id;
}

export async function restartMondeSalesImport(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  await prisma.mondeIntegration.update({
    where: { companyId: ctx.companyId },
    data: { salesCursor: null, salesImporting: true, salesCreated: 0, salesSkipped: 0, salesFailed: 0, salesErrorsJson: "[]", lastError: null },
  });
}

/**
 * Importa as vendas que couberem em ~25 s e devolve o progresso; a tela chama de novo até `done`.
 * Retomável: guarda o cursor da página em andamento. Venda já importada é reconhecida e pulada;
 * venda que falhou fica na lista de falhas (com o motivo) e não é tentada de novo nesta rodada.
 */
export async function importMondeSalesBatch(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  assertCan(ctx, "sales.create");
  assertCan(ctx, "sales.edit_all");
  assertCan(ctx, "finance.manage");
  const { m, token } = await loadConnection(ctx);
  const reader = new MondeReader(token);
  const started = Date.now();
  const env: ImportEnv = {
    accountId: await importAccount(ctx),
    users: await prisma.user.findMany({ where: { companyId: ctx.companyId, active: true }, select: { id: true, name: true } }),
  };
  const errors: SaleError[] = JSON.parse(m.salesErrorsJson || "[]");
  const failedIds = new Set(errors.map((e) => e.id));
  let cursor = m.salesCursor;
  let done = false;
  const count = { created: 0, skipped: 0, failed: 0 };
  try {
    pages: while (Date.now() - started < BATCH_BUDGET_MS()) {
      const r = await mondeGet<Page<{ id: string; sale_number?: number }>>(token, withCursor("/sales?size=20&status=opened,closed", cursor));
      const rows = r?.data ?? [];
      const known = new Set(
        (await prisma.sale.findMany({ where: { companyId: ctx.companyId, externalRef: { in: rows.map((s) => `monde:${s.id}`) } }, select: { externalRef: true } })).map((s) => s.externalRef),
      );
      for (const s of rows) {
        if (known.has(`monde:${s.id}`) || failedIds.has(s.id)) continue;
        if (Date.now() - started > BATCH_BUDGET_MS()) break pages; // a página fica para a próxima chamada
        try {
          const out = await importOneSale(ctx, reader, s.id, env);
          if (out === "criada") count.created++;
          else {
            count.skipped++;
            failedIds.add(s.id); // sem produto ativo: não tenta de novo nesta rodada
            errors.push({ id: s.id, numero: s.sale_number ?? null, motivo: "sem produto ativo com valor (ignorada)" });
          }
        } catch (e) {
          if (e instanceof AppError && /credencial|negou o acesso|aguardar/.test(e.message)) throw e; // problema geral, não da venda
          count.failed++;
          failedIds.add(s.id);
          errors.push({ id: s.id, numero: s.sale_number ?? null, motivo: (e instanceof ZodError ? (e.issues[0]?.message ?? "dado inválido") : e instanceof Error ? e.message : "erro").slice(0, 200) });
        }
      }
      if (!r?.pagination?.has_next_page || !r.pagination.next_cursor) {
        done = true;
        break;
      }
      cursor = r.pagination.next_cursor;
    }
    const saved = await prisma.mondeIntegration.update({
      where: { companyId: ctx.companyId },
      data: {
        salesCursor: done ? null : cursor,
        salesImporting: !done,
        salesCreated: { increment: count.created },
        salesSkipped: { increment: count.skipped },
        salesFailed: { increment: count.failed },
        salesErrorsJson: JSON.stringify(errors.slice(-300)),
        status: "CONECTADA",
        lastError: null,
        ...(done ? { salesLastImportAt: new Date() } : {}),
      },
    });
    if (done) await prisma.$transaction((tx) => audit(tx, ctx, "vendas.importadas", "Sale", null, { origem: "monde", criadas: saved.salesCreated, falhas: saved.salesFailed }));
    return { done, created: saved.salesCreated, skipped: saved.salesSkipped, failed: saved.salesFailed };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Falha de comunicação com o Monde.";
    await prisma.mondeIntegration.update({
      where: { companyId: ctx.companyId },
      data: {
        salesCursor: cursor,
        salesCreated: { increment: count.created },
        salesSkipped: { increment: count.skipped },
        salesFailed: { increment: count.failed },
        salesErrorsJson: JSON.stringify(errors.slice(-300)),
        status: "ERRO",
        lastError: msg,
      },
    });
    throw e instanceof AppError ? e : new AppError(msg);
  }
}

/**
 * Busca no Monde os voos das vendas já importadas que ainda não têm voo cadastrado (vendas trazidas antes
 * da Central da Viagem), sem importar a venda de novo. A tela chama em partes até `done`, passando o
 * último id conferido.
 */
export async function syncMondeFlightsBatch(ctx: Ctx, input: { afterId?: string | null }) {
  assertCan(ctx, "settings.manage");
  assertCan(ctx, "sales.edit_all");
  const { token } = await loadConnection(ctx);
  const reader = new MondeReader(token);
  const started = Date.now();
  let afterId = typeof input?.afterId === "string" && input.afterId ? input.afterId : null;
  const count = { checked: 0, updated: 0, flights: 0 };
  const where = () => ({
    companyId: ctx.companyId,
    origin: "MONDE",
    externalRef: { startsWith: "monde:" },
    items: { some: { productType: "AEREO" } },
    flights: { none: {} },
    ...(afterId ? { id: { gt: afterId } } : {}),
  });
  const finish = async (done: boolean) => ({ done, afterId: done ? null : afterId, ...count, remaining: done ? 0 : await prisma.sale.count({ where: where() }) });
  while (Date.now() - started < BATCH_BUDGET_MS()) {
    const sales = await prisma.sale.findMany({ where: where(), orderBy: { id: "asc" }, take: 20, select: { id: true, externalRef: true } });
    if (!sales.length) return finish(true);
    for (const s of sales) {
      if (Date.now() - started > BATCH_BUDGET_MS()) return finish(false);
      const d = (await reader.get(`/sales/${s.externalRef!.slice("monde:".length)}`)) as MondeSale | null;
      afterId = s.id;
      count.checked++;
      const segments = (d?.airline_tickets ?? []).filter((p) => !p.status || p.status === "active").flatMap((p) => (p.segments as Parameters<typeof saveMondeFlights>[3] | undefined) ?? []);
      if (!segments.length) continue;
      const n = await prisma.$transaction((tx) => saveMondeFlights(tx, ctx.companyId, s.id, segments));
      if (n) {
        count.updated++;
        count.flights += n;
      }
    }
  }
  return finish(false);
}
