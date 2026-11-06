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
/**
 * Login da venda rápida embutida no WTS: dentro de outro site o navegador descarta o cookie normal (SameSite=Lax),
 * então o popup usa um cookie próprio, particionado (só vale dentro do WTS) e longo, para o atendente entrar uma vez só.
 */
const EMBED_COOKIE = "fg_embed";
const EMBED_MAX_AGE = 60 * 60 * 24 * 180; // 180 dias
const embedOpts = { httpOnly: true, sameSite: "none" as const, secure: true, partitioned: true, path: "/" };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET ausente ou muito curto (mínimo 32 caracteres).");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: string, opts: { embedded?: boolean } = {}) {
  if (opts.embedded) {
    const embed = await new SignJWT({ sub: userId, emb: true }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${EMBED_MAX_AGE}s`).sign(secret());
    (await cookies()).set(EMBED_COOKIE, embed, { ...embedOpts, maxAge: EMBED_MAX_AGE });
  }
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
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.set(EMBED_COOKIE, "", { ...embedOpts, maxAge: 0 });
}

/** Contexto do usuário logado (cacheado por requisição). O usuário é recarregado do banco a cada request. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  // login normal primeiro; se não houver (ou tiver vencido), o login de longa duração do popup
  for (const name of [COOKIE, EMBED_COOKIE]) {
    const token = jar.get(name)?.value;
    if (!token) continue;
    try {
      const { payload } = await jwtVerify(token, secret());
      if (!payload.sub) continue;
      const ctx = await loadContext(payload.sub);
      if (ctx) return name === EMBED_COOKIE ? { ...ctx, viaEmbed: true } : ctx;
    } catch {
      // token vencido ou inválido: tenta o próximo
    }
  }
  return null;
});

/** Para páginas: redireciona ao login se não autenticado. */
export async function requirePageContext(permission?: Permission): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.role === "ATENDENTE") redirect("/balcao"); // atendente não entra na gestão
  if (ctx.viaEmbed) redirect("/login"); // o login longo do popup não abre a gestão
  if (permission && !ctx.permissions.has(permission)) redirect("/?negado=1");
  return ctx;
}

/** Para server actions e rotas: lança erro se não autenticado. */
export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) throw new AppError("Sessão expirada. Faça login novamente.", "UNAUTHENTICATED");
  return ctx;
}
