import Link from "next/link";
import { ArrowUpRight, ArrowDownLeft, TriangleAlert } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { workMonth } from "@/server/month";
import { financialCalendar } from "@/server/services/ops";
import { KpiCard, PageHeader } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { CalendarGrid } from "./calendar-grid";

export const metadata = { title: "Calendário financeiro" };

export default async function FinancialCalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const onlyPending = str(sp, "pendentes") === "1";
  const d = await financialCalendar(ctx, wm.month, onlyPending);
  return (
    <>
      <PageHeader title="Calendário financeiro" description="Contas a pagar e a receber na data do pagamento/recebimento (ou do vencimento, se pendentes) e feriados nacionais." />
      <div className="mb-5 flex gap-2">
        <Link href="/financeiro/calendario" className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", !onlyPending ? "bg-brand-600 text-white" : "border border-line bg-white text-slate-700 hover:bg-brand-25")}>
          Tudo
        </Link>
        <Link href="/financeiro/calendario?pendentes=1" className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", onlyPending ? "bg-brand-600 text-white" : "border border-line bg-white text-slate-700 hover:bg-brand-25")}>
          Só pendentes
        </Link>
      </div>
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="A pagar no mês" value={formatBRL(d.stats.toPay)} icon={ArrowUpRight} tone="red" hint={`${formatBRL(d.stats.paid)} já pago`} />
        <KpiCard label="A receber no mês" value={formatBRL(d.stats.toReceive)} icon={ArrowDownLeft} tone="green" hint={`${formatBRL(d.stats.received)} já recebido`} />
        <KpiCard label="Atrasados" value={String(d.stats.overdue)} icon={TriangleAlert} tone={d.stats.overdue ? "amber" : "slate"} hint="pendentes já vencidos" />
      </section>
      <CalendarGrid month={wm.month} today={wm.today} events={d.events} holidays={d.holidays} />
    </>
  );
}
