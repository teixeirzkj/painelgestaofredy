import { NextResponse } from "next/server";
import { safeEqual } from "@/server/secrets";
import { prisma } from "@/server/db";
import { runScheduledAutomations } from "@/server/services/automations";

/**
 * Executa as automações baseadas em datas (lembretes de vencimento, pré-viagem, pós-venda) para todas as agências ativas.
 * - Vercel Cron chama GET com "Authorization: Bearer $CRON_SECRET" automaticamente (ver vercel.json).
 * - Outros agendadores podem usar POST com o mesmo cabeçalho.
 * É idempotente: execuções repetidas não duplicam eventos.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(given, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });
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

export const GET = run;
export const POST = run;
export const maxDuration = 60;
