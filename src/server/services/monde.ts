/**
 * Importação de clientes do Monde pela API oficial v2 (https://github.com/monde-sistemas/monde-api):
 * - POST /api/v2/tokens com login "usuario@agencia.monde.com.br" e a senha do Monde (token vale 1 hora);
 * - GET /api/v2/people?page[number]=N&page[size]=50 (JSON:API).
 * Limites documentados: 60 requisições por minuto por IP e 1 autenticação a cada 3 segundos.
 * A API do Monde não expõe vendas nem as imagens/anexos das pessoas; só o cadastro.
 */
import { prisma } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { decryptSecret, encryptSecret } from "../secrets";
import { upsertImportedClient, type ImportedClient } from "./client-import";

const BASE = "https://web.monde.com.br/api/v2";
const PAGE_SIZE = 50;
const spacingMs = () => Number(process.env.MONDE_SPACING_MS ?? 1100); // ~55 requisições por minuto, abaixo do limite de 60
const BATCH_BUDGET_MS = 25_000; // cada chamada importa o que couber neste tempo; a tela chama de novo até terminar

type Person = { id: string; attributes: Record<string, unknown> };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function paced() {
  const wait = lastCall + spacingMs() - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

async function mondeFetch(path: string, init: RequestInit & { token?: string } = {}) {
  await paced();
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new AppError("O Monde recusou o login e a senha. Confira o usuário (formato usuario@suaagencia.monde.com.br) e a senha.");
  if (res.status === 403) throw new AppError("O usuário do Monde não tem permissão. No Monde, ele precisa de acesso total.");
  if (res.status === 429) throw new AppError("O Monde pediu para aguardar (limite de requisições). Tente de novo em 1 minuto.");
  if (!res.ok) throw new AppError(`O Monde respondeu com erro ${res.status}. Tente de novo em instantes.`);
  return res.json() as Promise<{ data: unknown; links?: Record<string, string> }>;
}

async function getToken(login: string, password: string) {
  const r = await mondeFetch("/tokens", { method: "POST", body: JSON.stringify({ data: { type: "tokens", attributes: { login, password } } }) });
  const token = (r.data as { attributes?: { token?: string } })?.attributes?.token;
  if (!token) throw new AppError("O Monde não devolveu o token de acesso.");
  return token;
}

/** Converte uma pessoa do Monde (atributos documentados em v2/full_format.md) para o cadastro da gestão. */
export function mapMondePerson(p: Person): ImportedClient {
  const a = p.attributes;
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : a[k] == null ? null : String(a[k]));
  const cnpj = s("cnpj");
  return {
    name: s("name") ?? s("company-name") ?? "",
    tradeName: cnpj ? s("company-name") : null,
    document: s("cpf") || cnpj,
    rg: s("rg"),
    birthDate: s("birth-date"),
    email: s("email"),
    whatsapp: s("mobile-phone"),
    phone: s("phone") || s("business-phone"),
    zipCode: s("zip"),
    street: s("address"),
    number: s("number"),
    complement: s("complement"),
    district: s("district"),
    passportNumber: s("passport-number"),
    passportExpiry: s("passport-expiration"),
    notes: s("observations"),
    // gender é texto livre no Monde: normalizeGender aceita F/M/feminino/masculino e ignora o resto.
    // O Monde não tem nacionalidade nem RNE: estrangeiro não é deduzido daqui. (city é relacionamento; city-inscription não é usado.)
    gender: s("gender"),
  };
}

