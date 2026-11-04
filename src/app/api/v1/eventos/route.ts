import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { companyFromApiKey } from "@/server/services/settings";

/**
 * API de eventos para integrações (ex.: CRM Frédy) consumirem por "pull".
 *
 * GET  /api/v1/eventos?status=PENDENTE&limit=50     Authorization: Bearer <chave da agência>
 * POST /api/v1/eventos  { "ack": ["<id>", ...] }    marca como ENTREGUE (idempotente)
 *
 * A chave é gerada em Configurações → Integrações e armazenada apenas como hash.
 */
async function auth(req: Request) {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return companyFromApiKey(key || null);
}

export async function GET(req: Request) {
  const company = await auth(req);
  if (!company) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "PENDENTE";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));
  const events = await prisma.automationEvent.findMany({
    where: { companyId: company.id, ...(status === "TODOS" ? {} : { status }) },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return NextResponse.json({
    data: events.map((e) => ({ id: e.id, type: e.type, status: e.status, createdAt: e.createdAt, idempotencyKey: e.idempotencyKey, payload: JSON.parse(e.payloadJson) })),
  });
}

export async function POST(req: Request) {
  const company = await auth(req);
  if (!company) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = z.object({ ack: z.array(z.string()).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  const r = await prisma.automationEvent.updateMany({
    where: { companyId: company.id, id: { in: parsed.data.ack }, status: { not: "ENTREGUE" } },
    data: { status: "ENTREGUE", deliveredAt: new Date() },
  });
  return NextResponse.json({ acknowledged: r.count });
}
