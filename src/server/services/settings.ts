import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, Prisma } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { userSchema } from "./schemas";
import { CONFIGURABLE } from "@/lib/permissions";

export async function getCompanySettings(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, include: { rolePermissions: true } });
  const users = await prisma.user.findMany({
    where: { companyId: ctx.companyId },
    select: { id: true, name: true, email: true, role: true, active: true, commissionRateBps: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  return {
    company: { ...company, webhookSecret: company.webhookSecret ? "••••••••" : null, apiKeyHash: undefined, hasApiKey: !!company.apiKeyHash },
    users,
    permissions: CONFIGURABLE.map((c) => {
      const o = company.rolePermissions.find((p) => p.role === c.role && p.permission === c.permission);
      return { ...c, allowed: o ? o.allowed : null };
    }),
  };
}

const companySchema = z.object({
  name: z.string().trim().min(2).max(150),
  document: z.string().trim().max(20).optional().nullable(),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Fuso horário inválido."),
  commissionPayDay: z.number().int().min(1).max(28),
  upcomingDueDays: z.number().int().min(1).max(60),
  upcomingTripDays: z.number().int().min(1).max(90),
  webhookUrl: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || /^https:\/\//.test(v), "Use uma URL https://"),
  webhookSecret: z.string().optional().nullable(),
});

export async function updateCompany(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "settings.manage");
  const d = companySchema.parse(raw);
  const { webhookSecret, ...rest } = d;
  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: ctx.companyId },
      data: { ...rest, ...(webhookSecret && webhookSecret !== "••••••••" ? { webhookSecret } : {}) },
    });
    await audit(tx, ctx, "empresa.alterada", "Company", ctx.companyId, { ...rest });
  });
}

export async function setRolePermission(ctx: Ctx, role: string, permission: string, allowed: boolean) {
  assertCan(ctx, "settings.manage");
  if (!CONFIGURABLE.some((c) => c.role === role && c.permission === permission)) throw new AppError("Permissão não configurável.");
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.upsert({
      where: { companyId_role_permission: { companyId: ctx.companyId, role, permission } },
      create: { companyId: ctx.companyId, role, permission, allowed },
      update: { allowed },
    });
    await audit(tx, ctx, "permissao.alterada", "RolePermission", null, { role, permission, allowed });
  });
}

export async function saveUser(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "users.manage");
  const d = userSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { maxUsers: true } });
      const activeCount = await tx.user.count({ where: { companyId: ctx.companyId, active: true, ...(id ? { id: { not: id } } : {}) } });
      if (d.active && activeCount >= company.maxUsers)
        throw new AppError(`O plano da agência permite até ${company.maxUsers} usuários ativos. Fale com o suporte Frédy para ampliar.`);
      if (id) {
        const u = await tx.user.findFirst({ where: { id, companyId: ctx.companyId } });
        if (!u) throw new AppError("Usuário não encontrado.", "NOT_FOUND");
        if (id === ctx.userId && (d.role !== "ADMIN" || !d.active)) throw new AppError("Você não pode remover seu próprio acesso de administrador.");
        await tx.user.update({
          where: { id },
          data: { name: d.name, email: d.email, role: d.role, active: d.active, commissionRateBps: d.commissionRateBps, ...(d.password ? { passwordHash: await bcrypt.hash(d.password, 10) } : {}) },
        });
        await audit(tx, ctx, "usuario.alterado", "User", id, { role: d.role, active: d.active });
        return id;
      }
      if (!d.password) throw new AppError("Defina uma senha inicial.");
      const u = await tx.user.create({
        data: { companyId: ctx.companyId, name: d.name, email: d.email, role: d.role, active: d.active, commissionRateBps: d.commissionRateBps, passwordHash: await bcrypt.hash(d.password, 10) },
      });
      await audit(tx, ctx, "usuario.criado", "User", u.id, { role: d.role });
      return u.id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("E-mail já utilizado.");
    throw e;
  }
}

/** Gera uma nova chave de API para consulta de eventos. A chave só é exibida uma vez. */
export async function rotateApiKey(ctx: Ctx) {
  assertCan(ctx, "settings.manage");
  const key = `fg_${randomBytes(24).toString("hex")}`;
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { apiKeyHash: createHash("sha256").update(key).digest("hex") } });
    await audit(tx, ctx, "api.chave_gerada", "Company", ctx.companyId);
  });
  return key;
}

export async function companyFromApiKey(key: string | null) {
  if (!key) return null;
  return prisma.company.findFirst({ where: { apiKeyHash: createHash("sha256").update(key).digest("hex") } });
}

export async function listAudit(ctx: Ctx, page = 1) {
  assertCan(ctx, "settings.manage");
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where: { companyId: ctx.companyId }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.auditLog.count({ where: { companyId: ctx.companyId } }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / 30)) };
}

export async function sellerOptions(ctx: Ctx) {
  return prisma.user.findMany({
    where: { companyId: ctx.companyId, active: true, role: { in: ["VENDEDOR", "GESTOR", "ADMIN"] } },
    select: { id: true, name: true, commissionRateBps: true },
    orderBy: { name: "asc" },
  });
}
