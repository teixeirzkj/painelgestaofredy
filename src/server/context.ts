import { prisma } from "./db";
import { AppError } from "./errors";
import { resolvePermissions, type Permission } from "@/lib/permissions";
import type { Role } from "@/lib/constants";
import { todayIn } from "@/lib/dates";

/** Contexto de execução: toda operação de negócio é feita em nome de um usuário dentro de uma empresa. */
export type Ctx = {
  userId: string;
  userName: string;
  companyId: string;
  companyName: string;
  isDemo: boolean;
  role: Role;
  timezone: string;
  permissions: Set<Permission>;
};

export async function loadContext(userId: string): Promise<Ctx | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: { include: { rolePermissions: true } } },
  });
  if (!user || !user.active) return null;
  const role = user.role as Role;
  return {
    userId: user.id,
    userName: user.name,
    companyId: user.companyId,
    companyName: user.company.name,
    isDemo: user.company.isDemo,
    role,
    timezone: user.company.timezone,
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

export function today(ctx: Pick<Ctx, "timezone">): string {
  return todayIn(ctx.timezone);
}
