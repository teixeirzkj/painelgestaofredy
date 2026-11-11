import { NextResponse, after } from "next/server";
import { handleMondeWebhook, mondeWebhookTarget, verifyMondeSignature } from "@/server/services/monde";

/**
 * Recebe os avisos do Monde (webhook cadastrado pela gestão na credencial da agência).
 * A chave na URL identifica a agência e a assinatura X-Monde-Signature prova que veio do Monde.
 * Responde na hora (o Monde exige resposta em até 10 s) e processa depois. O processamento é idempotente:
 * aviso repetido não duplica venda, voo, anexo nem baixa.
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const target = await mondeWebhookTarget(key);
  // 410 faz o Monde parar de tentar (webhook desligado ou chave antiga)
  if (!target) return NextResponse.json({ error: "Aviso desativado." }, { status: 410 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "Aviso grande demais." }, { status: 413 });
  if (!verifyMondeSignature(target.secret, req.headers.get("x-monde-timestamp"), req.headers.get("x-monde-signature"), raw))
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Aviso inválido." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Aviso inválido." }, { status: 400 });
  after(() => handleMondeWebhook(target.companyId, body as Parameters<typeof handleMondeWebhook>[1]).catch(() => null));
  return NextResponse.json({ ok: true });
}

export const maxDuration = 60;
