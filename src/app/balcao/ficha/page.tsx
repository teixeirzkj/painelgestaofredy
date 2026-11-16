import Link from "next/link";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { searchSalesForSheet } from "@/server/services/passenger-sheet";
import { SaleStatusBadge } from "@/components/status";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { balcaoContext } from "../shared";
import { BalcaoHeader } from "../header";

export const metadata = { title: "Ficha dos passageiros" };

const safeBack = (v?: string | null) => (v && v.startsWith("/balcao") && !v.startsWith("//") ? v : "/balcao");

/** Ficha dos passageiros: escolher a venda (pelo cliente, passageiro, CPF ou código). */
export default async function FichaBuscaPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = str(sp, "q") ?? "";
  const back = safeBack(str(sp, "voltar"));
  const ctx = await balcaoContext(`/balcao/ficha${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const sales = await searchSalesForSheet(ctx, q);
  return (
    <>
      <BalcaoHeader ctx={ctx} view={0} done={[]} sheetHref={null} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Voltar ao atendimento
        </Link>
        <section className="rounded-[14px] border border-line bg-white p-5 shadow-[var(--shadow-card)]">
          <h1 className="font-display text-lg font-semibold text-ink">Ficha dos passageiros</h1>
          <p className="mb-4 text-sm text-slate-600">Busque a venda e veja os dados de todos os passageiros de uma vez, prontos para copiar no sistema da companhia ou da operadora.</p>
          <form className="flex gap-2" action="/balcao/ficha">
            <input type="hidden" name="voltar" value={back} />
            <label className="relative flex-1">
              <span className="sr-only">Buscar</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                name="q"
                defaultValue={q}
                autoFocus
                placeholder="Nome do cliente ou passageiro, CPF ou código da venda"
                className="h-10 w-full rounded-lg border border-line pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
            </label>
            <button type="submit" className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
              Buscar
            </button>
          </form>
        </section>
        <section className="rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
          <p className="border-b border-line px-5 py-3 text-xs font-medium uppercase tracking-wide text-muted">{q ? `Resultado para "${q}"` : "Próximas viagens"}</p>
          {sales.length === 0 ? (
            <p className="p-5 text-sm text-muted">Nenhuma venda encontrada.</p>
          ) : (
            <ul className="divide-y divide-line">
              {sales.map((s) => (
                <li key={s.id}>
                  <Link href={`/balcao/ficha/${s.id}?voltar=${encodeURIComponent(back)}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{s.client.name}</p>
                      <p className="text-xs text-muted">
                        {s.code} · {s.destination ?? "destino não informado"}
                        {s.tripStart ? ` · embarque ${formatDate(s.tripStart)}` : ""} · {s._count.passengers} de {s.passengerCount} passageiro(s)
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <SaleStatusBadge s={s.status} />
                      <ArrowRight className="h-4 w-4 text-muted" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
