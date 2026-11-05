"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toResult } from "@/server/errors";
import * as platform from "@/server/platform";

const attempts = new Map<string, { n: number; until: number }>();

export async function platformLoginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const a = attempts.get(email);
  if (a && a.until > Date.now()) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  const u = await platform.platformLogin(email, password);
  if (!u) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(email, { n, until: n >= 5 ? Date.now() + 10 * 60_000 : 0 });
    return { error: "E-mail ou senha inválidos." };
  }
  attempts.delete(email);
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
