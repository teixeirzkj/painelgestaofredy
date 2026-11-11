import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { getAttachment } from "@/server/services/finance";
import { readStoredFile } from "@/server/storage";

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  try {
    const { id } = await params;
    const a = await getAttachment(ctx, id); // valida empresa e permissão
    const data = await readStoredFile(a.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": a.mimeType,
        // PDF e imagens abrem no navegador; os demais (Word, Excel, texto trazidos do Monde) são baixados
        "Content-Disposition": `${INLINE.has(a.mimeType) ? "inline" : "attachment"}; filename="${encodeURIComponent(a.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  }
}
