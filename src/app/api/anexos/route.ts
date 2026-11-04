import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { AppError } from "@/server/errors";
import { ALLOWED_MIME, MAX_ATTACHMENT_BYTES, assertAttachmentTarget, registerAttachment, type AttachmentTarget } from "@/server/services/finance";
import { saveFile } from "@/server/storage";

// Assinaturas mínimas (magic bytes) para não confiar apenas no Content-Type enviado pelo navegador.
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString() === "%PDF") return "application/pdf";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

const TARGETS = ["receivable", "payable", "sale", "trip", "invoice"] as const;

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    const kind = String(form.get("kind") ?? "");
    const id = String(form.get("id") ?? "");
    const docKind = form.get("docKind") ? String(form.get("docKind")) : undefined;
    if (!(file instanceof File) || !TARGETS.includes(kind as never) || !id) throw new AppError("Requisição inválida.");
    const target = { kind, id } as AttachmentTarget;
    // valida permissão e destino ANTES de gravar o arquivo
    await assertAttachmentTarget(ctx, target, true);
    if (file.size > MAX_ATTACHMENT_BYTES) throw new AppError("Arquivo maior que 5 MB.");
    const buf = Buffer.from(await file.arrayBuffer());
    const mime = sniff(buf);
    if (!mime || !ALLOWED_MIME.includes(mime)) throw new AppError("Formato não permitido. Envie PDF, PNG, JPG ou WEBP.");
    const key = await saveFile(ctx.companyId, buf, mime.split("/")[1]);
    const attachmentId = await registerAttachment(ctx, target, { fileName: file.name, mimeType: mime, sizeBytes: file.size, storageKey: key, kind: docKind });
    return NextResponse.json({ id: attachmentId });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    console.error(e);
    return NextResponse.json({ error: "Falha ao enviar arquivo." }, { status: 500 });
  }
}
