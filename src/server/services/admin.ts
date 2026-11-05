/** Configurações administrativas: categorias de despesa, taxas de cartão, acessos, dados da agência e minha conta. */
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, type Tx } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { DEFAULT_EXPENSE_CATEGORIES, PAYABLE_CATEGORIES } from "@/lib/constants";
import { isIsoDate } from "@/lib/dates";

// ------------------------------ Categorias de despesa ------------------------------

/** Garante o catálogo padrão (idempotente). */
export async function ensureExpenseCategories(db: Tx | typeof prisma, companyId: string) {
  const count = await db.expenseCategory.count({ where: { companyId } });
  if (count > 0) return;
  let order = 0;
  for (const g of DEFAULT_EXPENSE_CATEGORIES)
    for (const it of g.items)
      await db.expenseCategory.upsert({
        where: { companyId_code: { companyId, code: it.code } },
        create: { companyId, code: it.code, name: it.name, group: g.group, system: !!it.system, inDre: it.inDre ?? true, sortOrder: order++ },
        update: {},
      });
}

export type CategoryInfo = { code: string; name: string; group: string; inDre: boolean; active: boolean };

export async function categoryMap(companyId: string): Promise<Map<string, CategoryInfo>> {
  await ensureExpenseCategories(prisma, companyId);
  const rows = await prisma.expenseCategory.findMany({ where: { companyId }, orderBy: [{ sortOrder: "asc" }] });
  const m = new Map(rows.map((r) => [r.code, r]));
  for (const code of PAYABLE_CATEGORIES.values) if (!m.has(code)) m.set(code, { code, name: PAYABLE_CATEGORIES.label(code), group: "Outros", inDre: true, active: true } as never);
  return m as Map<string, CategoryInfo>;
}

export async function assertPayableCategory(db: Tx, companyId: string, code: string) {
  if ((PAYABLE_CATEGORIES.values as readonly string[]).includes(code)) return;
  const c = await db.expenseCategory.findFirst({ where: { companyId, code, active: true } });
  if (!c) throw new AppError("Categoria de despesa inválida.");
}

export async function listExpenseCategories(ctx: Ctx) {
  await ensureExpenseCategories(prisma, ctx.companyId);
  const rows = await prisma.expenseCategory.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const groups: { name: string; items: typeof rows }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.name === r.group);
    if (!g) groups.push((g = { name: r.group, items: [] }));
    g.items.push(r);
  }
  return groups;
}

const categorySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(80),
  group: z.string().trim().min(2, "Informe o grupo.").max(60),
  inDre: z.boolean().default(true),
  active: z.boolean().default(true),
});

export async function saveExpenseCategory(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = categorySchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const c = await tx.expenseCategory.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!c) throw new AppError("Categoria não encontrada.", "NOT_FOUND");
      if (c.system && (!d.active || d.inDre !== c.inDre)) throw new AppError("Categoria usada pelas regras automáticas: só o nome e o grupo podem mudar.");
      await tx.expenseCategory.update({ where: { id }, data: d });
      await audit(tx, ctx, "categoria.alterada", "ExpenseCategory", id, d);
      return id;
    }
    const base = d.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "CATEGORIA";
    let code = base;
    for (let i = 2; await tx.expenseCategory.findFirst({ where: { companyId: ctx.companyId, code } }); i++) code = `${base}_${i}`;
    const last = await tx.expenseCategory.findFirst({ where: { companyId: ctx.companyId }, orderBy: { sortOrder: "desc" } });
    const c = await tx.expenseCategory.create({ data: { ...d, code, companyId: ctx.companyId, sortOrder: (last?.sortOrder ?? 0) + 1 } });
    await audit(tx, ctx, "categoria.criada", "ExpenseCategory", c.id, d);
    return c.id;
  });
}

// ------------------------------ Taxas de cartão ------------------------------

const cardFeeSchema = z
  .object({
    modality: z.enum(["CREDITO", "DEBITO"]),
    installmentsFrom: z.number().int().min(1).max(24),
    installmentsTo: z.number().int().min(1).max(24),
    rateBps: z.number().int().min(0).max(3000),
    settlementDays: z.number().int().min(0).max(365),
    brand: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
    active: z.boolean().default(true),
  })
  .refine((r) => r.installmentsTo >= r.installmentsFrom, { message: "Faixa de parcelas inválida.", path: ["installmentsTo"] });

export async function listCardFees(ctx: Ctx) {
  return prisma.cardFeeRate.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ modality: "asc" }, { installmentsFrom: "asc" }] });
}

