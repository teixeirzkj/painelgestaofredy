import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { loadContext, type Ctx } from "./context";
import { AppError } from "./errors";
import type { Permission } from "@/lib/permissions";

const COOKIE = "fg_session";
const MAX_AGE = 60 * 60 * 12; // 12 horas

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET ausente ou muito curto (mínimo 32 caracteres).");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** Contexto do usuário logado (cacheado por requisição). O usuário é recarregado do banco a cada request. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return await loadContext(payload.sub);
  } catch {
    return null;
  }
});

/** Para páginas: redireciona ao login se não autenticado. */
export async function requirePageContext(permission?: Permission): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (permission && !ctx.permissions.has(permission)) redirect("/?negado=1");
  return ctx;
}

/** Para server actions e rotas: lança erro se não autenticado. */
export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) throw new AppError("Sessão expirada. Faça login novamente.", "UNAUTHENTICATED");
  return ctx;
}
