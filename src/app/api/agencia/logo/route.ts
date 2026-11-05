import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { can } from "@/server/context";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { readStoredFile, saveFile } from "@/server/storage";

const MAX = 1024 * 1024;

function sniff(buf: Buffer): string | null {
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

/** Logo da agência do usuário logado (somente a própria agência). */
export async function GET() {
  const ctx = await getContext();
  if (!ctx || !ctx.logoKey) return new NextResponse(null, { status: 404 });
  try {
    const data = await readStoredFile(ctx.logoKey);
    const mime = sniff(data) ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

/** Envio/remoção da logo (administradores). PNG, JPG ou WEBP até 1 MB. */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!can(ctx, "settings.manage")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const form = await req.formData();
  if (form.get("remove") === "1") {
    await prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: ctx.companyId }, data: { logoKey: null } });
      await audit(tx, ctx, "agencia.logo_removida", "Company", ctx.companyId);
    });
    return NextResponse.json({ ok: true });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Envie uma imagem." }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: "A imagem deve ter até 1 MB." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniff(buf);
  if (!mime) return NextResponse.json({ error: "Formato não permitido. Use PNG, JPG ou WEBP." }, { status: 400 });
  const key = await saveFile(ctx.companyId, buf, mime.split("/")[1]);
  await prisma.$transaction(async (tx) => {
    await tx.company.update({ where: { id: ctx.companyId }, data: { logoKey: key } });
    await audit(tx, ctx, "agencia.logo_alterada", "Company", ctx.companyId);
  });
  return NextResponse.json({ ok: true });
}
