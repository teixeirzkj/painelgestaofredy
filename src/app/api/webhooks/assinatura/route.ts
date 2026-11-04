import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { applySignatureCallback } from "@/server/services/contracts";
import { AppError } from "@/server/errors";

/**
 * Ponto de entrada para o provedor de assinatura eletrônica (PENDENTE de contratação).
 *
 * Contrato provisório: POST JSON assinado com HMAC-SHA256 do corpo, no cabeçalho
 * X-Signature, usando SIGNATURE_WEBHOOK_SECRET. Ao integrar um provedor real (ex.: Clicksign,
 * D4Sign, DocuSign), crie um adaptador que traduza o payload dele para este formato.
 * Sem segredo configurado, o endpoint fica desativado — o sistema nunca marca um contrato
 * como assinado sem confirmação externa verificável.
 */
const schema = z.object({
  companyId: z.string().min(1),
  contractId: z.string().min(1),
  externalId: z.string().min(1).max(120),
  provider: z.string().min(1).max(60),
  event: z.enum(["sent", "signed", "cancelled"]),
});

export async function POST(req: Request) {
  const secret = process.env.SIGNATURE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Integração de assinatura não configurada." }, { status: 503 });
  const body = await req.text();
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const given = req.headers.get("x-signature") ?? "";
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }
  try {
    await applySignatureCallback(schema.parse(JSON.parse(body)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
}
