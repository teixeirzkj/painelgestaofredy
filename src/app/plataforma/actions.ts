"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toResult } from "@/server/errors";
import { headers } from "next/headers";
import * as platform from "@/server/platform";
import { clientIp, loginBlocked } from "@/server/services/login-guard";
import { logAccess } from "@/server/services/admin";

export async function platformLoginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(form.get("password") ?? "").slice(0, 200);
  const hdr = await headers();
  const ip = clientIp(hdr);
  const tag = "plataforma:" + email; // tentativas da plataforma contadas à parte
  if (!email || !password) return { error: "E-mail ou senha inválidos." };
  if (await loginBlocked(tag, ip)) return { error: "Muitas tentativas erradas. Aguarde 15 minutos e tente de novo." };
  const u = await platform.platformLogin(email, password);
  if (!u) {
    await logAccess({ email: tag, type: "FALHA", ip, userAgent: hdr.get("user-agent") });
    return { error: "E-mail ou senha inválidos." };
  }
  await logAccess({ email: tag, type: "LOGIN", ip, userAgent: hdr.get("user-agent") });
  await platform.createPlatformSession(u.id);
  redirect("/plataforma");
}

export async function platformLogoutAction() {
  await platform.destroyPlatformSession();
  redirect("/plataforma/login");
}

function act<T>(fn: (p: platform.PlatformCtx) => Promise<T>, message?: string) {
  return toResult(async () => {
    const p = await platform.requirePlatformAction();
    const r = await fn(p);
    revalidatePath("/plataforma", "layout");
    return r;
  }, message);
}

export const createCompanyAccountAction = async (input: unknown) => act((p) => platform.createCompanyAccount(p, input), "Agência criada. Envie o login e a senha ao cliente.");
export const setCompanyActiveAction = async (id: string, active: boolean, reason?: string) => act((p) => platform.setCompanyActive(p, id, active, reason), active ? "Agência reativada." : "Agência suspensa.");
export const updateCompanyPlanAction = async (id: string, input: unknown) => act((p) => platform.updateCompanyPlan(p, id, input), "Plano atualizado.");
export const resetUserPasswordAction = async (companyId: string, userId: string, password: string) => act((p) => platform.resetUserPassword(p, companyId, userId, password), "Senha redefinida.");
export const addCompanyAdminAction = async (companyId: string, input: unknown) => act((p) => platform.addCompanyAdmin(p, companyId, input), "Administrador adicionado.");
