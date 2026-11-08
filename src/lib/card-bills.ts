/**
 * Faturas do cartão de crédito da agência: em qual fatura cai cada parcela de uma compra.
 * Funções puras (sem banco), usadas no servidor e na prévia das telas.
 * Datas são strings "AAAA-MM-DD" e meses "AAAA-MM" (sem Date local, para não sofrer com fuso).
 */
import { splitInstallments } from "./money";

export const CARD_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const BILL_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function ym(y: number, m0: number) {
  const d = new Date(Date.UTC(y, m0, 1));
  return { y: d.getUTCFullYear(), m0: d.getUTCMonth() };
}
function dayIn(y: number, m0: number, day: number) {
  const last = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
const monthKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;

/** "2026-11" -> "nov/2026" */
export function billMonthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${CARD_MONTHS[m - 1]}/${y}`;
}

/** Soma (ou subtrai) meses de um "AAAA-MM". */
export function addBillMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const r = ym(y, m - 1 + n);
  return monthKey(r.y, r.m0);
}

/** Mês da fatura ("AAAA-MM") de uma compra feita em `date`: depois do dia de fechamento, vai para o mês seguinte. */
export function billMonthOf(date: string, closingDay: number) {
  const [y, m, d] = date.split("-").map(Number);
  const r = ym(y, m - 1 + (d > closingDay ? 1 : 0));
  return monthKey(r.y, r.m0);
}

/**
 * Mês da fatura que vence no mês de `dueDate`. Se o vencimento é menor ou igual ao fechamento,
 * a fatura que vence neste mês fechou no mês anterior.
 */
export function billMonthForDueDate(dueDate: string, closingDay: number, dueDay: number) {
  const month = dueDate.slice(0, 7);
  return dueDay <= closingDay ? addBillMonths(month, -1) : month;
}

/** Faturas seguidas a partir de um mês: fechamento e vencimento de cada uma. */
export function cardBillScheduleFrom(firstMonth: string, closingDay: number, dueDay: number, count: number) {
  const [fy, fm] = firstMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const close = ym(fy, fm - 1 + i);
    const due = ym(close.y, close.m0 + (dueDay <= closingDay ? 1 : 0));
    return {
      month: monthKey(close.y, close.m0),
      label: `${CARD_MONTHS[close.m0]}/${close.y}`,
      closingDate: dayIn(close.y, close.m0, closingDay),
      dueDate: dayIn(due.y, due.m0, dueDay),
    };
  });
}

/**
 * 1ª fatura sugerida para uma compra antiga (parcela já em andamento), vista em `today`: a fatura
 * mais antiga que ainda não venceu. Depois do fechamento, a fatura que acabou de fechar continua
 * em aberto até o vencimento, e é nela que está a próxima parcela a pagar. Basta olhar um mês
 * para trás: dois meses atrás o vencimento já passou, qualquer que seja o arranjo dos dias.
 */
export function oldPurchaseFirstBillMonth(today: string, closingDay: number, dueDay: number | null | undefined) {
  const open = billMonthOf(today, closingDay);
  if (!dueDay) return open;
  const prev = addBillMonths(open, -1);
  const [bill] = cardBillScheduleFrom(prev, closingDay, dueDay, 1);
  return bill.dueDate >= today ? prev : open;
}

/**
 * Em qual fatura cai cada parcela de uma compra feita em `date`.
 * Compra depois do dia de fechamento vai para a fatura do mês seguinte. Se o vencimento é
 * menor ou igual ao fechamento, a fatura vence no mês seguinte ao fechamento.
 */
export function cardBillSchedule(date: string, closingDay: number, dueDay: number, installments: number) {
  return cardBillScheduleFrom(billMonthOf(date, closingDay), closingDay, dueDay, installments);
}

export type CardPlanItem = { n: number; of: number; cents: number; month: string; label: string; closingDate: string; dueDate: string };

/**
 * Parcelas que entram nas faturas. O total é dividido em `installments` parcelas (os centavos que
 * sobram vão na 1ª); só entram as parcelas de `startInstallment` em diante (compra antiga: as
 * anteriores já foram pagas antes do sistema). A 1ª parcela lançada cai em `firstMonth`.
 */
export function cardPlan(p: { amountCents: number; installments: number; startInstallment?: number; firstMonth: string; closingDay: number; dueDay: number }): CardPlanItem[] {
  const of = Math.max(1, p.installments);
  const start = Math.min(Math.max(1, p.startInstallment ?? 1), of);
  const parts = splitInstallments(p.amountCents, of);
  const schedule = cardBillScheduleFrom(p.firstMonth, p.closingDay, p.dueDay, of - start + 1);
  return schedule.map((b, i) => ({ n: start + i, of, cents: parts[start - 1 + i], ...b }));
}
