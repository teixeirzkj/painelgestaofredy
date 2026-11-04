"use server";
/**
 * Server actions: camada fina sobre os serviços. Toda ação:
 * 1) reautentica o usuário (sessão → banco), 2) delega ao serviço, que aplica
 * autorização por permissão e escopo da empresa, 3) converte erros em mensagens seguras.
 */
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { createSession, destroySession, requireContext } from "@/server/auth";
import { toResult, AppError, type ActionResult } from "@/server/errors";
import * as sales from "@/server/services/sales";
import * as finance from "@/server/services/finance";
import * as registry from "@/server/services/registry";
import * as contracts from "@/server/services/contracts";
import * as automations from "@/server/services/automations";
import * as reconciliation from "@/server/services/reconciliation";
import * as settings from "@/server/services/settings";
import { assertCan } from "@/server/context";

function act<T>(fn: (ctx: Awaited<ReturnType<typeof requireContext>>) => Promise<T>, message?: string): Promise<ActionResult<T>> {
  return toResult(async () => {
    const ctx = await requireContext();
    const r = await fn(ctx);
    revalidatePath("/", "layout");
    return r;
  }, message);
}

// ------------------------------ Autenticação ------------------------------
const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const a = attempts.get(email);
  if (a && a.until > Date.now()) return { error: "Muitas tentativas. Aguarde alguns minutos." };
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(email, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return { error: "E-mail ou senha inválidos." };
  }
  attempts.delete(email);
  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

// ------------------------------ Vendas ------------------------------
export const createSaleAction = async (input: unknown) => act((ctx) => sales.createSale(ctx, input), "Venda registrada.");
export const updateSaleAction = async (id: string, input: unknown) => act((ctx) => sales.updateSale(ctx, id, input), "Venda atualizada.");
export const cancelSaleAction = async (id: string, reason: string) => act((ctx) => sales.cancelSale(ctx, id, reason), "Venda cancelada.");
export const duplicateSaleAction = async (id: string) => act((ctx) => sales.duplicateSale(ctx, id), "Venda duplicada como rascunho.");
export const updateReservationAction = async (id: string, data: { status: string; locator: string | null; notes: string | null }) =>
  act(async (ctx) => {
    const r = await prisma.reservation.findFirst({ where: { id, companyId: ctx.companyId, sale: sales.saleScope(ctx) } });
    if (!r) throw new AppError("Reserva não encontrada.");
    if (!["PENDENTE", "CONFIRMADA", "CANCELADA"].includes(data.status)) throw new AppError("Status inválido.");
    await prisma.reservation.update({ where: { id }, data: { status: data.status, locator: data.locator?.slice(0, 60) || null, notes: data.notes?.slice(0, 1000) || null } });
  }, "Reserva atualizada.");

// ------------------------------ Clientes e fornecedores ------------------------------
export const searchClientsAction = async (q: string) => act((ctx) => registry.searchClients(ctx, q));
export const saveClientAction = async (id: string | null, input: unknown) => act((ctx) => registry.saveClient(ctx, id, input), "Cliente salvo.");
export const archiveClientAction = async (id: string, archived: boolean) => act((ctx) => registry.archiveClient(ctx, id, archived), archived ? "Cliente arquivado." : "Cliente reativado.");
export const saveSupplierAction = async (id: string | null, input: unknown) => act((ctx) => registry.saveSupplier(ctx, id, input), "Fornecedor salvo.");
export const archiveSupplierAction = async (id: string) => act((ctx) => registry.archiveSupplier(ctx, id), "Fornecedor arquivado.");

