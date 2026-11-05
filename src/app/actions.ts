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
import { headers } from "next/headers";
import { createSession, destroySession, getContext, requireContext } from "@/server/auth";
import * as admin from "@/server/services/admin";
import { platformLogin, createPlatformSession } from "@/server/platform";
import * as team from "@/server/services/team";
import * as ops from "@/server/services/ops";
import { toResult, AppError, type ActionResult } from "@/server/errors";
import * as sales from "@/server/services/sales";
import * as finance from "@/server/services/finance";
import * as registry from "@/server/services/registry";
import * as contracts from "@/server/services/contracts";
import * as automations from "@/server/services/automations";
import * as reconciliation from "@/server/services/reconciliation";
import * as settings from "@/server/services/settings";
import * as search from "@/server/services/search";
import * as trips from "@/server/services/trips";
import * as excursions from "@/server/services/excursions";
import * as invoices from "@/server/services/invoices";
import * as catalog from "@/server/services/catalog";
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
  const user = await prisma.user.findUnique({ where: { email }, include: { company: { select: { active: true } } } });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  const hdr = await headers();
  const meta = { ip: hdr.get("x-forwarded-for")?.split(",")[0] ?? null, userAgent: hdr.get("user-agent") };
  if (ok && !user.company.active) {
    await admin.logAccess({ companyId: user.companyId, userId: user.id, email, type: "FALHA", ...meta });
    return { error: "A conta desta agência está suspensa. Fale com o suporte Frédy." };
  }
  if (!ok && !user) {
    // Login da equipe da plataforma digitado na tela das agências: leva direto ao painel da plataforma.
    const pu = await platformLogin(email, password);
    if (pu) {
      attempts.delete(email);
      await createPlatformSession(pu.id);
      redirect("/plataforma");
    }
  }
  if (!ok) {
    await admin.logAccess({ companyId: user?.companyId ?? null, userId: user?.id ?? null, email, type: "FALHA", ...meta });
    const n = (a?.n ?? 0) + 1;
    attempts.set(email, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return { error: "E-mail ou senha inválidos." };
  }
  attempts.delete(email);
  await createSession(user.id);
  await admin.logAccess({ companyId: user.companyId, userId: user.id, email, type: "LOGIN", ...meta });
  redirect("/");
}

