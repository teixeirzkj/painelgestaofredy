import { ArrowDownToLine, ArrowUpFromLine, AlarmClock, Landmark } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { financeOverview } from "@/server/services/finance";
import { KpiCard, PageHeader } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { FinanceTabs } from "./tabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageContext("finance.view");
  const o = await financeOverview(ctx);
  return (
    <>
      <PageHeader title="Financeiro" description="Contas a receber e a pagar, faturas de fornecedores, fluxo de caixa, contas e conciliação." />
      <section aria-label="Posição financeira" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="A receber (em aberto)" value={formatBRL(o.receivableCents)} icon={ArrowDownToLine} tone="green" hint={`${o.receivableCount} lançamento(s)`} href="/financeiro/receber?status=ABERTO" />
        <KpiCard label="A pagar (em aberto)" value={formatBRL(o.payableCents)} icon={ArrowUpFromLine} tone="red" hint={`${formatBRL(o.payableWeekCents)} nos próximos 7 dias`} href="/financeiro/pagar?status=ABERTO" />
        <KpiCard
          label="Vencidos"
          value={formatBRL(o.overdueReceivableCents + o.overduePayableCents)}
          icon={AlarmClock}
          tone={o.overdueReceivableCents + o.overduePayableCents > 0 ? "amber" : "slate"}
          hint={`receber ${formatBRL(o.overdueReceivableCents)} · pagar ${formatBRL(o.overduePayableCents)}`}
          href="/relatorios?r=contas-vencidas"
        />
        <KpiCard label="Saldo nas contas" value={formatBRL(o.balanceCents)} icon={Landmark} tone="blue" hint="realizado até hoje" href="/financeiro/contas" />
      </section>
      <FinanceTabs />
      {children}
    </>
  );
}
