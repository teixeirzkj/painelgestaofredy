import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db";
import { runScheduledAutomations } from "@/server/services/automations";

/**
 * Executa as automações baseadas em datas para todas as empresas.
 * Agende (ex.: a cada hora) chamando:  POST /api/cron/automacoes  com  Authorization: Bearer $CRON_SECRET
 * É idempotente: execuções repetidas não duplicam eventos.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const companies = await prisma.company.findMany({ select: { id: true } });
  const results: Record<string, unknown> = {};
  for (const c of companies) {
    try {
      results[c.id] = await runScheduledAutomations(c.id);
    } catch (e) {
      results[c.id] = { error: String((e as Error).message) };
    }
  }
  return NextResponse.json({ ok: true, results });
}
