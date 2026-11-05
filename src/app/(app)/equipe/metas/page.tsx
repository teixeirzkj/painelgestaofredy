import { Target } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { workMonth } from "@/server/month";
import { getGoals } from "@/server/services/team";
import { Card, PageHeader, ProgressBar } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { GOAL_METRICS } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { GoalsClient } from "./goals-client";

export const metadata = { title: "Metas" };

export default async function GoalsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const g = await getGoals(ctx, wm.month);
  const canEdit = can(ctx, "users.manage");
  const monthName = wm.label.split(" de ")[0];
  const store = g.store;
  const pct = store ? Math.round((store.realized / Math.max(store.amountCents, 1)) * 100) : null;
  const withoutGoal = g.sellers.filter((s) => !s.goal).length;

  return (
    <>
      <PageHeader title="Metas" description={<span>{ctx.companyName.replace(/\s*\(DEMONSTRAÇÃO\)\s*/i, "")} · {wm.label}</span>} />
      <Card className="mb-6 p-6">
        <div className="flex flex-wrap items-center gap-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Target className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            {store ? (
              <>
                <h2 className="text-lg font-semibold text-ink">
                  Meta de {monthName}: {formatBRL(store.amountCents)}
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  Medida: {GOAL_METRICS.label(store.metric).toLowerCase()} · super meta {formatBRL(store.superAmountCents)}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <ProgressBar value={store.realized} max={store.amountCents} tone={store.realized >= store.amountCents ? "green" : "blue"} className="h-2" />
                  <span className="text-sm font-semibold tabular">{pct}%</span>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-ink">Nenhuma meta para {monthName}</h2>
                <p className="mt-0.5 max-w-xl text-sm text-muted">A loja ainda não tem meta. Defina quanto precisa vender no mês e, depois, divida por vendedor e por fornecedor.</p>
              </>
            )}
          </div>
          <div className="border-l border-line pl-6 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Realizado · {store ? GOAL_METRICS.label(store.metric).toLowerCase() : "faturamento"} até agora</p>
            <p className="mt-1 font-display text-2xl font-bold tabular text-ink">{formatBRL(store ? store.realized : g.realizedGross)}</p>
          </div>
        </div>
      </Card>
      <GoalsClient
        month={wm.month}
        monthName={monthName}
        canEdit={canEdit}
        initialTab={str(sp, "aba") === "vendedores" ? "vendedores" : "loja"}
        store={store ? { amountCents: store.amountCents, superAmountCents: store.superAmountCents, metric: store.metric } : null}
        sellers={g.sellers.map((s) => ({ id: s.id, name: s.name, goalCents: s.goal?.amountCents ?? 0, metric: s.goal?.metric ?? "FATURAMENTO", realized: s.realized, count: s.count }))}
        suppliers={g.suppliers.map((s) => ({ id: s.goal.targetId, name: s.name, goalCents: s.goal.amountCents, realized: s.realized }))}
        supplierOptions={g.supplierOptions}
        withoutGoal={withoutGoal}
      />
    </>
  );
}
