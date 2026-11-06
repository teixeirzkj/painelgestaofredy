import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { AppError } from "@/server/errors";
import { contractPdf } from "@/server/services/contract-pdf";

const STATUS = { NOT_FOUND: 404, CONFLICT: 409, FORBIDDEN: 403 } as Record<string, number>;

/** Baixar o PDF do contrato emitido (para mandar ao cliente). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  try {
    const { id } = await params;
    const { bytes, fileName } = await contractPdf(ctx, id);
    const ascii = fileName.normalize("NFD").replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "");
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: STATUS[e.code] ?? 400 });
    throw e;
  }
}
