/**
 * Ficha dos passageiros (popup da venda rápida): todos os passageiros de uma venda com os dados completos
 * para lançar no sistema da companhia/operadora, sem abrir cadastro por cadastro.
 * Mostra documentos completos (é para emitir), então exige "cadastrar clientes" e registra quem abriu.
 */
import { prisma } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { onlyDigits } from "@/lib/utils";
import { saleScope } from "./sales";

/** Vendas para abrir a ficha: pelo nome do cliente ou de um passageiro, CPF ou código da venda. */
export async function searchSalesForSheet(ctx: Ctx, q: string) {
  assertCan(ctx, "clients.manage");
  const term = (q ?? "").trim();
  const digits = onlyDigits(term);
  const where = term
    ? {
        OR: [
          { code: { contains: term.toUpperCase() } },
          { client: { name: { contains: term } } },
          { passengers: { some: { name: { contains: term } } } },
          ...(digits.length >= 6 ? [{ client: { document: { contains: digits } } }, { passengers: { some: { document: { contains: digits } } } }] : []),
        ],
      }
    : {};
  return prisma.sale.findMany({
    where: { AND: [saleScope(ctx), { status: { not: "CANCELADA" } }, where] },
    select: { id: true, code: true, status: true, destination: true, tripStart: true, passengerCount: true, client: { select: { name: true } }, _count: { select: { passengers: true } } },
    orderBy: term ? { saleDate: "desc" } : [{ tripStart: "asc" }],
    take: 30,
  });
}

export type SheetPerson = {
  role: "PASSAGEIRO" | "CLIENTE";
  name: string;
  document: string | null;
  birthDate: string | null;
  gender: string | null;
  rg: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  foreigner: boolean;
  nationality: string | null;
  rne: string | null;
  email: string | null;
  phone: string | null;
  linkedClientId: string | null;
};

/** Ficha da venda: passageiros (com o cadastro vinculado completando o que faltar) e o cliente que comprou. */
export async function passengerSheet(ctx: Ctx, saleId: string) {
  assertCan(ctx, "clients.manage");
  const sale = await prisma.sale.findFirst({
    where: { AND: [{ id: saleId }, saleScope(ctx)] },
    include: {
      client: true,
      passengers: { include: { client: true }, orderBy: { createdAt: "asc" } },
      flights: { orderBy: { departureAt: "asc" } },
      items: { select: { productType: true, description: true, locator: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!sale) throw new AppError("Venda não encontrada.", "NOT_FOUND");

  const fromClient = (c: NonNullable<typeof sale.passengers[number]["client"]> | typeof sale.client) => ({
    document: c.document,
    birthDate: c.birthDate,
    gender: c.gender,
    rg: c.rg,
    passportNumber: c.passportNumber,
    passportExpiry: c.passportExpiry,
    foreigner: c.foreigner,
    nationality: c.nationality,
    rne: c.rne,
    email: c.email,
    phone: c.whatsapp ?? c.phone,
  });
  const people: SheetPerson[] = sale.passengers.map((p) => {
    const c = p.client ? fromClient(p.client) : null;
    return {
      role: "PASSAGEIRO",
      name: p.name,
      // o dado da venda vale; o cadastro completa o que ficou vazio
      document: p.document || c?.document || null,
      birthDate: p.birthDate || c?.birthDate || null,
      gender: c?.gender ?? null,
      rg: c?.rg ?? null,
      passportNumber: p.passportNumber || c?.passportNumber || null,
      passportExpiry: p.passportExpiry || c?.passportExpiry || null,
      foreigner: c?.foreigner ?? false,
      nationality: c?.nationality ?? null,
      rne: c?.rne ?? null,
      email: c?.email ?? null,
      phone: c?.phone ?? null,
      linkedClientId: p.clientId,
    };
  });
  // o cliente que comprou, se não estiver entre os passageiros
  const buyerIsPassenger = sale.passengers.some((p) => p.clientId === sale.clientId || (sale.client.document && p.document === sale.client.document));
  if (!buyerIsPassenger) people.unshift({ role: "CLIENTE", name: sale.client.name, ...fromClient(sale.client), linkedClientId: sale.clientId });

  await prisma.$transaction((tx) => audit(tx, ctx, "passageiros.ficha_vista", "Sale", sale.id, { pessoas: people.length }));
  return {
    sale: { id: sale.id, code: sale.code, status: sale.status, destination: sale.destination, tripStart: sale.tripStart, tripEnd: sale.tripEnd, locator: sale.locator, passengerCount: sale.passengerCount },
    people,
    missingPassengers: Math.max(0, sale.passengerCount - sale.passengers.length),
    flights: sale.flights.map((f) => ({ airline: f.airline, flightNumber: f.flightNumber, origin: f.origin, destination: f.destination, departureAt: f.departureAt, arrivalAt: f.arrivalAt })),
    locators: [...new Set(sale.items.map((i) => i.locator).filter(Boolean))] as string[],
  };
}
