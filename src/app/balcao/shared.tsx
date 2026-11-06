import "server-only";
import { redirect } from "next/navigation";
import { getContext } from "@/server/auth";
import type { Ctx } from "@/server/context";

/** Contexto da tela do vendedor: sem login, vai para o login e volta para a mesma tela. */
export async function balcaoContext(path: string): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (!ctx.permissions.has("sales.create")) redirect("/?negado=1");
  return ctx;
}

/** Repassa o card do Frédy entre as etapas. */
export function carry(card?: string | null, extra: Record<string, string | null | undefined> = {}) {
  const p = new URLSearchParams();
  if (card) p.set("card", card);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
