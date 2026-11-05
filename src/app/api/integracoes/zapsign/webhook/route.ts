import { NextResponse } from "next/server";
import { checkWebhookSecret, refuseZapSignDocument, syncZapSignDocument } from "@/server/services/zapsign";

/**
 * Webhook da ZapSign (registrado automaticamente no primeiro envio, com cabeçalho secreto).
 * Assinatura: o documento é consultado na API da ZapSign antes de marcar o contrato como assinado.
 */
export async function POST(req: Request) {
  if (!checkWebhookSecret(req.headers.get("x-fredy-webhook-secret"))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { event_type?: string; token?: string } | null;
  const token = typeof body?.token === "string" ? body.token : null;
  if (!body || !token) return NextResponse.json({ ok: true, ignored: true });
  try {
    if (body.event_type === "doc_signed") await syncZapSignDocument(token);
    else if (body.event_type === "doc_refused") await refuseZapSignDocument(token);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("zapsign webhook", e);
    return NextResponse.json({ error: "Falha ao processar." }, { status: 500 }); // a ZapSign tenta de novo
  }
}

export const maxDuration = 60;
