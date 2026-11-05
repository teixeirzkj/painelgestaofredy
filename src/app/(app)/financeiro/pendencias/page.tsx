import Link from "next/link";
import { ChevronDown, RefreshCw } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { today } from "@/server/context";
import { financialPendings } from "@/server/services/ops";
import { Card, PageHeader } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata = { title: "Pendências financeiras" };

export default async function PendingsPage() {
  const ctx = await requirePageContext("finance.view");
  const groups = await financialPendings(ctx);
  const total = groups.reduce((a, g) => a + g.count, 0);
  return (
    <>
      <PageHeader
        title="Pendências financeiras"
        description={`${total} item(ns) em aberto em ${formatDate(today(ctx))}.`}
        actions={
          <Link href="/financeiro/pendencias" className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-medium shadow-sm hover:bg-slate-50">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Link>
        }
      />
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((g) => (
          <a key={g.key} href={`#${g.key}`} className="flex items-center gap-3 rounded-[14px] border border-line bg-white p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold", g.count ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-400")}>{g.count}</span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{g.title}</span>
              <span className="block font-semibold tabular text-ink">{formatBRL(g.amountCents)}</span>
            </span>
          </a>
        ))}
      </section>
      <div className="space-y-3">
        {groups.map((g) => (
          <Card key={g.key} id={g.key} className="overflow-hidden">
            <details open={g.count > 0 && g.count <= 10} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold", g.count ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-400")}>{g.count}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{g.title}</span>
                  <span className="block text-xs text-muted">{g.description}</span>
                </span>
                {g.count > 0 && <span className="text-sm font-semibold tabular text-ink">{formatBRL(g.amountCents)}</span>}
                <ChevronDown className="h-4 w-4 text-subtle transition-transform group-open:rotate-180" />
              </summary>
              {g.items.length > 0 && (
                <ul className="divide-y divide-line border-t border-line">
                  {g.items.slice(0, 50).map((i) => (
                    <li key={i.id}>
                      <Link href={i.href} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
                        <span className="min-w-0 flex-1 truncate text-ink">{i.title}</span>
                        {i.date && <span className="text-xs text-muted">{formatDate(i.date)}</span>}
                        <span className="w-28 text-right font-medium tabular">{formatBRL(i.amountCents)}</span>
                      </Link>
                    </li>
                  ))}
                  {g.items.length > 50 && <li className="px-5 py-2 text-xs text-muted">e mais {g.items.length - 50}…</li>}
                </ul>
              )}
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
