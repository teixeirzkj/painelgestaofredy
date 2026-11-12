import "server-only";
/**
 * Painel da plataforma (equipe Frédy): administra as contas das agências.
 * Sessão própria (cookie fg_platform, claim kind=platform), totalmente separada da sessão das agências.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { isModuleKey, moduleLabel } from "@/lib/modules";
import { checkCompanyFlights, monitorStatus, saveMonitorSettings } from "./services/flight-monitor";
import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";
import { ensureExpenseCategories } from "./services/admin";
import { burnPasswordCheck } from "./services/login-guard";

const COOKIE = "fg_platform";
const MAX_AGE = 60 * 60 * 8;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET ausente ou muito curto.");
  return new TextEncoder().encode(s);
}

export type PlatformCtx = { id: string; name: string; email: string };

export async function createPlatformSession(id: string) {
  const token = await new SignJWT({ sub: id, kind: "platform" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
}

export async function destroyPlatformSession() {
  (await cookies()).delete(COOKIE);
}

export const getPlatformContext = cache(async (): Promise<PlatformCtx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== "platform" || !payload.sub) return null;
    const u = await prisma.platformUser.findUnique({ where: { id: payload.sub } });
    return u && u.active ? { id: u.id, name: u.name, email: u.email } : null;
  } catch {
    return null;
  }
});

export async function requirePlatform(): Promise<PlatformCtx> {
  const p = await getPlatformContext();
  if (!p) redirect("/plataforma/login");
  return p;
}

export async function requirePlatformAction(): Promise<PlatformCtx> {
  const p = await getPlatformContext();
  if (!p) throw new AppError("Sessão da plataforma expirada.", "UNAUTHENTICATED");
  return p;
}

async function platformAudit(p: PlatformCtx, action: string, companyId: string | null, data?: unknown) {
  await prisma.platformAudit.create({ data: { platformId: p.id, action, companyId, dataJson: data ? JSON.stringify(data) : null } });
}

// ------------------------------ Contas das agências ------------------------------

export async function listCompanies(q?: string) {
  await requirePlatformAction();
  const rows = await prisma.company.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { document: { contains: q.replace(/\D/g, "") || q } }] } : {},
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { users: true, sales: true, clients: true } },
      users: { where: { role: "ADMIN" }, select: { id: true, name: true, email: true, lastLoginAt: true, active: true }, orderBy: { createdAt: "asc" } },
    },
  });
  const lastLogins = await prisma.user.groupBy({ by: ["companyId"], _max: { lastLoginAt: true } });
  const lastBy = new Map(lastLogins.map((l) => [l.companyId, l._max.lastLoginAt]));
  return rows.map((c) => ({ ...c, lastLoginAt: lastBy.get(c.id) ?? null }));
}

export async function getCompanyDetail(id: string) {
  await requirePlatformAction();
  const c = await prisma.company.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { sales: true, clients: true, receivables: true, payables: true } },
    },
  });
  if (!c) throw new AppError("Agência não encontrada.", "NOT_FOUND");
  const [salesAgg, audit] = await Promise.all([
    prisma.sale.aggregate({ where: { companyId: id, status: { in: ["CONFIRMADA", "CONCLUIDA"] } }, _sum: { grossCents: true } }),
    prisma.platformAudit.findMany({ where: { companyId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { ...c, grossCents: salesAgg._sum.grossCents ?? 0, audit };
}

const password = z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(100);

const createSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da agência.").max(150),
  document: z.string().trim().max(20).optional().nullable().transform((v) => (v ? v.replace(/\D/g, "") || null : null)),
  timezone: z.string().default("America/Sao_Paulo"),
  plan: z.string().trim().max(40).default("PADRAO"),
  maxUsers: z.number().int().min(1).max(500).default(5),
  adminName: z.string().trim().min(2, "Informe o nome do administrador.").max(100),
  adminEmail: z.string().trim().toLowerCase().email("E-mail inválido."),
  adminPassword: password,
});

/** Cria a conta da agência com o primeiro administrador, conta financeira inicial e categorias padrão. */
export async function createCompanyAccount(p: PlatformCtx, raw: unknown) {
  const d = createSchema.parse(raw);
  if (await prisma.user.findUnique({ where: { email: d.adminEmail } }))
    throw new AppError("Este e-mail já é usado por outro login.", "CONFLICT", [{ field: "adminEmail", message: "E-mail já cadastrado." }]);
  const hash = await bcrypt.hash(d.adminPassword, 10);
  const company = await prisma.$transaction(async (tx) => {
    const c = await tx.company.create({
      data: { name: d.name, document: d.document, timezone: d.timezone, plan: d.plan, maxUsers: d.maxUsers, createdByPlatformId: p.id },
    });
    await tx.user.create({ data: { companyId: c.id, name: d.adminName, email: d.adminEmail, role: "ADMIN", passwordHash: hash } });
    await tx.financialAccount.create({ data: { companyId: c.id, name: "Conta principal", type: "BANCO" } });
    await ensureExpenseCategories(tx, c.id);
    return c;
  });
  await platformAudit(p, "agencia.criada", company.id, { name: d.name, adminEmail: d.adminEmail });
  return { id: company.id };
}