// ------------------------------ Financeiro ------------------------------
type Kind = "receivable" | "payable";
export const getEntryAction = async (kind: Kind, id: string) => act((ctx) => finance.getEntry(ctx, kind, id));
export const createReceivableAction = async (input: unknown) => act((ctx) => finance.createManualReceivable(ctx, input), "Conta a receber criada.");
export const createPayableAction = async (input: unknown) => act((ctx) => finance.createManualPayable(ctx, input), "Conta a pagar criada.");
export const updateEntryAction = async (kind: Kind, id: string, input: unknown) => act((ctx) => finance.updateEntry(ctx, kind, id, input), "Lançamento atualizado.");
export const cancelEntryAction = async (kind: Kind, id: string) => act((ctx) => finance.cancelEntry(ctx, kind, id), "Lançamento cancelado.");
export const settleEntryAction = async (kind: Kind, id: string, input: unknown) => act((ctx) => finance.settleEntry(ctx, kind, id, input), "Baixa registrada.");
export const reverseSettlementAction = async (id: string, reason: string) => act((ctx) => finance.reverseSettlement(ctx, id, reason), "Baixa estornada.");
export const saveAccountAction = async (id: string | null, input: unknown) => act((ctx) => finance.saveAccount(ctx, id, input), "Conta salva.");
export const setAccountActiveAction = async (id: string, active: boolean) => act((ctx) => finance.setAccountActive(ctx, id, active), "Conta atualizada.");
export const createTransferAction = async (input: unknown) => act((ctx) => finance.createTransfer(ctx, input), "Transferência registrada.");
export const reverseTransferAction = async (id: string) => act((ctx) => finance.reverseTransfer(ctx, id), "Transferência estornada.");
export const importStatementAction = async (accountId: string, csv: string) => act((ctx) => reconciliation.importStatement(ctx, accountId, csv));
export const matchStatementAction = async (lineId: string, settlementId: string) => act((ctx) => reconciliation.matchStatementLine(ctx, lineId, settlementId), "Lançamento conciliado.");
export const setStatementStatusAction = async (lineId: string, status: "IGNORADO" | "PENDENTE") => act((ctx) => reconciliation.setStatementLineStatus(ctx, lineId, status));

// ------------------------------ Contratos ------------------------------
export const refreshContractAction = async (id: string) => act((ctx) => contracts.refreshContract(ctx, id), "Prévia atualizada com os dados da venda.");
export const issueContractAction = async (id: string) => act((ctx) => contracts.issueContract(ctx, id), "Contrato emitido.");
export const cancelContractAction = async (id: string) => act((ctx) => contracts.cancelContract(ctx, id), "Contrato cancelado.");
export const reopenContractAction = async (id: string) => act((ctx) => contracts.reopenContract(ctx, id), "Contrato reaberto para nova versão.");
export const saveTemplateAction = async (id: string | null, input: unknown) => act((ctx) => contracts.saveTemplate(ctx, id, input), "Modelo salvo.");
export const prepareContractAction = async (saleId: string) =>
  act(async (ctx) => {
    assertCan(ctx, "contracts.manage");
    const sale = await prisma.sale.findFirst({ where: { id: saleId, ...sales.saleScope(ctx), status: { in: ["CONFIRMADA", "CONCLUIDA"] } } });
    if (!sale) throw new AppError("Venda não encontrada ou não confirmada.");
    await prisma.$transaction((tx) => contracts.prepareContractForSale(tx, ctx.companyId, saleId));
  }, "Contrato preparado.");

// ------------------------------ Automações ------------------------------
export const setAutomationAction = async (key: string, enabled: boolean) => act((ctx) => automations.setAutomationEnabled(ctx, key, enabled), enabled ? "Automação ativada." : "Automação desativada.");
export const runAutomationsAction = async () =>
  act(async (ctx) => {
    assertCan(ctx, "automations.manage");
    return automations.runScheduledAutomations(ctx.companyId);
  });

// ------------------------------ Configurações ------------------------------
export const updateCompanyAction = async (input: unknown) => act((ctx) => settings.updateCompany(ctx, input), "Configurações salvas.");
export const setRolePermissionAction = async (role: string, permission: string, allowed: boolean) => act((ctx) => settings.setRolePermission(ctx, role, permission, allowed), "Permissão atualizada.");
export const saveUserAction = async (id: string | null, input: unknown) => act((ctx) => settings.saveUser(ctx, id, input), "Usuário salvo.");
export const rotateApiKeyAction = async () => act((ctx) => settings.rotateApiKey(ctx));
