import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { today } from "@/server/context";
import { addDays } from "@/lib/dates";
import { companyFromApiKey } from "@/server/services/settings";

/**
 * Voos dos clientes para automações externas (ex.: fluxo do n8n que confere o status no AeroDataBox).
 * Só leitura. Só vendas confirmadas ou concluídas.
 *
 * GET /api/v1/voos?dias=2     Authorization: Bearer <chave da agência>
 *   dias = quantos dias a partir de hoje (1 = só hoje, 2 = hoje e amanhã; máximo 7)
 *
 * A chave é gerada em Configurações → Integrações e armazenada apenas como hash.
 */
export async function GET(req: Request) {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const company = await companyFromApiKey(key || null);
  if (!company) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const dias = Math.min(7, Math.max(1, Math.floor(Number(new URL(req.url).searchParams.get("dias") ?? 2)) || 2));
  const t = today(company);
  const flights = await prisma.flightSegment.findMany({
    where: { companyId: company.id, departureAt: { gte: t, lt: addDays(t, dias) }, sale: { status: { in: ["CONFIRMADA", "CONCLUIDA"] } } },
    include: { sale: { select: { code: true, passengerCount: true, client: { select: { name: true, whatsapp: true, phone: true } }, seller: { select: { name: true } } } } },
    orderBy: { departureAt: "asc" },
    take: 500,
  });
  return NextResponse.json({
    hoje: t,
    data: flights.map((f) => ({
      id: f.id,
      voo: `${f.airline}${f.flightNumber}`,
      companhia: f.airline,
      numero: f.flightNumber,
      origem: f.origin,
      destino: f.destination,
      partida: f.departureAt, // horário local da origem, AAAA-MM-DDTHH:mm
      chegada: f.arrivalAt,
      venda: f.sale.code,
      passageiros: f.sale.passengerCount,
      cliente: f.sale.client.name,
      whatsappCliente: f.sale.client.whatsapp ?? f.sale.client.phone,
      vendedor: f.sale.seller?.name ?? null,
    })),
  });
}
