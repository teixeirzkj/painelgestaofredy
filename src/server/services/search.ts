/** Busca global do cabeçalho: respeita o mesmo escopo de visibilidade de cada módulo. */
import { prisma } from "../db";
import { can, type Ctx } from "../context";
import { textContains } from "./query";
import { saleScope } from "./sales";
import { clientScope } from "./registry";
import { tripScope } from "./trips";
import { onlyDigits } from "@/lib/utils";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export type SearchHit = { type: "venda" | "cliente" | "viagem" | "fornecedor" | "excursao" | "fatura"; id: string; title: string; subtitle: string; href: string };

export async function globalSearch(ctx: Ctx, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const digits = onlyDigits(q);
  const [sales, clients, trips, suppliers, excursions, invoices] = await Promise.all([
    prisma.sale.findMany({
      where: {
        ...saleScope(ctx),
        OR: [
          { code: textContains(q) },
          { locator: textContains(q) },
          { destination: textContains(q) },
          { client: { name: textContains(q) } },
          { passengers: { some: { name: textContains(q) } } },
          { items: { some: { locator: textContains(q) } } },
        ],
      },
      select: { id: true, code: true, destination: true, saleDate: true, grossCents: true, client: { select: { name: true } } },
      orderBy: { saleDate: "desc" },
      take: 6,
    }),
    prisma.client.findMany({
      where: {
        AND: [
          clientScope(ctx),
          { OR: [{ name: textContains(q) }, { email: textContains(q) }, ...(digits.length >= 3 ? [{ document: { contains: digits } }, { whatsapp: { contains: digits } }] : [])] },
        ],
      },
      select: { id: true, name: true, email: true, whatsapp: true },
      take: 5,
    }),
    prisma.trip.findMany({
      where: { ...tripScope(ctx), OR: [{ code: textContains(q) }, { title: textContains(q) }, { destination: textContains(q) }] },
      select: { id: true, code: true, title: true, client: { select: { name: true } } },
      take: 4,
    }),
    can(ctx, "suppliers.view")
      ? prisma.supplier.findMany({ where: { companyId: ctx.companyId, name: textContains(q) }, select: { id: true, name: true, category: true }, take: 4 })
      : Promise.resolve([]),
    can(ctx, "sales.create")
      ? prisma.excursion.findMany({ where: { companyId: ctx.companyId, OR: [{ code: textContains(q) }, { name: textContains(q) }, { destination: textContains(q) }] }, select: { id: true, code: true, name: true, startDate: true }, take: 3 })
      : Promise.resolve([]),
    can(ctx, "finance.view")
      ? prisma.supplierInvoice.findMany({ where: { companyId: ctx.companyId, number: textContains(q) }, select: { id: true, number: true, supplier: { select: { name: true } } }, take: 3 })
      : Promise.resolve([]),
  ]);
  return [
    ...sales.map((s) => ({ type: "venda" as const, id: s.id, title: `${s.code} · ${s.client.name}`, subtitle: `${s.destination ?? "Sem destino"} · ${formatDate(s.saleDate)} · ${formatBRL(s.grossCents)}`, href: `/vendas/${s.id}` })),
    ...clients.map((c) => ({ type: "cliente" as const, id: c.id, title: c.name, subtitle: c.email ?? c.whatsapp ?? "Cliente", href: `/clientes/${c.id}` })),
    ...trips.map((t) => ({ type: "viagem" as const, id: t.id, title: `${t.code} · ${t.title}`, subtitle: t.client.name, href: `/viagens/${t.id}` })),
    ...excursions.map((e) => ({ type: "excursao" as const, id: e.id, title: `${e.code} · ${e.name}`, subtitle: `Saída ${formatDate(e.startDate)}`, href: `/excursoes/${e.id}` })),
    ...suppliers.map((s) => ({ type: "fornecedor" as const, id: s.id, title: s.name, subtitle: "Fornecedor", href: `/fornecedores/${s.id}` })),
    ...invoices.map((i) => ({ type: "fatura" as const, id: i.id, title: `Fatura ${i.number}`, subtitle: i.supplier.name, href: `/financeiro/faturas/${i.id}` })),
  ];
}
