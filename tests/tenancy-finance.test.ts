import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createSale, getSale, listSales, cancelSale, updateSale } from "@/server/services/sales";
import {
  settleEntry,
  listReceivables,
  createManualPayable,
  cancelEntry,
  createTransfer,
  cashflow,
  listAccounts,
  reverseSettlement,
} from "@/server/services/finance";
import { getClient, listClients, saveClient } from "@/server/services/registry";
import { importStatement, listStatementLines, matchStatementLine } from "@/server/services/reconciliation";
import { runScheduledAutomations } from "@/server/services/automations";
import { makeCompany, exampleSale } from "./helpers";

describe("isolamento entre empresas (multi-tenant)", () => {
  let a: Awaited<ReturnType<typeof makeCompany>>;
  let b: Awaited<ReturnType<typeof makeCompany>>;
  let saleA: string;

  beforeAll(async () => {
    a = await makeCompany("Empresa A");
    b = await makeCompany("Empresa B");
    saleA = (await createSale(a.seller, exampleSale(a.client.id, a.supplier.id))).id;
  });

  it("empresa B não lê vendas, clientes nem lançamentos da empresa A", async () => {
    await expect(getSale(b.admin, saleA)).rejects.toThrow(/não encontrada/);
    expect((await listSales(b.admin, {})).items.find((s) => s.id === saleA)).toBeUndefined();
    await expect(getClient(b.admin, a.client.id)).rejects.toThrow(/não encontrado/);
    expect((await listClients(b.admin, {})).items.some((c) => c.id === a.client.id)).toBe(false);
    const recB = await listReceivables(b.admin, {});
    expect(recB.items.some((r) => r.saleId === saleA)).toBe(false);
  });

  it("empresa B não altera, baixa nem cancela dados da empresa A", async () => {
    const recA = await prisma.receivable.findFirstOrThrow({ where: { saleId: saleA } });
    await expect(settleEntry(b.admin, "receivable", recA.id, { date: "2026-11-10", amountCents: 1000, accountId: b.account.id })).rejects.toThrow(/não encontrado/);
    // nem usando conta da empresa A a partir da empresa B
    await expect(settleEntry(b.admin, "receivable", recA.id, { date: "2026-11-10", amountCents: 1000, accountId: a.account.id })).rejects.toThrow();
    await expect(cancelSale(b.admin, saleA, "invasão")).rejects.toThrow(/não encontrada/);
    await expect(updateSale(b.admin, saleA, exampleSale(b.client.id, b.supplier.id))).rejects.toThrow(/não encontrada/);
    await expect(saveClient(b.admin, a.client.id, { name: "Hackeado da Silva" })).rejects.toThrow(/não encontrado/);
    // empresa A não pode usar a conta financeira da empresa B
    await expect(settleEntry(a.admin, "receivable", recA.id, { date: "2026-11-10", amountCents: 1000, accountId: b.account.id })).rejects.toThrow(/Conta financeira inválida/);
  });

  it("empresa B não cria venda com cliente ou fornecedor da empresa A", async () => {
    await expect(createSale(b.admin, exampleSale(a.client.id, b.supplier.id))).rejects.toThrow(/Cliente não encontrado/);
    await expect(createSale(b.admin, exampleSale(b.client.id, a.supplier.id))).rejects.toThrow(/Fornecedor inválido/);
  });

  it("numeração de vendas é independente por empresa", async () => {
    const s = await createSale(b.seller, exampleSale(b.client.id, b.supplier.id));
    expect(s.code).toBe("V-2026-0001");
  });
});