function lastPage(links?: Record<string, string>) {
  const m = links?.last?.match(/page(?:%5B|\[)number(?:%5D|\])=(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function getMonde(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const m = await prisma.mondeIntegration.findUnique({ where: { companyId: ctx.companyId } });
  if (!m) return null;
  const { passwordEnc: _p, ...rest } = m;
  void _p;
  return rest;
}

export async function connectMonde(ctx: Ctx, input: { login: string; password: string }) {
  assertCan(ctx, "settings.manage");
  const login = String(input.login ?? "").trim();
  const password = String(input.password ?? "");
  if (!/^[^\s]+@[^\s@]+\.monde\.com\.br$/i.test(login)) throw new AppError("Use o login no formato usuario@suaagencia.monde.com.br (se o Monde usa e-mail: email@dominio.com@suaagencia.monde.com.br).");
  if (!password) throw new AppError("Informe a senha do Monde.");
  await getToken(login, password); // valida antes de salvar
  const data = { login, passwordEnc: encryptSecret(password), status: "CONECTADA", lastError: null };
  await prisma.mondeIntegration.upsert({ where: { companyId: ctx.companyId }, create: { companyId: ctx.companyId, ...data }, update: data });
  await prisma.$transaction((tx) => audit(tx, ctx, "monde.conectado", "MondeIntegration", null, { login }));
}

export async function disconnectMonde(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  await prisma.mondeIntegration.deleteMany({ where: { companyId: ctx.companyId } });
  await prisma.$transaction((tx) => audit(tx, ctx, "monde.desconectado", "MondeIntegration", null));
}

/** Recomeça a importação do início (útil para trazer clientes novos cadastrados no Monde). */
export async function restartMondeImport(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  await prisma.mondeIntegration.update({ where: { companyId: ctx.companyId }, data: { nextPage: 1, totalPages: null, importing: true, createdCount: 0, updatedCount: 0, skippedCount: 0, lastError: null } });
}

/**
 * Importa um lote de páginas (o que couber em ~25 s respeitando o limite do Monde) e devolve o
 * progresso. A tela chama de novo até `done`. Retomável: guarda a próxima página no banco.
 */
export async function importMondeBatch(ctx: Ctx) {
  assertCan(ctx, "clients.manage");
  assertCan(ctx, "settings.manage");
  const m = await prisma.mondeIntegration.findUnique({ where: { companyId: ctx.companyId } });
  if (!m) throw new AppError("Conecte o Monde primeiro.");
  const started = Date.now();
  let page = m.nextPage;
  let total = m.totalPages;
  const count = { created: 0, updated: 0, skipped: 0 };
  try {
    const token = await getToken(m.login, decryptSecret(m.passwordEnc));
    // usuários do Monde (agentes da agência) não são clientes
    const users = await mondeFetch(`/people?filter[only_users]=true&page[size]=100`, { token });
    const userIds = new Set(((users.data as Person[]) ?? []).map((u) => u.id));
    while (Date.now() - started < BATCH_BUDGET_MS && (total == null || page <= total)) {
      const r = await mondeFetch(`/people?page[number]=${page}&page[size]=${PAGE_SIZE}&sort=registered-at`, { token });
      const people = (r.data as Person[]) ?? [];
      total = lastPage(r.links) ?? (people.length < PAGE_SIZE ? page : page + 1);
      for (const p of people) {
        if (userIds.has(p.id)) {
          count.skipped++;
          continue;
        }
        try {
          const out = await prisma.$transaction((tx) => upsertImportedClient(tx, ctx, mapMondePerson(p), { mondeId: p.id }));
          if (out.outcome === "criado") count.created++;
          else if (out.outcome === "atualizado") count.updated++;
          else count.skipped++;
        } catch {
          count.skipped++; // sem nome ou dado inválido
        }
      }
      page++;
      if (!people.length) break;
    }
    const done = total != null && page > total;
    const saved = await prisma.mondeIntegration.update({
      where: { companyId: ctx.companyId },
      data: {
        nextPage: done ? 1 : page,
        totalPages: total,
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
    return { done, page: done ? total : page - 1, totalPages: total, created: saved.createdCount, updated: saved.updatedCount, skipped: saved.skippedCount };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Falha de comunicação com o Monde.";
    await prisma.mondeIntegration.update({ where: { companyId: ctx.companyId }, data: { nextPage: page, status: "ERRO", lastError: msg } });
    throw e instanceof AppError ? e : new AppError(msg);
  }
}
