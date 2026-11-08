/** Cartão da agência: escolher a fatura, compra antiga (parcela 3 de 8), nova despesa já no cartão e ligar lançamento antigo. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { cashflow, createManualPayable, linkPayableToCard, reverseSettlement, saveAccount, settleEntry, updateEntry } from "@/server/services/finance";
import { listCards } from "@/server/services/cards";
import { computeDre } from "@/server/services/dre";
import { billMonthForDueDate, billMonthOf, cardBillSchedule, cardBillScheduleFrom, cardPlan, oldPurchaseFirstBillMonth } from "@/lib/card-bills";
import { makeCompany } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

describe("faturas do cartão (funções puras)", () => {
  it("monta as faturas a partir de um mês escolhido", () => {
    expect(cardBillScheduleFrom("2026-11", 5, 12, 3).map((b) => [b.month, b.dueDate])).toEqual([
      ["2026-11", "2026-11-12"],
      ["2026-12", "2026-12-12"],
      ["2027-01", "2027-01-12"],
    ]);
  });

  it("pela data da compra dá o mesmo resultado de antes (virada de ano e fevereiro)", () => {
    const cases: [string, number, number, number][] = [
      ["2026-11-03", 5, 12, 1],
      ["2026-11-06", 5, 12, 2],
      ["2026-11-30", 25, 5, 3],
      ["2027-01-31", 31, 10, 2],
      ["2026-12-28", 20, 1, 4],
    ];
    for (const [date, close, due, n] of cases) expect(cardBillSchedule(date, close, due, n)).toEqual(cardBillScheduleFrom(billMonthOf(date, close), close, due, n));
    expect(billMonthOf("2026-12-28", 20)).toBe("2027-01");
  });

  it("mês da fatura pelo vencimento", () => {
    expect(billMonthForDueDate("2026-11-13", 5, 13)).toBe("2026-11");
    expect(billMonthForDueDate("2026-11-05", 25, 5)).toBe("2026-10");
  });

  it("compra antiga: sugere a fatura mais antiga que ainda não venceu (a fechada e não paga)", () => {
    // fecha dia 5, vence dia 13
    expect(oldPurchaseFirstBillMonth("2026-11-08", 5, 13)).toBe("2026-11");
    expect(oldPurchaseFirstBillMonth("2026-11-14", 5, 13)).toBe("2026-12");
    expect(oldPurchaseFirstBillMonth("2026-11-03", 5, 13)).toBe("2026-11");
    // fecha dia 25, vence dia 5 do mês seguinte
    expect(oldPurchaseFirstBillMonth("2026-11-03", 25, 5)).toBe("2026-10");
    expect(oldPurchaseFirstBillMonth("2026-11-06", 25, 5)).toBe("2026-11");
    // a de nov fechou em 25/11 e só vence em 05/12: ainda é a fatura a pagar
    expect(oldPurchaseFirstBillMonth("2026-11-26", 25, 5)).toBe("2026-11");
    expect(oldPurchaseFirstBillMonth("2026-12-06", 25, 5)).toBe("2026-12");
    // sem dia de vencimento: a fatura aberta
    expect(oldPurchaseFirstBillMonth("2026-11-08", 5, null)).toBe("2026-12");
  });

  it("compra antiga em 8x começando na 3ª: só 6 parcelas, numeração original", () => {
    const plan = cardPlan({ amountCents: 100003, installments: 8, startInstallment: 3, firstMonth: "2026-11", closingDay: 5, dueDay: 13 });
    expect(plan).toHaveLength(6);
    expect(plan.map((p) => p.n)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(plan.every((p) => p.of === 8)).toBe(true);
    // 100003 / 8 = 12500 (a 1ª parcela, já paga, leva os 3 centavos que sobram)
    expect(plan.reduce((t, p) => t + p.cents, 0)).toBe(12500 * 6);
    expect(plan[0]).toMatchObject({ month: "2026-11", dueDate: "2026-11-13" });
    expect(plan[5].month).toBe("2027-04");
  });
});

describe("cartão da agência nas contas a pagar", () => {
  let env: Env;
  let cardId: string;
  beforeAll(async () => {
    env = await makeCompany("Cartão Izabel");
    cardId = await saveAccount(env.fin, null, { name: "Izabel", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 13 });
  });
  const bills = () => prisma.payable.findMany({ where: { companyId: env.company.id, origin: "CARTAO", status: { not: "CANCELADO" } }, orderBy: { dueDate: "asc" } });

  it("nova despesa já paga no cartão (8x, começando na 3ª): uma conta paga e 6 faturas", async () => {
    const [id] = await createManualPayable(env.fin, {
      description: "Azulvia N54vzf787a5",
      supplierId: env.supplier.id,
      category: "FORNECEDORES",
      amountCents: 100000,
      firstDueDate: "2026-08-20",
      card: { accountId: cardId, installments: 8, startInstallment: 3, firstBillMonth: "2026-11" },
    });
    const p = await prisma.payable.findUniqueOrThrow({ where: { id }, include: { settlements: true } });
    expect(p.status).toBe("PAGO");
    expect(p.category).toBe("FORNECEDORES");
    expect(p.method).toBe("CARTAO_CREDITO");
    expect(p.settlements[0]).toMatchObject({ cardInstallments: 8, cardStartInstallment: 3, cardFirstBillMonth: "2026-11" });
    const b = await bills();
    expect(b.map((x) => x.sourceKey)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"].map((m) => `cartao:${cardId}:${m}`));
    expect(b.every((x) => x.amountCents === 12500)).toBe(true);
    expect(b[0].notes).toContain("(3/8)");
    expect(b[5].notes).toContain("(8/8)");
    const [card] = await listCards(env.fin);
    expect(card.openCents).toBe(75000);
  });

  it("a compra não sai do caixa e conta uma vez só no resultado", async () => {
    const cf = await cashflow(env.fin, { from: "2026-08-01", to: "2026-08-31", granularity: "month" as never });
    expect(cf.totals.realizedOut).toBe(0);
    const dre = await computeDre(env.company.id, { from: "2026-01-01", to: "2027-12-31" });
    expect(dre.lines.find((l) => l.key === "despesas")!.amountCents).toBe(100000);
  });

  it("estorno tira exatamente as 6 parcelas; faturas zeradas somem", async () => {
    const p = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, description: "Azulvia N54vzf787a5" }, include: { settlements: true } });
    await reverseSettlement(env.fin, p.settlements[0].id, "lançado errado");
    expect(await bills()).toHaveLength(0);
    expect((await prisma.payable.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDENTE");
  });

  it("categoria Fatura do cartão não pode ser usada à mão; recorrente no cartão é recusado; cartão inválido", async () => {
    await expect(createManualPayable(env.fin, { description: "Fatura", category: "FATURA_CARTAO", amountCents: 1000, firstDueDate: "2026-11-10" })).rejects.toThrow(/preenchida sozinha/);
    await expect(
      createManualPayable(env.fin, { description: "Assinatura", category: "ADMINISTRATIVAS", amountCents: 1000, firstDueDate: "2026-11-10", recurringMonths: 3, card: { accountId: cardId } }),
    ).rejects.toThrow(/recorrente no cartão/);
    await expect(
      createManualPayable(env.fin, { description: "Banco", category: "ADMINISTRATIVAS", amountCents: 1000, firstDueDate: "2026-11-10", card: { accountId: env.account.id } }),
    ).rejects.toThrow(/Conta financeira inválida/);
    const other = await makeCompany("Outra agência");
    const otherCard = await saveAccount(other.fin, null, { name: "Cartão de lá", type: "CARTAO_CREDITO", closingDay: 5, dueDay: 13 });
    await expect(
      createManualPayable(env.fin, { description: "Cartão alheio", category: "ADMINISTRATIVAS", amountCents: 1000, firstDueDate: "2026-11-10", card: { accountId: otherCard } }),
    ).rejects.toThrow(/Conta financeira inválida/);
  });

  it("baixa escolhendo a fatura de dezembro vai para dezembro, não novembro", async () => {
    const [id] = await createManualPayable(env.fin, { description: "Hotel dezembro", category: "FORNECEDORES", amountCents: 30000, firstDueDate: "2026-11-03" });
    await settleEntry(env.fin, "payable", id, { date: "2026-11-03", amountCents: 30000, accountId: cardId, cardFirstBillMonth: "2026-12" });
    const b = await bills();
    expect(b.map((x) => x.sourceKey)).toEqual([`cartao:${cardId}:2026-12`]);
    await expect(settleEntry(env.fin, "payable", id, { date: "2026-11-03", amountCents: 1, accountId: cardId, cardInstallments: 2, cardStartInstallment: 3 })).rejects.toThrow(
      /parcela inicial/,
    );
  });

  it("fatura já paga: recusa e diz o que fazer; a fatura seguinte funciona", async () => {
    const dec = (await bills())[0];
    await settleEntry(env.fin, "payable", dec.id, { date: "2026-12-13", amountCents: dec.amountCents, accountId: env.account.id });
    const [id] = await createManualPayable(env.fin, { description: "Passeio", category: "FORNECEDORES", amountCents: 5000, firstDueDate: "2026-11-20" });
    await expect(settleEntry(env.fin, "payable", id, { date: "2026-11-20", amountCents: 5000, accountId: cardId })).rejects.toThrow(/dez\/2026 do cartão "Izabel" já está paga/);
    expect((await prisma.payable.findUniqueOrThrow({ where: { id } })).status).toBe("PENDENTE");
    await settleEntry(env.fin, "payable", id, { date: "2026-11-20", amountCents: 5000, accountId: cardId, cardFirstBillMonth: "2027-01" });
    expect((await prisma.payable.findUniqueOrThrow({ where: { id } })).status).toBe("PAGO");
  });

  it("fatura do cartão: valor, categoria e cancelamento com mensagens próprias", async () => {
    const bill = (await bills()).find((b) => b.sourceKey!.endsWith("2027-01"))!;
    const base = { description: bill.description, amountCents: bill.amountCents, dueDate: bill.dueDate, category: bill.category };
    await expect(updateEntry(env.fin, "payable", bill.id, { ...base, amountCents: 1 })).rejects.toThrow(/soma das compras/);
    await expect(updateEntry(env.fin, "payable", bill.id, { ...base, category: "FORNECEDORES" })).rejects.toThrow(/sempre na categoria/);
  });

  it("ligar a um cartão um lançamento antigo com categoria Fatura do cartão", async () => {
    // lançamento antigo, de antes da trava (como o do print)
    const old = await prisma.payable.create({
      data: { companyId: env.company.id, origin: "MANUAL", description: "Azulvia N54vzf787a5 (1/8)", category: "FATURA_CARTAO", amountCents: 12500, dueDate: "2026-11-13", method: "CARTAO_CREDITO", status: "PENDENTE" },
    });
    // editar mantendo a categoria antiga continua permitido; trocar outra conta PARA a categoria não
    await updateEntry(env.fin, "payable", old.id, { description: old.description, amountCents: 12500, dueDate: old.dueDate, category: "FATURA_CARTAO", notes: "conferir" });
    const [other] = await createManualPayable(env.fin, { description: "Aluguel", category: "ADMINISTRATIVAS", amountCents: 1000, firstDueDate: "2026-11-10" });
    await expect(updateEntry(env.fin, "payable", other, { description: "Aluguel", amountCents: 1000, dueDate: "2026-11-10", category: "FATURA_CARTAO" })).rejects.toThrow(/preenchida sozinha/);
    await expect(linkPayableToCard(env.fin, other, { accountId: cardId, billMonth: "2026-11", category: "FORNECEDORES" })).rejects.toThrow(/Só lançamentos/);

    await linkPayableToCard(env.fin, old.id, { accountId: cardId, billMonth: billMonthForDueDate(old.dueDate, 5, 13), category: "FORNECEDORES" });
    const p = await prisma.payable.findUniqueOrThrow({ where: { id: old.id } });
    expect(p).toMatchObject({ status: "PAGO", category: "FORNECEDORES" });
    const nov = await prisma.payable.findFirstOrThrow({ where: { companyId: env.company.id, sourceKey: `cartao:${cardId}:2026-11` } });
    expect(nov.amountCents).toBe(12500);
    expect(nov.dueDate).toBe("2026-11-13");
    await expect(linkPayableToCard(env.fin, nov.id, { accountId: cardId, billMonth: "2026-11", category: "FORNECEDORES" })).rejects.toThrow(/já é a fatura/);
    // já pago: recusa
    const old2 = await prisma.payable.create({
      data: { companyId: env.company.id, origin: "MANUAL", description: "Azulvia (2/8)", category: "FATURA_CARTAO", amountCents: 12500, dueDate: "2026-12-13", status: "PENDENTE" },
    });
    await settleEntry(env.fin, "payable", old2.id, { date: "2026-12-13", amountCents: 100, accountId: env.account.id });
    await expect(linkPayableToCard(env.fin, old2.id, { accountId: cardId, billMonth: "2026-12", category: "FORNECEDORES" })).rejects.toThrow(/já tem pagamento/);
    // gerado pelo sistema: recusa
    const gen = await prisma.payable.create({
      data: { companyId: env.company.id, origin: "CUSTO_VENDA", sourceKey: "teste:1", description: "Gerado", category: "FATURA_CARTAO", amountCents: 100, dueDate: "2026-12-13", status: "PENDENTE" },
    });
    await expect(linkPayableToCard(env.fin, gen.id, { accountId: cardId, billMonth: "2026-12", category: "FORNECEDORES" })).rejects.toThrow(/gerada pelo sistema/);
  });
});