export async function setCompanyActive(p: PlatformCtx, id: string, active: boolean, reason?: string) {
  const c = await prisma.company.findUnique({ where: { id } });
  if (!c) throw new AppError("Agência não encontrada.", "NOT_FOUND");
  if (!active && (!reason || reason.trim().length < 3)) throw new AppError("Informe o motivo da suspensão.");
  await prisma.company.update({ where: { id }, data: { active, suspendedReason: active ? null : reason!.trim() } });
  await platformAudit(p, active ? "agencia.reativada" : "agencia.suspensa", id, { reason });
}

const planSchema = z.object({ plan: z.string().trim().min(1).max(40), maxUsers: z.number().int().min(1).max(500) });

export async function updateCompanyPlan(p: PlatformCtx, id: string, raw: unknown) {
  const d = planSchema.parse(raw);
  const users = await prisma.user.count({ where: { companyId: id, active: true } });
  if (d.maxUsers < users) throw new AppError(`A agência já tem ${users} usuários ativos.`);
  await prisma.company.update({ where: { id }, data: d });
  await platformAudit(p, "agencia.plano_alterado", id, d);
}

/** Redefine a senha de um usuário da agência (ex.: administrador perdeu o acesso). */
export async function resetUserPassword(p: PlatformCtx, companyId: string, userId: string, newPassword: string) {
  password.parse(newPassword);
  const u = await prisma.user.findFirst({ where: { id: userId, companyId } });
  if (!u) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, 10), active: true, sessionVersion: { increment: 1 } } });
  await platformAudit(p, "usuario.senha_redefinida", companyId, { userId, email: u.email });
}

/** Adiciona outro administrador à agência. */
export async function addCompanyAdmin(p: PlatformCtx, companyId: string, raw: unknown) {
  const d = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email("E-mail inválido."), password }).parse(raw);
  const c = await prisma.company.findUnique({ where: { id: companyId }, include: { _count: { select: { users: { where: { active: true } } } } } });
  if (!c) throw new AppError("Agência não encontrada.", "NOT_FOUND");
  if (c._count.users >= c.maxUsers) throw new AppError(`Limite de ${c.maxUsers} usuários do plano atingido.`);
  if (await prisma.user.findUnique({ where: { email: d.email } })) throw new AppError("Este e-mail já é usado por outro login.", "CONFLICT");
  await prisma.user.create({ data: { companyId, name: d.name, email: d.email, role: "ADMIN", passwordHash: await bcrypt.hash(d.password, 10) } });
  await platformAudit(p, "usuario.admin_criado", companyId, { email: d.email });
}

