import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { can } from "@/server/context";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { getExcursion } from "@/server/services/excursions";
import { formatDate } from "@/lib/dates";
import { maskDocument, toCSV } from "@/lib/utils";

/**
 * Lista de passageiros / rooming list da excursão em CSV.
 * Documento completo só para quem gerencia a operação (sales.edit_all); demais perfis recebem mascarado.
 * Cada exportação fica registrada na auditoria (LGPD).
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  try {
    const { id } = await params;
    const e = await getExcursion(ctx, id);
    const full = can(ctx, "sales.edit_all");
    const rows = e.passengers
      .filter((p) => !p.placeholder)
      .map((p, i) => [i + 1, p.name, full ? p.document ?? "" : maskDocument(p.document), p.birthDate ? formatDate(p.birthDate) : "", p.room ?? "", p.seat ?? "", p.saleCode, p.clientName, p.contact ?? ""]);
    await prisma.$transaction((tx) => audit(tx, ctx, "excursao.lista_exportada", "Excursion", id, { passengers: rows.length, fullDocuments: full }));
    const csv = toCSV(["#", "Passageiro", "Documento", "Nascimento", "Quarto", "Poltrona", "Reserva", "Cliente", "Contato"], rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="passageiros-${e.code}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Excursão não encontrada." }, { status: 404 });
  }
}
