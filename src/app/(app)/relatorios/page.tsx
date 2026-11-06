import { pagePeriod } from "@/server/month";
import Link from "next/link";
import { Download, BarChart3 } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { today } from "@/server/context";
import { availableReports, runReport, type ColType } from "@/server/services/reports";
import { Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSelect, PeriodSelect } from "@/components/filter-form";
import { formatBRL, formatPercentBps } from "@/lib/money";
import { formatDate, resolvePeriod } from "@/lib/dates";
import { str, withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Relatórios" };

function fmt(v: unknown, type: ColType) {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "money") return formatBRL(Number(v));
  if (type === "percent") return formatPercentBps(Number(v));
  if (type === "date") return formatDate(String(v));
  return String(v);
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const reports = availableReports(ctx);
  if (!reports.length)
    return (
      <>
        <PageHeader title="Relatórios" />
        <Card>
          <EmptyState icon={BarChart3} title="Sem relatórios disponíveis para o seu perfil" />
        </Card>
      </>
    );
  const key = reports.some((r) => r.key === str(sp, "r")) ? str(sp, "r")! : reports[0].key;
  const def = reports.find((r) => r.key === key)!;
  const period = await pagePeriod(ctx.timezone, str(sp, "periodo"), str(sp, "de"), str(sp, "ate"));
  const compare = str(sp, "comparar") === "1" && !!def.comparable;
  const result = await runReport(ctx, key, period, { compare });
  const csvHref = withParams(`/api/relatorios/${key}`, { periodo: period.preset, de: period.from, ate: period.to, comparar: compare ? "1" : undefined }, {});
  const groups = ["Comercial", "Financeiro", "Operação"] as const;

  return (
    <>
      <PageHeader title="Relatórios gerenciais" description="Vendas, rentabilidade, DRE, caixa, viagens e excursões, com as mesmas definições do restante do sistema. Todos exportam CSV." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <Card className="h-fit p-2">
          {groups.map((g) => {
            const items = reports.filter((r) => r.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="mb-2">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-subtle">{g}</p>
                {items.map((r) => (
                  <Link
                    key={r.key}
                    href={withParams("/relatorios", sp, { r: r.key, comparar: undefined })}
                    className={cn("block rounded-lg px-3 py-1.5 text-sm transition-colors", r.key === key ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-ink")}
                  >
                    {r.title}
                  </Link>
                ))}
              </div>
            );
          })}
        </Card>
        <Card className="min-w-0">
          <CardHeader
            title={def.title}
            description={`${def.description} Período: ${formatDate(period.from)} a ${formatDate(period.to)}.`}
            action={
              <a href={csvHref} className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-white px-3 text-xs font-medium shadow-sm hover:bg-slate-50">
                <Download className="h-4 w-4" /> Exportar CSV
              </a>
            }
          />
          <div className="border-b border-line p-3">
            <FilterForm>
              <input type="hidden" name="r" value={key} />
              <PeriodSelect preset={period.preset} from={period.from} to={period.to} />
              {def.comparable && <FilterSelect name="comparar" label="Comparação" value={compare ? "1" : ""} options={[{ value: "1", label: "Comparar com período anterior" }]} all="Sem comparação" />}
            </FilterForm>
          </div>
          {result.note && <p className="border-b border-line bg-slate-50 px-5 py-2 text-xs text-muted">{result.note}</p>}
          {result.rows.length === 0 ? (
            <EmptyState icon={BarChart3} title="Sem dados no período" description="Altere o período para visualizar resultados." />
          ) : (
            <Table>
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <Th key={c.key} align={c.type === "text" || c.type === "date" ? "left" : "right"}>
                      {c.label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className={cn(String(row[result.columns[0].key] ?? "").startsWith("(=)") && "bg-emerald-50/70 font-semibold text-emerald-900")}>
                    {result.columns.map((c) => (
                      <Td
                        key={c.key}
                        title={undefined}
                        align={c.type === "text" || c.type === "date" ? "left" : "right"}
                        className={cn(c.key === "line" && "whitespace-pre", (c.type !== "text" || c.key === "code") && "whitespace-nowrap", c.key === "amount" && Number(row[c.key]) < 0 && "text-danger", c.key === "delta" && Number(row[c.key]) < 0 && "text-danger", c.key === "delta" && Number(row[c.key]) > 0 && "text-success")}
                      >
                        {fmt(row[c.key], c.type)}
                      </Td>
                    ))}
                  </tr>
                ))}
                {result.totals && (
                  <tr className="bg-slate-50 font-semibold [&>td]:border-b-0">
                    {result.columns.map((c, i) => (
                      <Td key={c.key} align={c.type === "text" || c.type === "date" ? "left" : "right"}>
                        {i === 0 ? "Total" : c.key in result.totals! ? fmt(result.totals![c.key], c.type) : ""}
                      </Td>
                    ))}
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
