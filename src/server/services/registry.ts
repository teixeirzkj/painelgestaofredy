import { addMonths } from "@/lib/dates";
// Cadastros: clientes e fornecedores.
import { prisma, Prisma } from "../db";
import { assertCan, can, today, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { clientSchema, supplierSchema } from "./schemas";
import { textContains } from "./query";
import { displayStatus } from "@/lib/finance";
import { onlyDigits } from "@/lib/utils";
import { clientIdentity, normalizeDocCode } from "@/lib/client-identity";
import { saleScope } from "./sales";
import { tripDates, tripStatus } from "./trips";

// ------------------------------ Clientes ------------------------------

/** Busca por passaporte ou RNE (estrangeiro), a partir de 4 caracteres. */
export function docCodeFilters(q: string | undefined): Prisma.ClientWhereInput[] {
  const code = normalizeDocCode(q);
  if (!code || code.length < 4) return [];
  return [{ passportNumber: textContains(code) }, { rne: textContains(code) }];
}

export function clientScope(ctx: Ctx): Prisma.ClientWhereInput {
  if (can(ctx, "clients.view_all")) return { companyId: ctx.companyId };
  return { companyId: ctx.companyId, OR: [{ ownerId: ctx.userId }, { sales: { some: { sellerId: ctx.userId } } }] };
}

export async function listClients(ctx: Ctx, f: { q?: string; page?: number; archived?: boolean }) {
  const page = Math.max(1, f.page ?? 1);
  const qDigits = onlyDigits(f.q);
  const where: Prisma.ClientWhereInput = {
    AND: [
      clientScope(ctx),
      { archivedAt: f.archived ? { not: null } : null },
      f.q
        ? {
            OR: [
              { name: textContains(f.q) },
              { email: textContains(f.q) },
              ...(qDigits.length >= 3 ? [{ document: { contains: qDigits } }, { phone: { contains: qDigits } }, { whatsapp: { contains: qDigits } }] : []),
              ...docCodeFilters(f.q),
            ],
          }
        : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * 25,
      take: 25,
      include: {
        _count: { select: { sales: true } },
        sales: { where: { status: { not: "CANCELADA" } }, select: { grossCents: true, saleDate: true }, orderBy: { saleDate: "desc" } },
      },
    }),
    prisma.client.count({ where }),
  ]);
  return {
    items: items.map(({ sales, ...c }) => ({
      ...c,
      totalCents: sales.reduce((a, s) => a + s.grossCents, 0),
      lastSale: sales[0]?.saleDate ?? null,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / 25)),
  };
}

/** Busca rápida (autocomplete) para o formulário de venda. */
export async function searchClients(ctx: Ctx, q: string) {
  const digits = onlyDigits(q);
  const rows = await prisma.client.findMany({
    where: {
      AND: [
        clientScope(ctx),
        { archivedAt: null },
        q ? { OR: [{ name: textContains(q) }, ...(digits.length >= 3 ? [{ document: { contains: digits } }, { whatsapp: { contains: digits } }, { phone: { contains: digits } }] : []), ...docCodeFilters(q)] } : {},
      ],
    },
    select: { id: true, name: true, document: true, whatsapp: true, phone: true, email: true, foreigner: true, passportNumber: true, rne: true, nationality: true },
    orderBy: { name: "asc" },
    take: 12,
  });
  // passaporte e RNE não vão crus para o navegador: só o resumo mascarado (docHint)
  return rows.map(({ passportNumber, rne, nationality, ...c }) => ({
    ...c,
    // sem CPF/CNPJ: "Passaporte nº ******456 (Argentina)"
    docHint: c.document ? null : clientIdentity({ ...c, passportNumber, rne, nationality }, { mask: true }),
  }));
}