export async function saveCardFee(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const d = cardFeeSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id) {
      if (!(await tx.cardFeeRate.findFirst({ where: { id, companyId: ctx.companyId } }))) throw new AppError("Taxa não encontrada.", "NOT_FOUND");
      await tx.cardFeeRate.update({ where: { id }, data: d });
    } else id = (await tx.cardFeeRate.create({ data: { ...d, companyId: ctx.companyId } })).id;
    await audit(tx, ctx, "taxa_cartao.salva", "CardFeeRate", id, d);
    return id;
  });
}

/** Taxa aplicável a um pagamento no cartão da agência (null = sem taxa cadastrada). */
export function pickCardFee<T extends { modality: string; installmentsFrom: number; installmentsTo: number; active: boolean }>(rates: T[], method: string, installments: number): T | null {
  const modality = method === "CARTAO_DEBITO" ? "DEBITO" : method === "CARTAO_CREDITO" ? "CREDITO" : null;
  if (!modality) return null;
  return rates.find((r) => r.active && r.modality === modality && installments >= r.installmentsFrom && installments <= r.installmentsTo) ?? null;
}

// ------------------------------ Log de acessos ------------------------------

export async function logAccess(data: { companyId?: string | null; userId?: string | null; email: string; type: "LOGIN" | "LOGOUT" | "FALHA"; ip?: string | null; userAgent?: string | null }) {
  try {
    await prisma.accessLog.create({ data: { ...data, ip: data.ip?.slice(0, 60) ?? null, userAgent: data.userAgent?.slice(0, 300) ?? null } });
    if (data.type === "LOGIN" && data.userId) await prisma.user.update({ where: { id: data.userId }, data: { lastLoginAt: new Date() } });
  } catch {
    // o registro de acesso nunca deve impedir o login
  }
}

export async function listAccessLogs(ctx: Ctx, f: { userId?: string; type?: string; from?: string; page?: number }) {
  assertCan(ctx, "settings.manage");
  const page = Math.max(1, f.page ?? 1);
  const where = {
    companyId: ctx.companyId,
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.from ? { createdAt: { gte: new Date(`${f.from}T00:00:00`) } } : {}),
  };
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const [items, total, today, users, last] = await Promise.all([
    prisma.accessLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.accessLog.count({ where }),
    prisma.accessLog.findMany({ where: { companyId: ctx.companyId, type: "LOGIN", createdAt: { gte: startToday } }, select: { userId: true } }),
    prisma.user.findMany({ where: { companyId: ctx.companyId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.accessLog.findFirst({ where: { companyId: ctx.companyId, type: "LOGIN" }, orderBy: { createdAt: "desc" } }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: items.map((i) => ({ ...i, userName: (i.userId && names.get(i.userId)) || i.email })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 30)),
    users,
    stats: { loginsToday: today.length, usersToday: new Set(today.map((t) => t.userId)).size, last: last ? { at: last.createdAt, name: (last.userId && names.get(last.userId)) || last.email } : null },
  };
}

// ------------------------------ Dados da agência ------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(2).max(150),
  tradeName: z.string().trim().max(150).optional().nullable().transform((v) => v || null),
  document: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  contactEmail: z.string().trim().max(150).optional().nullable().transform((v) => v || null),
  contactPhone: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  address: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  responsibleName: z.string().trim().max(150).optional().nullable().transform((v) => v || null),
  responsibleDocument: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  responsibleRole: z.string().trim().max(80).optional().nullable().transform((v) => v || null),
});

export async function updateCompanyProfile(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const d = profileSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: d });
    await audit(tx, ctx, "agencia.perfil_alterado", "Company", ctx.companyId, d);
  });
}

// ------------------------------ Minha conta ------------------------------

const meSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  birthDate: z.string().optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || isIsoDate(v), "Data inválida."),
});

export async function getMe(ctx: Ctx) {
  return prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { id: true, name: true, email: true, phone: true, birthDate: true, role: true, lastLoginAt: true } });
}

export async function updateMe(ctx: Ctx, raw: unknown) {
  const d = meSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ctx.userId }, data: d });
    await audit(tx, ctx, "conta.dados_alterados", "User", ctx.userId);
  });
}

const passwordSchema = z
  .object({ current: z.string().min(1, "Informe a senha atual."), next: z.string().min(8, "A nova senha deve ter ao menos 8 caracteres.").max(100), confirm: z.string() })
  .refine((p) => p.next === p.confirm, { message: "A confirmação não confere.", path: ["confirm"] });

export async function changePassword(ctx: Ctx, raw: unknown) {
  const d = passwordSchema.parse(raw);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await bcrypt.compare(d.current, u.passwordHash))) throw new AppError("Senha atual incorreta.", "VALIDATION", [{ field: "current", message: "Senha atual incorreta." }]);
  const hash = await bcrypt.hash(d.next, 10);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: ctx.userId }, data: { passwordHash: hash } });
    await audit(tx, ctx, "conta.senha_alterada", "User", ctx.userId);
  });
}
