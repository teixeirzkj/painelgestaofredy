import { requirePageContext } from "@/server/auth";
import { today } from "@/server/context";
import { cashflow, listAccounts, type CashflowGranularity } from "@/server/services/finance";
import { Card, CardHeader, Stat, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { formatBRL } from "@/lib/money";
import { addDays, addMonths, endOfMonth, formatDate, isIsoDate, monthLabel, startOfMonth } from "@/lib/dates";
import { PAYABLE_CATEGORIES, RECEIVABLE_CATEGORIES } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Fluxo de caixa" };

export default async function CashflowPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const t = today(ctx);
  const g = (["dia", "semana", "mes"].includes(str(sp, "visao") ?? "") ? str(sp, "visao") : "mes") as CashflowGranularity;
  const defaults = { dia: [t, addDays(t, 30)], semana: [startOfMonth(t), endOfMonth(addMonths(t, 2))], mes: [startOfMonth(addMonths(t, -2)), endOfMonth(addMonths(t, 9))] }[g];
  const from = isIsoDate(str(sp, "de")) ? str(sp, "de")! : defaults[0];
  const toRaw = isIsoDate(str(sp, "ate")) ? str(sp, "ate")! : defaults[1];
  const to = toRaw < from ? from : toRaw;
  const accountId = str(sp, "conta");
  const category = str(sp, "categoria");
  const [data, accounts] = await Promise.all([cashflow(ctx, { from, to, granularity: g, accountId, category }), listAccounts(ctx, { includeInactive: true })]);
  const label = (k: string) => (g === "mes" ? monthLabel(k.slice(0, 7)) : g === "semana" ? `Semana de ${formatDate(k)}` : formatDate(k));

  return (
    <>
      <Card className="mb-4 p-3">
        <FilterForm>
          <FilterSelect name="visao" label="Visão" value={g} all={null} options={[{ value: "dia", label: "Diária" }, { value: "semana", label: "Semanal" }, { value: "mes", label: "Mensal" }]} />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted">De</span>
            <input type="date" name="de" defaultValue={from} className="h-9 rounded-lg border border-line px-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted">Até</span>
            <input type="date" name="ate" defaultValue={to} className="h-9 rounded-lg border border-line px-2 text-sm" />
          </label>
          <FilterSelect name="conta" label="Conta financeira" value={accountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} all="Todas (consolidado)" />
          <FilterSelect
            name="categoria"
            label="Categoria"
            value={category}
            all="Todas"
            options={[
              ...RECEIVABLE_CATEGORIES.values.map((v) => ({ value: v, label: `Entrada · ${RECEIVABLE_CATEGORIES.label(v)}` })),
              ...PAYABLE_CATEGORIES.values.map((v) => ({ value: v, label: `Saída · ${PAYABLE_CATEGORIES.label(v)}` })),
            ]}
          />
        </FilterForm>
      </Card>

      <Card className="mb-4 grid grid-cols-2 gap-5 p-5 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Saldo inicial" value={formatBRL(data.openingBalance)} hint={category ? "não aplicável com filtro de categoria" : `em ${formatDate(addDays(from, -1))}`} />
        <Stat label="Entradas realizadas" value={formatBRL(data.totals.realizedIn)} tone="success" />
        <Stat label="Saídas realizadas" value={formatBRL(data.totals.realizedOut)} tone="danger" />
        <Stat label="Entradas previstas" value={formatBRL(data.totals.plannedIn)} hint="saldo em aberto" />
        <Stat label="Saídas previstas" value={formatBRL(data.totals.plannedOut)} hint="saldo em aberto" />
        <Stat label="Saldo projetado" value={formatBRL(data.projectedBalance)} hint={`realizado: ${formatBRL(data.realizedBalance)}`} tone={data.projectedBalance < 0 ? "danger" : undefined} />
      </Card>

      <Card>
        <CardHeader
          title="Fluxo por período"
          description={
            data.byAccount
              ? "Movimentação da conta selecionada (inclui transferências). Previsões não são atribuídas a contas."
              : "Realizado = baixas efetivas. Previsto = saldo ainda em aberto pelo vencimento (atrasados aparecem no período atual)."
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Período</Th>
              <Th align="right">Entradas previstas</Th>
              <Th align="right">Saídas previstas</Th>
              <Th align="right">Entradas realizadas</Th>
              <Th align="right">Saídas realizadas</Th>
              <Th align="right">Saldo realizado</Th>
              <Th align="right">Saldo projetado</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const current = r.start <= t && (g === "dia" ? r.start === t : g === "semana" ? addDays(r.start, 6) >= t : r.start.slice(0, 7) === t.slice(0, 7));
              return (
                <tr key={r.key} className={cn(current && "bg-brand-50/50")}>
                  <Td className="whitespace-nowrap font-medium">
                    {label(r.start)} {current && <span className="ml-1 text-xs font-normal text-brand-600">(atual)</span>}
                  </Td>
                  <Td align="right" className="text-slate-500">{r.plannedIn ? formatBRL(r.plannedIn) : "—"}</Td>
                  <Td align="right" className="text-slate-500">{r.plannedOut ? formatBRL(r.plannedOut) : "—"}</Td>
                  <Td align="right" className="text-success">{r.realizedIn ? formatBRL(r.realizedIn) : "—"}</Td>
                  <Td align="right" className="text-danger">{r.realizedOut ? formatBRL(r.realizedOut) : "—"}</Td>
                  <Td align="right" className={cn("font-medium", r.realizedBalance < 0 && "text-danger")}>{r.start <= t ? formatBRL(r.realizedBalance) : "—"}</Td>
                  <Td align="right" className={cn("font-semibold", r.projectedBalance < 0 && "text-danger")}>{formatBRL(r.projectedBalance)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
