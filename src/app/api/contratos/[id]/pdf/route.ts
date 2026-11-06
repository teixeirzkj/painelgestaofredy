import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { getContext } from "@/server/auth";
import { can } from "@/server/context";
import { prisma } from "@/server/db";
import { saleScope } from "@/server/services/sales";

const ISSUED = ["AGUARDANDO_ENVIO", "ENVIADO", "ASSINADO"];

/** As fontes padrão do PDF só têm o alfabeto latino: troca o que não couber. */
function latin(text: string) {
  return text
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2022\u25CF\u25AA]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\t/g, "    ")
    .replace(/[^\n\x20-\x7E\u00A1-\u00FF]/g, "?");
}

function wrap(line: string, font: PDFFont, size: number, max: number) {
  if (!line.trim()) return [""];
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(/(\s+)/)) {
    const next = cur + word;
    if (font.widthOfTextAtSize(next, size) <= max) {
      cur = next;
      continue;
    }
    if (cur.trim()) out.push(cur.trimEnd());
    cur = word.trimStart();
    // palavra maior que a linha: quebra no meio
    while (font.widthOfTextAtSize(cur, size) > max) {
      let i = cur.length - 1;
      while (i > 1 && font.widthOfTextAtSize(cur.slice(0, i), size) > max) i--;
      out.push(cur.slice(0, i));
      cur = cur.slice(i);
    }
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}

/** PDF do contrato emitido, para o atendente baixar e mandar ao cliente. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!can(ctx, "contracts.manage")) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { id } = await params;
  const c = await prisma.contract.findFirst({
    where: { id, companyId: ctx.companyId, sale: saleScope(ctx) },
    select: { content: true, status: true, sale: { select: { code: true, client: { select: { name: true } } } } },
  });
  if (!c || !c.content) return NextResponse.json({ error: "Contrato não encontrado." }, { status: 404 });
  if (!ISSUED.includes(c.status)) return NextResponse.json({ error: "Emita o contrato antes de baixar." }, { status: 409 });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Contrato ${c.sale.code}`);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const W = 595.28, H = 841.89, M = 56, size = 11, lead = 15.5;
  const lines = latin(c.content).split("\n");
  let page = pdf.addPage([W, H]);
  let y = H - M;
  lines.forEach((raw, idx) => {
    const f = idx === 0 ? bold : font; // primeira linha: título
    for (const l of wrap(raw, f, size, W - 2 * M)) {
      if (y < M + lead) {
        page = pdf.addPage([W, H]);
        y = H - M;
      }
      if (l) page.drawText(l, { x: M, y, size, font: f, color: rgb(0.1, 0.12, 0.16) });
      y -= lead;
    }
  });
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const t = latin(`${c.sale.code} - página ${i + 1} de ${pages.length}`);
    p.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 8), y: M / 2, size: 8, font, color: rgb(0.45, 0.48, 0.55) });
  });
  const bytes = await pdf.save();
  const name = `Contrato ${c.sale.code} - ${c.sale.client.name}.pdf`;
  const ascii = name.normalize("NFD").replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
