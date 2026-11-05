import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { can } from "@/server/context";
import { extractSaleFromFile, AI_EXTRACT_MAX_BYTES } from "@/server/services/ai-extract";
import { AppError } from "@/server/errors";

/** Tipo real do arquivo pelos primeiros bytes (não confia no tipo enviado pelo navegador). */
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString() === "%PDF") return "application/pdf";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 3).toString() === "GIF") return "image/gif";
  return null;
}

// Limite simples por usuário (cada leitura tem custo de IA).
const uses = new Map<string, number[]>();
function allowed(userId: string) {
  const now = Date.now();
  const recent = (uses.get(userId) ?? []).filter((t) => now - t < 60 * 60_000);
  if (recent.length >= 40) return false;
  recent.push(now);
  uses.set(userId, recent);
  return true;
}

/** Lê o print/PDF da reserva com IA e devolve os dados para pré-preencher a venda. Nada é gravado. */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (!can(ctx, "sales.create")) return NextResponse.json({ error: "Sem permissão para registrar vendas." }, { status: 403 });
  if (!allowed(ctx.userId)) return NextResponse.json({ error: "Limite de leituras por hora atingido. Tente mais tarde." }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("arquivo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Envie o arquivo da reserva." }, { status: 400 });
  if (file.size > AI_EXTRACT_MAX_BYTES) return NextResponse.json({ error: "Arquivo acima de 8 MB." }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniff(bytes);
  if (!mimeType) return NextResponse.json({ error: "Envie uma imagem (PNG, JPG, WEBP) ou um PDF." }, { status: 415 });
  try {
    const data = await extractSaleFromFile(ctx, { bytes, mimeType, name: file.name });
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("extrair venda", e);
    return NextResponse.json({ error: "Não foi possível ler o arquivo agora." }, { status: 500 });
  }
}

export const maxDuration = 60;
