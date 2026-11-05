/** Regras dos módulos de operação: taxas de cartão, conferência/solicitação de edição, créditos, metas, categorias, decêndios e suspensão de conta. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";
import { createSale, updateSale } from "@/server/services/sales";
import { createManualPayable } from "@/server/services/finance";
import { saveCardFee, saveExpenseCategory, ensureExpenseCategories } from "@/server/services/admin";
import { consumeCredit, createCredit, decendios, requestSaleEdit, reviewEditRequest, setSaleReviewed } from "@/server/services/ops";
import { getGoals, saveGoal } from "@/server/services/team";
import { computeDre } from "@/server/services/dre";
import { makeCompany, exampleSale } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

describe("taxa de cartão da maquininha", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeCompany("Cartão");
    await saveCardFee(env.admin, null, { modality: "CREDITO", installmentsFrom: 2, installmentsTo: 6, rateBps: 400, settlementDays: 30, active: true });
  });

  it("parcela no cartão vence na liquidação e gera a taxa como despesa (uma por parcela, sem duplicar)", async () => {
    const payments = [
      { key: "c1", dueDate: "2026-11-10", amountCents: 400000, method: "CARTAO_CREDITO" },
      { key: "c2", dueDate: "2026-12-10", amountCents: 400000, method: "CARTAO_CREDITO" },
    ];
    const s = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id, { payments }));
    const recs = await prisma.receivable.findMany({ where: { saleId: s.id, origin: "VENDA" }, orderBy: { dueDate: "asc" } });
    expect(recs.map((r) => r.dueDate)).toEqual(["2026-12-10", "2027-01-09"]);
    const fees = await prisma.payable.findMany({ where: { saleId: s.id, origin: "TAXA_CARTAO" } });
    expect(fees).toHaveLength(2);
    expect(fees.every((f) => f.amountCents === 16000 && f.category === "TAXA_CARTAO")).toBe(true);
    await updateSale(env.admin, s.id, exampleSale(env.client.id, env.supplier.id, { payments }));
    expect(await prisma.payable.count({ where: { saleId: s.id, origin: "TAXA_CARTAO", status: { not: "CANCELADO" } } })).toBe(2);
  });

  it("PIX não gera taxa", async () => {
    const s = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id));
    expect(await prisma.payable.count({ where: { saleId: s.id, origin: "TAXA_CARTAO" } })).toBe(0);
  });
});

describe("venda conferida e solicitação de edição", () => {
  let env: Env;
  let saleId: string;
  beforeAll(async () => {
    env = await makeCompany("Conferência");
    saleId = (await createSale(env.seller, exampleSale(env.client.id, env.supplier.id))).id;
  });

  it("depois de conferida, o vendedor só edita com solicitação aprovada (uso único)", async () => {
    await setSaleReviewed(env.fin, saleId, true);
    await expect(updateSale(env.seller, saleId, exampleSale(env.client.id, env.supplier.id, { destination: "Outro" }))).rejects.toThrow(/conferida/);
    await requestSaleEdit(env.seller, saleId, "Trocar o destino da viagem");
    await expect(requestSaleEdit(env.seller, saleId, "Outra solicitação qualquer")).rejects.toThrow(/em aberto/);
    const req = await prisma.editRequest.findFirstOrThrow({ where: { saleId } });
    await expect(reviewEditRequest(env.seller, req.id, true)).rejects.toThrow(/permissão/);
    await reviewEditRequest(env.fin, req.id, true);
    await updateSale(env.seller, saleId, exampleSale(env.client.id, env.supplier.id, { destination: "Outro" }));
    expect((await prisma.editRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("UTILIZADA");
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).reviewedAt).toBeNull();
  });

  it("o financeiro edita venda conferida diretamente", async () => {
    await setSaleReviewed(env.fin, saleId, true);
    await expect(updateSale(env.admin, saleId, exampleSale(env.client.id, env.supplier.id, { destination: "Mais um" }))).resolves.toBeTruthy();
  });
});

describe("créditos de clientes", () => {
  it("só pode ser usado em venda do mesmo cliente", async () => {
    const env = await makeCompany("Créditos");
    const other = await prisma.client.create({ data: { companyId: env.company.id, name: "Outro Cliente" } });
    const id = await createCredit(env.admin, { clientId: env.client.id, amountCents: 50000, reason: "Remarcação" });
    const otherSale = await createSale(env.admin, exampleSale(other.id, env.supplier.id));
    await expect(consumeCredit(env.admin, id, otherSale.id)).rejects.toThrow(/mesmo cliente/);
    const sale = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id));
    await consumeCredit(env.admin, id, sale.id);
    const c = await prisma.clientCredit.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ status: "CONSUMIDO", usedSaleId: sale.id });
    await expect(consumeCredit(env.admin, id, sale.id)).rejects.toThrow(/já utilizado/);
  });
});

describe("metas", () => {
  it("meta da loja com super meta sugerida em 150% e realizado do mês", async () => {
    const env = await makeCompany("Metas");
    await createSale(env.admin, exampleSale(env.client.id, env.supplier.id));
    await saveGoal(env.admin, { month: "2026-11", scope: "LOJA", amountCents: 1000000 });
    await saveGoal(env.admin, { month: "2026-11", scope: "LOJA", amountCents: 2000000 });
    const g = await getGoals(env.admin, "2026-11");
    expect(g.store?.amountCents).toBe(2000000);
    expect(g.store?.superAmountCents).toBe(3000000);
    expect(g.store?.realized).toBe(800000);
    await expect(saveGoal(env.seller, { month: "2026-11", scope: "LOJA", amountCents: 1 })).rejects.toThrow(/permissão/);
  });
});

describe("categorias de despesa editáveis e DRE", () => {
  it("categoria nova é aceita; categoria fora do DRE não entra no resultado; despesas agrupadas por grupo", async () => {
    const env = await makeCompany("Categorias");
    await ensureExpenseCategories(prisma, env.company.id);
    await saveExpenseCategory(env.admin, null, { name: "Coworking", group: "Ocupação", inDre: true });
    await saveExpenseCategory(env.admin, null, { name: "Adiantamento a sócio", group: "Outros", inDre: false });
    const cats = await prisma.expenseCategory.findMany({ where: { companyId: env.company.id, name: { in: ["Coworking", "Adiantamento a sócio"] } } });
    const code = (n: string) => cats.find((c) => c.name === n)!.code;
    await createManualPayable(env.fin, { description: "Coworking", category: code("Coworking"), amountCents: 50000, firstDueDate: "2026-11-10" });
    await createManualPayable(env.fin, { description: "Adiantamento", category: code("Adiantamento a sócio"), amountCents: 90000, firstDueDate: "2026-11-10" });
    await expect(createManualPayable(env.fin, { description: "Teste", category: "NAO_EXISTE", amountCents: 1, firstDueDate: "2026-11-10" })).rejects.toThrow(/Categoria/);
    const dre = await computeDre(env.company.id, { from: "2026-11-01", to: "2026-11-30" });
    expect(dre.lines.find((l) => l.key === "desp_Ocupação")?.amountCents).toBe(50000);
    expect(dre.lines.find((l) => l.key === "despesas")?.amountCents).toBe(50000);
  });
});

describe("decêndios", () => {
  it("períodos e vencimentos do mês", () => {
    expect(decendios("2026-11")).toEqual([
      { n: 1, from: "2026-11-01", to: "2026-11-10", closes: "2026-11-11", due: "2026-11-23" },
      { n: 2, from: "2026-11-11", to: "2026-11-20", closes: "2026-11-21", due: "2026-12-03" },
      { n: 3, from: "2026-11-21", to: "2026-11-30", closes: "2026-12-01", due: "2026-12-13" },
    ]);
  });
});

describe("conta da agência suspensa pela plataforma", () => {
  it("ninguém da agência obtém sessão enquanto estiver suspensa", async () => {
    const env = await makeCompany("Suspensa");
    expect(await loadContext(env.admin.userId)).not.toBeNull();
    await prisma.company.update({ where: { id: env.company.id }, data: { active: false } });
    expect(await loadContext(env.admin.userId)).toBeNull();
    await prisma.company.update({ where: { id: env.company.id }, data: { active: true } });
    expect(await loadContext(env.admin.userId)).not.toBeNull();
  });
});
