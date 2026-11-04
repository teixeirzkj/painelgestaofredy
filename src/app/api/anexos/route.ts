import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { AppError } from "@/server/errors";
import { ALLOWED_MIME, MAX_ATTACHMENT_BYTES, registerAttachment } from "@/server/services/finance";
import { saveFile } from "@/server/storage";
import { can } from "@/server/context";

// Assinaturas mínimas (magic bytes) para não confiar apenas no Content-Type enviado pelo navegador.
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString() === "%PDF") return "application/pdf";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!can(ctx, "finance.manage")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    const id = String(form.get("id") ?? "");
    if (!(file instanceof File) || (kind !== "receivable" && kind !== "payable") || !id) throw new AppError("Requisição inválida.");
    if (file.size > MAX_ATTACHMENT_BYTES) throw new AppError("Arquivo maior que 5 MB.");
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = sniff(buf);
    if (!mime || !ALLOWED_MIME.includes(mime)) throw new AppError("Formato não permitido. Envie PDF, PNG, JPG ou WEBP.");
    const key = await saveFile(ctx.companyId, buf, mime.split("/")[1]);
    const attachmentId = await registerAttachment(ctx, { kind, id }, { fileName: file.name, mimeType: mime, sizeBytes: file.size, storageKey: key });
    return NextResponse.json({ id: attachmentId });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Falha ao enviar arquivo." }, { status: 500 });
  }
}
