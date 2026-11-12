import { prisma } from "./db";
import { AppError } from "./errors";
import { resolvePermissions, type Permission } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import { todayIn } from "@/lib/dates";
import { enabledModules } from "@/lib/modules";

/** Contexto de execução: toda operação de negócio é feita em nome de um usuário dentro de uma empresa. */
export type Ctx = {
  userId: string;
  userName: string;
  companyId: string;
  companyName: string;
  isDemo: boolean;
  logoKey: string | null;
  role: Role;
  timezone: string;
  permissions: Set<Permission>;
  /** módulos do painel ligados para a agência (a plataforma liga e desliga) */
  modules: Set<string>;
  /** entrou pelo login de longa duração da venda rápida (vale só no popup) */
  viaEmbed?: boolean;
};

export async function loadContext(userId: string, sessionVersion?: number): Promise<Ctx | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: { include: { rolePermissions: true } } },
  });
  if (!user || !user.active || !user.company.active) return null;
  // sessão de antes de uma troca de senha/papel não vale mais
  if (sessionVersion !== undefined && sessionVersion !== user.sessionVersion) return null;
  const role = user.role as Role;
  return {
    userId: user.id,
    userName: user.name,
    companyId: user.companyId,
    companyName: user.company.name,
    isDemo: user.company.isDemo,
    logoKey: user.company.logoKey,
    role,
    timezone: user.company.timezone,
    modules: enabledModules(user.company.modulesJson),
    permissions: resolvePermissions(
      role,
      user.company.rolePermissions.filter((p) => p.role === role),
    ),
  };
}

export function can(ctx: Ctx, p: Permission): boolean {
  return ctx.permissions.has(p);
}

export function assertCan(ctx: Ctx, p: Permission): void {
  if (!ctx.permissions.has(p)) throw new AppError("Você não tem permissão para esta operação.", "FORBIDDEN");
}

/** O módulo está ligado para a agência? */
export function hasModule(ctx: Pick<Ctx, "modules">, key: string): boolean {
  return ctx.modules.has(key);
}

export function assertModule(ctx: Pick<Ctx, "modules">, key: string): void {
  if (!ctx.modules.has(key)) throw new AppError("Este recurso não está disponível para a sua agência.", "FORBIDDEN");
}

export function today(ctx: Pick<Ctx, "timezone">): string {
  return todayIn(ctx.timezone);
}