describe("financeiro operacional", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  beforeAll(async () => {
    env = await makeCompany("Financeiro");
  });

  it("despesa recorrente gera N meses; cancelamento bloqueado se houver baixa", async () => {
    const ids = await createManualPayable(env.fin, { description: "Aluguel", category: "ALUGUEL", amountCents: 250000, firstDueDate: "2026-11-10", recurringMonths: 3 });
    expect(ids).toHaveLength(3);
    const pays = await prisma.payable.findMany({ where: { id: { in: ids } }, orderBy: { dueDate: "asc" } });
    expect(pays.map((p) => p.dueDate)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
    expect(pays.every((p) => p.amountCents === 250000)).toBe(true);
    await settleEntry(env.fin, "payable", ids[0], { date: "2026-11-10", amountCents: 250000, accountId: env.account.id });
    await expect(cancelEntry(env.fin, "payable", ids[0])).rejects.toThrow(/Estorne/);
    await cancelEntry(env.fin, "payable", ids[1]);
    expect((await prisma.payable.findUniqueOrThrow({ where: { id: ids[1] } })).status).toBe("CANCELADO");
  });

  it("parcelamento divide o valor e baixa com juros/desconto", async () => {
    const ids = await createManualPayable(env.fin, { description: "Notebook", category: "ADMINISTRATIVAS", amountCents: 100000, firstDueDate: "2026-11-20", installments: 3 });
    const pays = await prisma.payable.findMany({ where: { id: { in: ids } } });
    expect(pays.reduce((s, p) => s + p.amountCents, 0)).toBe(100000);
    const p = pays.find((x) => x.installmentNumber === 2)!;
    // pagou 33.333 + 1,00 de juros
    const r = await settleEntry(env.fin, "payable", p.id, { date: "2026-12-21", amountCents: p.amountCents + 100, interestCents: 100, accountId: env.account.id });
    expect(r.status).toBe("PAGO");
    const after = await prisma.payable.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.paidCents).toBe(p.amountCents + 100);
    expect(after.settledCents).toBe(p.amountCents);
  });

  it("transferência entre contas não altera o caixa consolidado", async () => {
    const before = await cashflow(env.fin, { from: "2026-11-01", to: "2026-11-30", granularity: "dia" });
    await createTransfer(env.fin, { fromAccountId: env.account.id, toAccountId: env.account2.id, amountCents: 30000, date: "2026-11-15" });
    const after = await cashflow(env.fin, { from: "2026-11-01", to: "2026-11-30", granularity: "dia" });
    expect(after.realizedBalance).toBe(before.realizedBalance);
    expect(after.totals.realizedIn).toBe(before.totals.realizedIn);
    const byAccount = await cashflow(env.fin, { from: "2026-11-01", to: "2026-11-30", granularity: "mes", accountId: env.account2.id });
    expect(byAccount.totals.realizedIn).toBe(30000);
    const accounts = await listAccounts(env.fin);
    expect(accounts.find((x) => x.id === env.account2.id)!.balanceCents).toBe(30000);
    await expect(createTransfer(env.fin, { fromAccountId: env.account.id, toAccountId: env.account.id, amountCents: 1, date: "2026-11-15" })).rejects.toThrow();
  });

  it("conciliação: importa CSV, ignora duplicados e concilia com a baixa", async () => {
    const ids = await createManualPayable(env.fin, { description: "Internet", category: "SISTEMAS", amountCents: 12990, firstDueDate: "2026-11-05" });
    const { settlementId } = await settleEntry(env.fin, "payable", ids[0], { date: "2026-11-05", amountCents: 12990, accountId: env.account.id });
    const csv = "data;descricao;valor\n05/11/2026;DEBITO INTERNET;-129,90\n06/11/2026;PIX RECEBIDO;500,00\n";
    const first = await importStatement(env.fin, env.account.id, csv);
    expect(first).toMatchObject({ imported: 2, duplicates: 0 });
    const second = await importStatement(env.fin, env.account.id, csv);
    expect(second).toMatchObject({ imported: 0, duplicates: 2 });
    const { lines, suggestions } = await listStatementLines(env.fin, env.account.id);
    const debit = lines.find((l) => l.amountCents === -12990)!;
    expect(suggestions[debit.id].map((s) => s.id)).toContain(settlementId);
    await matchStatementLine(env.fin, debit.id, settlementId);
    await expect(matchStatementLine(env.fin, lines.find((l) => l.amountCents === 50000)!.id, settlementId)).rejects.toThrow();
    // estorno da baixa desfaz a conciliação
    await reverseSettlement(env.fin, settlementId, "lançado errado");
    expect((await prisma.bankStatementLine.findUniqueOrThrow({ where: { id: debit.id } })).status).toBe("PENDENTE");
  });

  it("automações agendadas são idempotentes", async () => {
    await prisma.automationSetting.create({ data: { companyId: env.company.id, key: "viagem_proxima.evento", enabled: true } });
    await createSale(env.seller, exampleSale(env.client.id, env.supplier.id, { tripStart: "2026-11-06", tripEnd: "2026-11-10" }));
    const r1 = await runScheduledAutomations(env.company.id, "2026-11-04");
    const r2 = await runScheduledAutomations(env.company.id, "2026-11-04");
    expect(r1.viagemProxima).toBe(1);
    expect(r2.viagemProxima).toBe(0);
    expect(await prisma.automationEvent.count({ where: { companyId: env.company.id, type: "viagem.proxima" } })).toBe(1);
  });
});