export async function logoutAction() {
  const ctx = await getContext();
  if (ctx) {
    const hdr = await headers();
    await admin.logAccess({ companyId: ctx.companyId, userId: ctx.userId, email: ctx.userName, type: "LOGOUT", ip: hdr.get("x-forwarded-for")?.split(",")[0] ?? null, userAgent: hdr.get("user-agent") });
  }
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

// ------------------------------ Busca global ------------------------------
export const globalSearchAction = async (q: string) => toResult(async () => search.globalSearch(await requireContext(), q));

// ------------------------------ Vendas: ajustes, viagens e excursões ------------------------------
export const registerRefundAction = async (saleId: string, input: unknown) => act((ctx) => sales.registerRefund(ctx, saleId, input), "Lançamento registrado no financeiro.");
export const tripOptionsAction = async (clientId: string) => toResult(async () => trips.tripOptionsForClient(await requireContext(), clientId));
export const createTripAction = async (input: unknown) => act((ctx) => trips.createTrip(ctx, input), "Viagem criada.");
export const updateTripAction = async (id: string, input: unknown) => act((ctx) => trips.updateTrip(ctx, id, input), "Viagem atualizada.");
export const setTripCancelledAction = async (id: string, cancelled: boolean) => act((ctx) => trips.setTripCancelled(ctx, id, cancelled), cancelled ? "Viagem cancelada." : "Viagem reativada.");
export const linkSaleToTripAction = async (tripId: string | null, saleId: string) => act((ctx) => trips.linkSaleToTrip(ctx, tripId, saleId), tripId ? "Venda vinculada à viagem." : "Venda desvinculada da viagem.");
export const saveExcursionAction = async (id: string | null, input: unknown) => act((ctx) => excursions.saveExcursion(ctx, id, input), "Excursão salva.");
export const addExcursionCostAction = async (id: string, input: unknown) => act((ctx) => excursions.addExcursionCost(ctx, id, input), "Custo lançado em contas a pagar.");
export const updatePassengerRoomAction = async (passengerId: string, input: unknown) => act((ctx) => excursions.updatePassengerRoom(ctx, passengerId, input), "Passageiro atualizado.");

// ------------------------------ Faturas de fornecedor ------------------------------
export const createInvoiceAction = async (input: unknown) => act((ctx) => invoices.createInvoice(ctx, input), "Fatura registrada.");
export const addInvoiceItemsAction = async (id: string, payableIds: string[]) => act((ctx) => invoices.addPayablesToInvoice(ctx, id, payableIds), "Lançamentos vinculados à fatura.");
export const removeInvoiceItemAction = async (id: string, payableId: string) => act((ctx) => invoices.removePayableFromInvoice(ctx, id, payableId), "Lançamento removido da fatura.");
export const registerInvoiceDifferenceAction = async (id: string, reason: string) => act((ctx) => invoices.registerInvoiceDifference(ctx, id, reason), "Diferença registrada na fatura.");
export const checkInvoiceAction = async (id: string) => act((ctx) => invoices.checkInvoice(ctx, id), "Fatura conferida.");
export const reopenInvoiceAction = async (id: string) => act((ctx) => invoices.reopenInvoice(ctx, id), "Fatura reaberta para conferência.");
export const payInvoiceAction = async (id: string, input: unknown) => act((ctx) => invoices.payInvoice(ctx, id, input), "Pagamento da fatura registrado.");
export const cancelInvoiceAction = async (id: string) => act((ctx) => invoices.cancelInvoice(ctx, id), "Fatura cancelada.");

// ------------------------------ Cadastros auxiliares ------------------------------
export const saveCostCenterAction = async (id: string | null, input: unknown) => act((ctx) => catalog.saveCostCenter(ctx, id, input), "Centro de custo salvo.");
export const saveCommissionRuleAction = async (id: string | null, input: unknown) => act((ctx) => catalog.saveCommissionRule(ctx, id, input), "Regra salva.");
export const deleteCommissionRuleAction = async (id: string) => act((ctx) => catalog.deleteCommissionRule(ctx, id), "Regra excluída.");

// ------------------------------ Equipe ------------------------------
export const saveGoalAction = async (input: unknown) => act((ctx) => team.saveGoal(ctx, input), "Meta salva.");
export const saveTaskAction = async (id: string | null, input: unknown) => act((ctx) => team.saveTask(ctx, id, input), "Tarefa salva.");
export const setTaskStatusAction = async (id: string, status: string) => act((ctx) => team.setTaskStatus(ctx, id, status));

// ------------------------------ Créditos, conferência e solicitações ------------------------------
export const createCreditAction = async (input: unknown) => act((ctx) => ops.createCredit(ctx, input), "Crédito lançado.");
export const consumeCreditAction = async (id: string, saleId: string) => act((ctx) => ops.consumeCredit(ctx, id, saleId), "Crédito utilizado na venda.");
export const cancelCreditAction = async (id: string) => act((ctx) => ops.cancelCredit(ctx, id), "Crédito cancelado.");
export const creditSalesOptionsAction = async (clientId: string) => toResult(async () => ops.creditSalesOptions(await requireContext(), clientId));
export const setSaleReviewedAction = async (saleId: string, reviewed: boolean) => act((ctx) => ops.setSaleReviewed(ctx, saleId, reviewed), reviewed ? "Venda conferida." : "Conferência desfeita.");
export const requestSaleEditAction = async (saleId: string, reason: string) => act((ctx) => ops.requestSaleEdit(ctx, saleId, reason), "Solicitação enviada ao financeiro.");
export const reviewEditRequestAction = async (id: string, approve: boolean, note?: string) => act((ctx) => ops.reviewEditRequest(ctx, id, approve, note), approve ? "Edição liberada." : "Solicitação rejeitada.");
export const createAgencyTransferAction = async (input: unknown) => act((ctx) => ops.createAgencyTransfer(ctx, input), "Repasse registrado no financeiro.");

// ------------------------------ Administração ------------------------------
export const saveExpenseCategoryAction = async (id: string | null, input: unknown) => act((ctx) => admin.saveExpenseCategory(ctx, id, input), "Categoria salva.");
export const saveCardFeeAction = async (id: string | null, input: unknown) => act((ctx) => admin.saveCardFee(ctx, id, input), "Taxa salva.");
export const updateCompanyProfileAction = async (input: unknown) => act((ctx) => admin.updateCompanyProfile(ctx, input), "Dados da agência salvos.");
export const updateMeAction = async (input: unknown) => act((ctx) => admin.updateMe(ctx, input), "Dados atualizados.");
export const changePasswordAction = async (input: unknown) => act((ctx) => admin.changePassword(ctx, input), "Senha alterada.");
