import { NextResponse } from "next/server";
import { safeEqual } from "@/server/secrets";
import { runFlightMonitor } from "@/server/services/flight-monitor";

/**
 * Monitor de voos: confere no AeroDataBox os voos de hoje e amanhã das agências com o módulo ligado.
 * Vercel Cron chama todo dia às 9h UTC (6h em Brasília) com "Authorization: Bearer $CRON_SECRET".
 * No máximo 1 consulta por voo por dia: rodar de novo no mesmo dia não gasta consultas repetidas.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ ok: true, results: await runFlightMonitor() });
}

export const GET = run;
export const POST = run;
export const maxDuration = 60;