/**
 * Acesso de recuperação/primeiro acesso: enquanto as variáveis PLATFORM_BOOTSTRAP_EMAIL /
 * PLATFORM_BOOTSTRAP_PASSWORD estiverem definidas (senha com 10+ caracteres), o login com exatamente esses dados
 * cria o usuário da plataforma ou redefine a senha dele para a das variáveis, e o reativa.
 * Quem controla as variáveis da Vercel já controla o sistema, então isso não amplia o acesso.
 * Depois de entrar, remova as variáveis.
 */
async function bootstrapPlatformUser(email: string, pass: string) {
  const be = process.env.PLATFORM_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const bp = process.env.PLATFORM_BOOTSTRAP_PASSWORD?.trim();
  if (!be || !bp || bp.length < 10 || email !== be || pass.trim() !== bp) return;
  // só cria o PRIMEIRO acesso: com qualquer usuário da plataforma já criado, as variáveis não fazem mais nada
  // (antes elas redefiniam a senha a cada login, e esquecê-las na Vercel deixava uma porta aberta)
  if ((await prisma.platformUser.count()) > 0) return;
  await prisma.platformUser.create({ data: { name: "Administrador da plataforma", email: be, passwordHash: await bcrypt.hash(pass, 10) } });
}

export async function platformLogin(email: string, pass: string) {
  await bootstrapPlatformUser(email.trim().toLowerCase(), pass);
  const u = await prisma.platformUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  // sempre roda o bcrypt: o tempo de resposta não revela se o e-mail é da equipe da plataforma
  const passOk = u ? await bcrypt.compare(pass, u.passwordHash) : (await burnPasswordCheck(pass), false);
  if (!u || !u.active || !passOk) return null;
  await prisma.platformUser.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  return u;
}

export async function platformOverview() {
  await requirePlatformAction();
  const [companies, active, users, sales] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { active: true } }),
    prisma.user.count({ where: { active: true } }),
    prisma.sale.count(),
  ]);
  return { companies, active, suspended: companies - active, users, sales };
}

// ------------------------------ Módulos por agência ------------------------------

/** Liga ou desliga um módulo do painel para uma agência (vale para todos os usuários dela). */
export async function setCompanyModule(p: PlatformCtx, companyId: string, key: string, enabled: boolean) {
  if (!isModuleKey(key)) throw new AppError("Módulo desconhecido.");
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { modulesJson: true } });
  if (!c) throw new AppError("Agência não encontrada.", "NOT_FOUND");
  let current: Record<string, boolean> = {};
  try {
    current = JSON.parse(c.modulesJson || "{}") ?? {};
  } catch {
    current = {};
  }
  current[key] = !!enabled;
  await prisma.company.update({ where: { id: companyId }, data: { modulesJson: JSON.stringify(current) } });
  await platformAudit(p, enabled ? "agencia.modulo_ligado" : "agencia.modulo_desligado", companyId, { modulo: key, nome: moduleLabel(key) });
}

// ------------------------------ Monitor de voos (AeroDataBox) ------------------------------

export async function getMonitorStatus() {
  await requirePlatformAction();
  return monitorStatus();
}

export async function saveMonitor(p: PlatformCtx, raw: unknown) {
  const d = (raw ?? {}) as { key?: string; marketplace?: string; maxPerRun?: number };
  await saveMonitorSettings({ key: d.key, marketplace: d.marketplace, maxPerRun: d.maxPerRun });
  await platformAudit(p, "monitor_voos.configurado", null, { marketplace: d.marketplace, maxPerRun: d.maxPerRun, chaveTrocada: !!d.key });
}

/** Confere agora os voos de uma agência (respeita 1 consulta por voo por dia). */
export async function runMonitorForCompany(p: PlatformCtx, companyId: string) {
  const r = await checkCompanyFlights(companyId);
  await platformAudit(p, "monitor_voos.conferido", companyId, r);
  return r;
}
