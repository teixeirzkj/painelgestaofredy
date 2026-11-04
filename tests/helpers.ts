import { prisma } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { newKey } from "@/lib/utils";

export async function makeCompany(name = "Agência Teste") {
  const company = await prisma.company.create({ data: { name, timezone: "America/Sao_Paulo" } });
  const mk = (role: string, n: string) =>
    prisma.user.create({ data: { companyId: company.id, name: n, email: `${n.toLowerCase()}-${newKey()}@teste.com`, passwordHash: "x", role } });
  const admin = await mk("ADMIN", "Admin");
  const seller = await mk("VENDEDOR", "Vendedora");
  const seller2 = await mk("VENDEDOR", "Vendedor2");
  const fin = await mk("FINANCEIRO", "Financeiro");
  const client = await prisma.client.create({ data: { companyId: company.id, name: "Maria Cliente", document: "52998224725", street: "Rua A", number: "1", city: "Guarapuava", state: "PR" } });
  const supplier = await prisma.supplier.create({ data: { companyId: company.id, name: "Operadora X", category: "OPERADORA" } });
  const account = await prisma.financialAccount.create({ data: { companyId: company.id, name: "Banco", type: "BANCO", initialBalanceCents: 100000 } });
  const account2 = await prisma.financialAccount.create({ data: { companyId: company.id, name: "Caixa", type: "CAIXA" } });
  const ctx = async (id: string) => (await loadContext(id)) as Ctx;
  return {
    company,
    client,
    supplier,
    account,
    account2,
    admin: await ctx(admin.id),
    seller: await ctx(seller.id),
    seller2: await ctx(seller2.id),
    fin: await ctx(fin.id),
  };
}

/** Venda do cenário obrigatório: pacote R$ 8.000, custo R$ 6.500, comissão R$ 200, 4 × R$ 2.000. */
export function exampleSale(clientId: string, supplierId: string, overrides: Record<string, unknown> = {}) {
  return {
    saleDate: "2026-11-04",
    clientId,
    destination: "Porto Seguro - BA",
    tripStart: "2027-01-10",
    tripEnd: "2027-01-17",
    passengerCount: 2,
    locator: "ABC123",
    feesCents: 0,
    discountCents: 0,
    commission: { mode: "VALOR", amountCents: 20000 },
    items: [
      {
        productType: "PACOTE",
        description: "Pacote 7 noites",
        supplierId,
        commercialModel: "INTERMEDIACAO",
        priceCents: 800000,
        costCents: 650000,
        supplierCommissionCents: 0,
        supplierDueDate: "2026-12-10",
      },
    ],
    payments: ["2026-11-15", "2026-12-15", "2027-01-15", "2027-02-15"].map((dueDate, i) => ({
      key: `p${i + 1}`,
      dueDate,
      amountCents: 200000,
      method: "PIX",
    })),
    passengers: [],
    confirm: true,
    ...overrides,
  };
}
