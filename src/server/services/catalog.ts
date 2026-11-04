/** Cadastros auxiliares: centros de custo e regras de comissão/over por fornecedor e produto. */
import { prisma } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { commissionRuleSchema, costCenterSchema } from "./schemas";

export async function listCostCenters(ctx: Ctx) {
  return prisma.costCenter.findMany({ where: { companyId: ctx.companyId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
}

export async function saveCostCenter(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "finance.manage");
  const d = costCenterSchema.parse(raw);
  const dup = await prisma.costCenter.findFirst({ where: { companyId: ctx.companyId, name: d.name, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw new AppError("Já existe um centro de custo com esse nome.", "CONFLICT");
  return prisma.$transaction(async (tx) => {
    if (id) {
      const cc = await tx.costCenter.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!cc) throw new AppError("Centro de custo não encontrado.", "NOT_FOUND");
      await tx.costCenter.update({ where: { id }, data: d });
    } else {
      id = (await tx.costCenter.create({ data: { ...d, companyId: ctx.companyId } })).id;
    }
    await audit(tx, ctx, "centro_custo.salvo", "CostCenter", id, d);
    return id;
  });
}

export async function listCommissionRules(ctx: Ctx) {
  return prisma.commissionRule.findMany({
    where: { companyId: ctx.companyId },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

export async function saveCommissionRule(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "suppliers.manage");
  const d = commissionRuleSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    if (d.supplierId && !(await tx.supplier.findFirst({ where: { id: d.supplierId, companyId: ctx.companyId } }))) throw new AppError("Fornecedor inválido.");
    if (id) {
      const r = await tx.commissionRule.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!r) throw new AppError("Regra não encontrada.", "NOT_FOUND");
      await tx.commissionRule.update({ where: { id }, data: d });
    } else {
      id = (await tx.commissionRule.create({ data: { ...d, companyId: ctx.companyId } })).id;
    }
    await audit(tx, ctx, "regra_comissao.salva", "CommissionRule", id, d);
    return id;
  });
}

export async function deleteCommissionRule(ctx: Ctx, id: string) {
  assertCan(ctx, "suppliers.manage");
  const r = await prisma.commissionRule.findFirst({ where: { id, companyId: ctx.companyId } });
  if (!r) throw new AppError("Regra não encontrada.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.commissionRule.delete({ where: { id } });
    await audit(tx, ctx, "regra_comissao.excluida", "CommissionRule", id, r);
  });
}

export type RuleLite = { supplierId: string | null; productType: string | null; description: string | null; commissionBps: number; overBps: number };

/**
 * Escolhe a regra mais específica: fornecedor + produto > fornecedor > produto.
 * Usada no formulário de venda para sugerir comissão e over (o usuário pode ajustar).
 */
export function pickRule(rules: RuleLite[], supplierId: string | null | undefined, productType: string): RuleLite | null {
  return (
    rules.find((r) => r.supplierId && r.supplierId === supplierId && r.productType === productType) ??
    rules.find((r) => r.supplierId && r.supplierId === supplierId && !r.productType) ??
    rules.find((r) => !r.supplierId && r.productType === productType) ??
    null
  );
}

export async function activeRules(ctx: Ctx): Promise<RuleLite[]> {
  return prisma.commissionRule.findMany({
    where: { companyId: ctx.companyId, active: true },
    select: { supplierId: true, productType: true, description: true, commissionBps: true, overBps: true },
    orderBy: { createdAt: "asc" },
  });
}
