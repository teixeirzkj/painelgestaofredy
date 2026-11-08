/** Cartão de crédito da agência pagando fornecedor: quita a conta e lança na fatura do mês certo. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createManualPayable, createManualReceivable, settleEntry, reverseSettlement, saveAccount, cashflow } from "@/server/services/finance";
import { cardBillSchedule, listCards, removePurchaseLine } from "@/server/services/cards";
import { makeCompany } from "./helpers";
import { formatBRL } from "@/lib/money";

type Env = Awaited<ReturnType<typeof makeCompany>>;

describe("fatura do cartão: em qual mês cai cada compra", () => {
  it("compra até o fechamento entra na fatura do mês; depois, na seguinte", () => {
    expect(cardBillSchedule("2026-11-03", 5, 12, 1)).toEqual([{ month: "2026-11", label: "nov/2026", closingDate: "2026-11-05", dueDate: "2026-11-12" }]);
    expect(cardBillSchedule("2026-11-06", 5, 12, 1)[0]).toMatchObject({ month: "2026-12", dueDate: "2026-12-12" });
  });
  it("vencimento antes do fechamento vence no mês seguinte; parcelas viram meses seguidos e virada de ano", () => {
    const s = cardBillSchedule("2026-11-30", 25, 5, 3);
    expect(s.map((x) => [x.month, x.dueDate])).toEqual([
      ["2026-12", "2027-01-05"],
      ["2027-01", "2027-02-05"],
      ["2027-02", "2027-03-05"],
    ]);
    expect(cardBillSchedule("2027-01-31", 31, 10, 2)[1].closingDate).toBe("2027-02-28");
  });
});

describe("pagar fornecedor com o cartão da agência", () => {
  let env: Env;
  let cardId: string;
  beforeAll(async () => {
    env = await makeCompany("Cartão");
    cardId = await saveAccount(env.fin, null, { name: "Cartão Itaú 1234", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 12 });
  });

  const payable = async (desc: string, cents: number) => {
    await createManualPayable(env.fin, { description: desc, supplierId: env.supplier.id, category: "FORNECEDORES", amountCents: cents, firstDueDate: "2026-11-10" });
    return prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, description: desc } });
  };

  it("cartão exige dia de fechamento e vencimento", async () => {
    await expect(saveAccount(env.fin, null, { name: "Sem dias", type: "CARTAO_CREDITO" })).rejects.toThrow();
  });

  it("quita a conta do fornecedor e cria as faturas (3x), acumulando compras do mesmo mês", async () => {
    const p1 = await payable("Hotel Gramado", 300000);
    await settleEntry(env.fin, "payable", p1.id, { date: "2026-11-03", amountCents: 300000, accountId: cardId, cardInstallments: 3 });
    expect((await prisma.payable.findUniqueOrThrow({ where: { id: p1.id } })).status).toBe("PAGO");
    const p2 = await payable("Passeio Bonito", 50000);
    await settleEntry(env.fin, "payable", p2.id, { date: "2026-11-04", amountCents: 50000, accountId: cardId });
    const bills = await prisma.payable.findMany({ where: { companyId: env.company.id, origin: "CARTAO" }, orderBy: { dueDate: "asc" } });
    expect(bills.map((b) => [b.dueDate, b.amountCents, b.category])).toEqual([
      ["2026-11-12", 150000, "FATURA_CARTAO"],
      ["2026-12-12", 100000, "FATURA_CARTAO"],
      ["2027-01-12", 100000, "FATURA_CARTAO"],
    ]);
    expect(bills[0].notes).toContain("Passeio Bonito");
    const [card] = await listCards(env.fin);
    expect(card.openCents).toBe(350000);
  });

  it("a compra no cartão não sai do caixa; a fatura é que sai, no vencimento", async () => {
    const cf = await cashflow(env.fin, { from: "2026-11-01", to: "2026-11-30", granularity: "month" as never });
    expect(JSON.stringify(cf)).not.toContain("-300000");
    const nov = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, origin: "CARTAO", dueDate: "2026-11-12" } });
    expect(nov.status).toBe("PENDENTE");
  });

  it("não aceita receber no cartão nem pagar a fatura com o próprio cartão", async () => {
    await createManualReceivable(env.fin, { description: "Receita teste", category: "OUTRAS", amountCents: 1000, firstDueDate: "2026-11-10" } as never).catch(() => null);
    const r = await prisma.receivable.findFirst({ where: { companyId: env.company.id } });
    if (r) await expect(settleEntry(env.fin, "receivable", r.id, { date: "2026-11-03", amountCents: 1000, accountId: cardId })).rejects.toThrow(/só serve para pagar/);
    const bill = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, origin: "CARTAO", dueDate: "2026-11-12" } });
    await expect(settleEntry(env.fin, "payable", bill.id, { date: "2026-11-12", amountCents: 1000, accountId: cardId })).rejects.toThrow(/conta bancária/);
  });

  it("estorno tira o valor das faturas; com a fatura paga, o estorno é bloqueado", async () => {
    const p2 = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, description: "Passeio Bonito" }, include: { settlements: true } });
    await reverseSettlement(env.fin, p2.settlements[0].id, "lançado no cartão errado");
    const nov = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, origin: "CARTAO", dueDate: "2026-11-12" } });
    expect(nov.amountCents).toBe(100000);
    // a compra estornada sai também da lista de compras da fatura (e da contagem)
    expect(nov.notes ?? "").not.toContain("Passeio Bonito");
    expect(nov.notes ?? "").toContain("Hotel Gramado");
    // paga a fatura de novembro pelo banco e tenta estornar a compra de 3x
    await settleEntry(env.fin, "payable", nov.id, { date: "2026-11-12", amountCents: 100000, accountId: env.account.id });
    const p1 = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, description: "Hotel Gramado" }, include: { settlements: true } });
    await expect(reverseSettlement(env.fin, p1.settlements[0].id, "teste")).rejects.toThrow(/já foi paga/);
  });
});

describe("linha da compra nas notas da fatura", () => {
  it("tira a linha guardada ou, em baixa antiga, a que bate com data, descrição e valor", () => {
    const hotel = `03/11/2026 · Hotel · ${formatBRL(100000)} (1/3)`;
    const passeio = `03/11/2026 · Passeio · ${formatBRL(20000)}`;
    const notes = [hotel, passeio].join(String.fromCharCode(10));
    expect(removePurchaseLine(notes, { cents: 20000, line: passeio })).toBe(hotel);
    expect(removePurchaseLine(notes, { cents: 100000 }, { date: "2026-11-03", description: "Hotel" })).toBe(passeio);
    expect(removePurchaseLine(notes, { cents: 5000 }, { date: "2026-11-03", description: "Hotel" })).toBe(notes);
    expect(removePurchaseLine(passeio, { cents: 20000, line: passeio })).toBeNull();
  });
});
