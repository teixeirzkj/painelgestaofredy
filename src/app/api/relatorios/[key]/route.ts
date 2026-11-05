import { pagePeriod } from "@/server/month";
import { NextResponse } from "next/server";
import { getContext } from "@/server/auth";
import { today } from "@/server/context";
import { AppError } from "@/server/errors";
import { runReport } from "@/server/services/reports";
import { resolvePeriod, formatDate } from "@/lib/dates";
import { toCSV } from "@/lib/utils";

/** Exportação CSV (separador ";", vírgula decimal, compatível com Excel pt-BR). */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const { key } = await params;
  const url = new URL(req.url);
  const p = await pagePeriod(ctx.timezone, url.searchParams.get("periodo") ?? undefined, url.searchParams.get("de") ?? undefined, url.searchParams.get("ate") ?? undefined);
  try {
    const r = await runReport(ctx, key, p, { compare: url.searchParams.get("comparar") === "1" });
    const fmt = (v: unknown, type: string) => {
      if (v === null || v === undefined || v === "") return "";
      if (type === "money") return (Number(v) / 100).toFixed(2).replace(".", ",");
      if (type === "percent") return (Number(v) / 100).toFixed(2).replace(".", ",");
      if (type === "date") return formatDate(String(v));
      return v;
    };
    const headers = r.columns.map((c) => (c.type === "percent" ? `${c.label} (%)` : c.type === "money" ? `${c.label} (R$)` : c.label));
    const rows = r.rows.map((row) => r.columns.map((c) => fmt(row[c.key], c.type)));
    if (r.totals) rows.push(r.columns.map((c, i) => (i === 0 ? "TOTAL" : c.key in r.totals! ? fmt(r.totals![c.key], c.type) : "")));
    const csv = toCSV(headers, rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${key}_${p.from}_${p.to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : 400 });
    throw e;
  }
}