export async function getClient(ctx: Ctx, id: string) {
  const client = await prisma.client.findFirst({
    where: { AND: [{ id }, clientScope(ctx)] },
    include: { owner: { select: { name: true } }, attachments: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, docNumber: true, docExpiry: true, createdAt: true } } },
  });
  if (!client) throw new AppError("Cliente não encontrado.", "NOT_FOUND");
  const t = today(ctx);
  const [sales, receivables, contracts, trips, asPassenger] = await Promise.all([
    prisma.sale.findMany({
      where: { clientId: id, ...saleScope(ctx) },
      orderBy: { saleDate: "desc" },
      select: { id: true, code: true, saleDate: true, destination: true, status: true, grossCents: true, tripStart: true, tripEnd: true, mainProductType: true },
    }),
    can(ctx, "finance.view") || can(ctx, "sales.view_all")
      ? prisma.receivable.findMany({
          where: { companyId: ctx.companyId, clientId: id, status: { not: "CANCELADO" } },
          orderBy: { dueDate: "asc" },
          include: { sale: { select: { code: true, id: true, clientId: true } } },
        })
      : prisma.receivable.findMany({
          where: { companyId: ctx.companyId, clientId: id, status: { not: "CANCELADO" }, sale: { sellerId: ctx.userId } },
          orderBy: { dueDate: "asc" },
          include: { sale: { select: { code: true, id: true, clientId: true } } },
        }),
    prisma.contract.findMany({
      where: { companyId: ctx.companyId, sale: { clientId: id, ...saleScope(ctx) } },
      include: { sale: { select: { code: true } }, trip: { select: { code: true } } },
    }),
    prisma.trip.findMany({
      where: { companyId: ctx.companyId, clientId: id },
      include: { sales: { where: saleScope(ctx), select: { status: true, tripStart: true, tripEnd: true, grossCents: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // viagens em que a pessoa foi passageira em vendas de outro cliente (ex.: dependente, grupo)
    prisma.passenger.findMany({
      where: { companyId: ctx.companyId, clientId: id, sale: { ...saleScope(ctx), clientId: { not: id } } },
      include: { sale: { select: { id: true, code: true, destination: true, tripStart: true, status: true, client: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const passportAlert =
    client.passportExpiry && client.passportExpiry < addMonths(t, 6) ? (client.passportExpiry < t ? "VENCIDO" : "VENCE_EM_6_MESES") : null;
  const active = sales.filter((s) => s.status !== "CANCELADA");
  return {
    client,
    sales,
    receivables: receivables.map((r) => ({ ...r, balanceCents: r.amountCents - r.settledCents, displayStatus: displayStatus(r.status, r.dueDate, t) })),
    contracts,
    trips: trips.map((tr) => ({ ...tr, ...tripDates(tr.sales), status: tripStatus(!!tr.cancelledAt, tr.sales, t) })),
    asPassenger,
    passportAlert,
    stats: {
      totalCents: active.reduce((a, s) => a + s.grossCents, 0),
      count: active.length,
      receivedCents: receivables.reduce((a, r) => a + r.receivedCents, 0),
      openCents: receivables.filter((r) => r.status !== "PAGO").reduce((a, r) => a + r.amountCents - r.settledCents, 0),
      overdueCents: receivables.filter((r) => r.status !== "PAGO" && r.dueDate < t).reduce((a, r) => a + r.amountCents - r.settledCents, 0),
      destinations: [...new Set(active.map((s) => s.destination).filter(Boolean))] as string[],
      upcomingTrips: active.filter((s) => s.tripStart && s.tripStart >= t).sort((a, b) => a.tripStart!.localeCompare(b.tripStart!)),
    },
  };
}

export async function saveClient(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "clients.manage");
  const d = clientSchema.parse(raw);
  try {
    return await prisma.$transaction(async (tx) => {
      if (id) {
        const c = await tx.client.findFirst({ where: { AND: [{ id }, clientScope(ctx)] } });
        if (!c) throw new AppError("Cliente não encontrado.", "NOT_FOUND");
        // só confere passaporte repetido quando ele mudou (cadastros antigos podem ter repetidos)
        if (d.passportNumber && d.passportNumber !== normalizeDocCode(c.passportNumber)) await assertPassportFree(tx, ctx, d.passportNumber, id);
        await tx.client.update({ where: { id }, data: d });
        await audit(tx, ctx, "cliente.alterado", "Client", id);
        return { id, name: d.name };
      }
      if (d.passportNumber) await assertPassportFree(tx, ctx, d.passportNumber, null);
      const c = await tx.client.create({ data: { ...d, companyId: ctx.companyId, ownerId: ctx.userId } });
      await audit(tx, ctx, "cliente.criado", "Client", c.id);
      return { id: c.id, name: c.name };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("Já existe um cliente com este CPF/CNPJ.", "CONFLICT", [{ field: "document", message: "CPF/CNPJ já cadastrado." }]);
    throw e;
  }
}

async function assertPassportFree(tx: Prisma.TransactionClient, ctx: Ctx, passportNumber: string, selfId: string | null) {
  const other = await tx.client.findFirst({
    where: { companyId: ctx.companyId, passportNumber, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true },
  });
  if (other) throw new AppError("Já existe um cliente com este passaporte.", "CONFLICT", [{ field: "passportNumber", message: "Passaporte já cadastrado." }]);
}

export async function archiveClient(ctx: Ctx, id: string, archived: boolean) {
  assertCan(ctx, "clients.manage");
  const c = await prisma.client.findFirst({ where: { AND: [{ id }, clientScope(ctx)] } });
  if (!c) throw new AppError("Cliente não encontrado.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await audit(tx, ctx, archived ? "cliente.arquivado" : "cliente.reativado", "Client", id);
  });
}

// ------------------------------ Fornecedores ------------------------------

export async function listSuppliers(ctx: Ctx, f: { q?: string; category?: string }) {
  assertCan(ctx, "suppliers.view");
  const suppliers = await prisma.supplier.findMany({
    where: {
      companyId: ctx.companyId,
      archivedAt: null,
      ...(f.category ? { category: f.category } : {}),
      ...(f.q ? { OR: [{ name: textContains(f.q) }, { document: { contains: onlyDigits(f.q) || f.q } }] } : {}),
    },
    orderBy: { name: "asc" },
  });
  const showFinance = can(ctx, "finance.view");
  const [items, payables] = await Promise.all([
    prisma.saleItem.groupBy({
      by: ["supplierId"],
      where: { companyId: ctx.companyId, supplierId: { in: suppliers.map((s) => s.id) }, sale: { status: { in: ["CONFIRMADA", "CONCLUIDA"] } } },
      _sum: { priceCents: true },
      _count: { _all: true },
    }),
    showFinance
      ? prisma.payable.groupBy({
          by: ["supplierId"],
          where: { companyId: ctx.companyId, supplierId: { in: suppliers.map((s) => s.id) }, status: { in: ["PENDENTE", "PARCIAL"] } },
          _sum: { amountCents: true, settledCents: true },
        })
      : Promise.resolve([]),
  ]);
  return suppliers.map((s) => {
    const it = items.find((i) => i.supplierId === s.id);
    const p = payables.find((x) => x.supplierId === s.id);
    return {
      ...s,
      bankInfo: showFinance ? s.bankInfo : null,
      salesCount: it?._count._all ?? 0,
      negotiatedCents: it?._sum.priceCents ?? 0,
      openCents: p ? (p._sum.amountCents ?? 0) - (p._sum.settledCents ?? 0) : null,
    };
  });
}

export async function getSupplier(ctx: Ctx, id: string) {
  assertCan(ctx, "suppliers.view");
  const supplier = await prisma.supplier.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!supplier) throw new AppError("Fornecedor não encontrado.", "NOT_FOUND");
  const showFinance = can(ctx, "finance.view");
  const t = today(ctx);
  const [items, payables, reservations, receivables, invoices, rules] = await Promise.all([
    prisma.saleItem.findMany({
      where: { companyId: ctx.companyId, OR: [{ supplierId: id }, { operatorId: id }], sale: saleScope(ctx) },
      include: { sale: { select: { id: true, code: true, saleDate: true, status: true, client: { select: { name: true } } } } },
      orderBy: { sale: { saleDate: "desc" } },
      take: 100,
    }),
    showFinance
      ? prisma.payable.findMany({ where: { companyId: ctx.companyId, supplierId: id, status: { not: "CANCELADO" } }, include: { sale: { select: { id: true, code: true } } }, orderBy: { dueDate: "asc" } })
      : Promise.resolve([]),
    prisma.reservation.findMany({
      where: { companyId: ctx.companyId, supplierId: id, status: { not: "CANCELADA" }, sale: saleScope(ctx) },
      include: { sale: { select: { id: true, code: true, client: { select: { name: true } } } } },
      orderBy: { startDate: "asc" },
      take: 50,
    }),
    showFinance
      ? prisma.receivable.findMany({ where: { companyId: ctx.companyId, supplierId: id, status: { not: "CANCELADO" } }, include: { sale: { select: { id: true, code: true } } } })
      : Promise.resolve([]),
    showFinance
      ? prisma.supplierInvoice.findMany({ where: { companyId: ctx.companyId, supplierId: id }, orderBy: { dueDate: "desc" }, take: 20 })
      : Promise.resolve([]),
    prisma.commissionRule.findMany({ where: { companyId: ctx.companyId, supplierId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  const active = items.filter((i) => i.sale.status !== "CANCELADA" && i.sale.status !== "ORCAMENTO");
  return {
    supplier: { ...supplier, bankInfo: showFinance ? supplier.bankInfo : null, pixKey: showFinance ? supplier.pixKey : null },
    items,
    payables: payables.map((p) => ({ ...p, balanceCents: p.amountCents - p.settledCents, displayStatus: displayStatus(p.status, p.dueDate, t) })),
    receivables: receivables.map((r) => ({ ...r, balanceCents: r.amountCents - r.settledCents, displayStatus: displayStatus(r.status, r.dueDate, t) })),
    reservations,
    invoices,
    rules,
    stats: {
      salesCount: new Set(active.map((i) => i.saleId)).size,
      negotiatedCents: active.reduce((a, i) => a + i.priceCents, 0),
      openCents: showFinance ? payables.filter((p) => p.status !== "PAGO").reduce((a, p) => a + p.amountCents - p.settledCents, 0) : null,
      paidCents: showFinance ? payables.reduce((a, p) => a + p.paidCents, 0) : null,
      overdueCents: showFinance ? payables.filter((p) => p.status !== "PAGO" && p.dueDate < t).reduce((a, p) => a + p.amountCents - p.settledCents, 0) : null,
    },
    showFinance,
  };
}

export async function saveSupplier(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "suppliers.manage");
  const d = supplierSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (id) {
      const s = await tx.supplier.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!s) throw new AppError("Fornecedor não encontrado.", "NOT_FOUND");
      await tx.supplier.update({ where: { id }, data: d });
      await audit(tx, ctx, "fornecedor.alterado", "Supplier", id);
      return { id, name: d.name };
    }
    const s = await tx.supplier.create({ data: { ...d, companyId: ctx.companyId } });
    await audit(tx, ctx, "fornecedor.criado", "Supplier", s.id);
    return { id: s.id, name: s.name };
  });
}

export async function archiveSupplier(ctx: Ctx, id: string) {
  assertCan(ctx, "suppliers.manage");
  const s = await prisma.supplier.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!s) throw new AppError("Fornecedor não encontrado.", "NOT_FOUND");
  const open = await prisma.payable.count({ where: { supplierId: id, status: { in: ["PENDENTE", "PARCIAL"] } } });
  if (open) throw new AppError("Há contas a pagar em aberto para este fornecedor.");
  await prisma.$transaction(async (tx) => {
    await tx.supplier.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(tx, ctx, "fornecedor.arquivado", "Supplier", id);
  });
}

export async function supplierOptions(ctx: Ctx) {
  return prisma.supplier.findMany({ where: { companyId: ctx.companyId, archivedAt: null }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } });
}

/** Busca de pessoas para pagantes e passageiros (mesmo escopo de clientes). */
export async function searchPeople(ctx: Ctx, q: string) {
  return searchClients(ctx, q);
}
