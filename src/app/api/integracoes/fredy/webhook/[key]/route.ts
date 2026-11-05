import { NextResponse } from "next/server";
import { handleFredyWebhook } from "@/server/services/fredy";

/**
 * Recebe os eventos do CRM Frédy (assinatura criada automaticamente em Configurações → Integrações).
 * A chave secreta na URL identifica a agência; cada agência tem a sua.
 * O processamento é idempotente: o mesmo card ganho nunca gera duas vendas.
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!key || key.length < 20) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  try {
    const ok = await handleFredyWebhook(key, body);
    if (!ok) return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Falha ao processar o evento." }, { status: 500 });
  }
}

export const maxDuration = 60;
