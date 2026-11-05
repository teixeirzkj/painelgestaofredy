import Link from "next/link";
import { Paperclip, Receipt, FileText, CircleCheck, Clock, ArrowDownToLine, ArrowUpFromLine, CalendarRange } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can, today } from "@/server/context";
import { workMonth } from "@/server/month";
import { listPayables, listReceivables, financeOptions } from "@/server/services/finance";
import { Badge, Card, EmptyState, KpiCard, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect, MoreFilters } from "@/components/filter-form";
import { EntryStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYABLE_CATEGORIES, PAYMENT_METHODS, RECEIVABLE_CATEGORIES } from "@/lib/constants";
import { int, str, withParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { EntryDrawerHost, NewEntryButton } from "./entry-drawer";

type SP = Record<string, string | string[] | undefined>;
const dateCls =
  "h-9 rounded-xl border border-line bg-white px-2 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100";

/**
 * Contas a receber / a pagar. Por padrão mostra o MÊS DE TRABALHO escolhido no cabeçalho
 * (vencimentos do mês); "Todos os meses", datas explícitas ou "Vencidos" ampliam o recorte.
 */
export async function EntriesView({ ctx, kind, sp }: { ctx: Ctx; kind: "receivable" | "payable"; sp: SP }) {
  const base = kind === "receivable" ? "/financeiro/receber" : "/financeiro/pagar";
  const wm = await workMonth(ctx.timezone);
  const explicit = str(sp, "de") ?? str(sp, "from") ?? str(sp, "ate") ?? str(sp, "to");
  const status = str(sp, "status");
  const allMonths = str(sp, "periodo") === "todos" || !!explicit || status === "VENCIDO";
  const f = {
    q: str(sp, "q"),
    status,
    from: explicit ? str(sp, "de") ?? str(sp, "from") : allMonths ? undefined : wm.from,
    to: explicit ? str(sp, "ate") ?? str(sp, "to") : allMonths ? undefined : wm.to,
    category: str(sp, "category") ?? str(sp, "categoria"),
    costCenterId: str(sp, "centro"),
    supplierId: str(sp, "fornecedor"),
    invoice: str(sp, "fatura") as "sem" | "com" | undefined,
    sort: str(sp, "ordem"),
    page: int(sp, "pagina"),
  };
  const [data, options] = await Promise.all([kind === "receivable" ? listReceivables(ctx, f) : listPayables(ctx, f), financeOptions(ctx)]);
  const cats = kind === "receivable" ? RECEIVABLE_CATEGORIES : { values: options.expenseCategories.map((c) => c.value), label: (v: string | null | undefined) => options.expenseCategories.find((c) => c.value === v)?.label ?? PAYABLE_CATEGORIES.label(v) };
  const canManage = can(ctx, "finance.manage");
  const isRec = kind === "receivable";
  const moved = "receivedCents" in data.totals ? data.totals.receivedCents : (data.totals as { paidCents: number }).paidCents;
  const open = f.status === "CANCELADO" ? 0 : data.totals.amountCents - data.totals.settledCents;
  const scope = allMonths ? (explicit ? `${formatDate(f.from)} a ${formatDate(f.to)}` : "todos os meses") : wm.label;
  const title = isRec ? "Contas a receber" : "Contas a pagar";

  return (
    <>
      <PageHeader
        title={title}
        description={
          isRec
            ? "Parcelas dos clientes, comissões e incentivos de fornecedores e lançamentos manuais. Entram no fluxo de caixa; a receita do DRE vem das vendas."
            : "Custos das vendas, comissões, despesas fixas e lançamentos manuais. Itens em fatura de fornecedor são pagos pela fatura."
        }
        actions={canManage && <NewEntryButton kind={kind} options={options} todayStr={today(ctx)} />}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label={isRec ? "Total a receber" : "Total a pagar"} value={formatBRL(data.totals.amountCents)} icon={FileText} tone="violet" hint={scope} />
        <KpiCard label={isRec ? "Recebido" : "Pago"} value={formatBRL(moved)} icon={CircleCheck} tone="green" />
        <KpiCard label={isRec ? "A receber (pendente)" : "A pagar (pendente)"} value={formatBRL(open)} icon={Clock} tone="amber" />
      </section>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="mr-auto flex items-center gap-2 text-[15px] font-semibold">
            {isRec ? <ArrowDownToLine className="h-4 w-4 text-success" /> : <ArrowUpFromLine className="h-4 w-4 text-danger" />}
            {title} — <span>{scope}</span>
          </h2>
          <Link
            href={allMonths ? withParams(base, sp, { periodo: undefined, de: undefined, ate: undefined, status: status === "VENCIDO" ? undefined : status, pagina: undefined }) : withParams(base, sp, { periodo: "todos", pagina: undefined })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-medium text-slate-700 hover:bg-brand-25"
          >
            <CalendarRange className="h-3.5 w-3.5" /> {allMonths ? "Só o mês selecionado" : "Todos os meses"}
          </Link>
        </div>
        <div className="border-b border-line px-5 py-3">
          <FilterForm>
            {allMonths && !explicit && <input type="hidden" name="periodo" value="todos" />}
            <FilterSearch value={f.q} placeholder={isRec ? "Buscar título, cliente ou venda" : "Buscar título, fornecedor ou venda"} />
            <FilterSelect name="fornecedor" label="Fornecedor" value={f.supplierId} options={options.suppliers.map((s) => ({ value: s.id, label: s.name }))} all="Todos" />
            <FilterSelect
              name="status"
              label="Status"
              value={f.status}
              options={[
                { value: "ABERTO", label: "Em aberto" },
                { value: "VENCIDO", label: "Vencidos (todos os meses)" },
                { value: "PENDENTE", label: "A vencer" },
                { value: "PARCIAL", label: "Parciais" },
                { value: "PAGO", label: isRec ? "Recebidos" : "Pagos" },
                { value: "CANCELADO", label: "Cancelados" },
              ]}
              all="Todos os status"
            />
            <MoreFilters active={[explicit, f.category, f.costCenterId, f.invoice, f.sort].filter(Boolean).length}>
              <FilterSelect name="category" label="Categoria" value={f.category} options={cats.values.map((v) => ({ value: v, label: cats.label(v) }))} all="Todas" />
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">Vencimento de</span>
                <input type="date" name="de" defaultValue={explicit ? f.from : undefined} className={dateCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">até</span>
                <input type="date" name="ate" defaultValue={explicit ? f.to : undefined} className={dateCls} />
              </label>
              {options.costCenters.length > 0 && <FilterSelect name="centro" label="Centro de custo" value={f.costCenterId} options={options.costCenters.map((c) => ({ value: c.id, label: c.name }))} />}
              {!isRec && (
                <FilterSelect
                  name="fatura"
                  label="Fatura de fornecedor"
                  value={f.invoice}
                  options={[
                    { value: "sem", label: "Fora de faturas" },
                    { value: "com", label: "Em faturas" },
                  ]}
                />
              )}
              <FilterSelect
                name="ordem"
                label="Ordenar"
                value={f.sort}
                all={null}
                options={[
                  { value: "venc_asc", label: "Vencimento (mais antigo)" },
                  { value: "venc_desc", label: "Vencimento (mais recente)" },
                  { value: "valor_desc", label: "Maior valor" },
                  { value: "valor_asc", label: "Menor valor" },
                ]}
              />
            </MoreFilters>
          </FilterForm>
        </div>
        {data.items.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={allMonths ? "Nenhum lançamento encontrado" : "Nenhuma conta neste mês"}
            description={isRec ? "Parcelas de vendas confirmadas aparecem aqui automaticamente. Registre também incentivos e outras entradas." : "Custos das vendas e comissões aparecem aqui automaticamente. Registre também as despesas da agência."}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Descrição</Th>
                <Th>{isRec ? "Cliente / venda" : "Fornecedor / venda"}</Th>
                <Th align="right">Valor</Th>
                <Th align="right">{isRec ? "Recebido" : "Pago"}</Th>
                <Th>Vencimento</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => {
                const party = ("client" in e && (e as { client: { name: string } | null }).client?.name) || e.supplier?.name;
                const href = withParams(base, sp, { abrir: e.id });
                const overdue = e.displayStatus === "VENCIDO";
                return (
                  <tr key={e.id}>
                    <Td className="max-w-80 py-3.5">
                      <Link href={href} scroll={false} className="block truncate font-medium text-brand-700 hover:underline">
                        {e.description}
                      </Link>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                        {cats.label(e.category)}
                        {e.method && ` · ${PAYMENT_METHODS.label(e.method)}`}
                        {e.costCenter && <Badge className="py-0 text-[10px]">{e.costCenter.name}</Badge>}
                        {"invoice" in e && (e as { invoice: { number: string } | null }).invoice && <Badge tone="blue" className="py-0 text-[10px]">fatura {(e as { invoice: { number: string } }).invoice.number}</Badge>}
                        {e._count.attachments > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Paperclip className="h-3 w-3" />
                            {e._count.attachments}
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td className="max-w-56">
                      <span className="block truncate text-slate-700">{party ?? "—"}</span>
                      {e.sale && (
                        <Link href={`/vendas/${e.sale.id}`} className="whitespace-nowrap text-xs text-brand-600 hover:underline">
                          {e.sale.code}
                        </Link>
                      )}
                    </Td>
                    <Td align="right" className={cn("font-semibold", isRec ? "text-success" : "text-ink")}>
                      {formatBRL(e.amountCents)}
                    </Td>
                    <Td align="right" className="text-slate-600">
                      {formatBRL("receivedCents" in e ? (e as { receivedCents: number }).receivedCents : (e as { paidCents: number }).paidCents)}
                    </Td>
                    <Td className={cn("whitespace-nowrap", overdue && "font-medium text-danger")}>{formatDate(e.dueDate)}</Td>
                    <Td>
                      <EntryStatusBadge kind={kind} s={e.displayStatus} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-brand-25 font-semibold">
                <Td>Total {data.pages > 1 ? `(${data.total} lançamentos)` : ""}</Td>
                <Td />
                <Td align="right" className={isRec ? "text-success" : "text-ink"}>
                  {formatBRL(data.totals.amountCents)}
                </Td>
                <Td align="right">{formatBRL(moved)}</Td>
                <Td colSpan={2} className="text-xs font-normal text-muted">
                  em aberto {formatBRL(open)}
                </Td>
              </tr>
            </tfoot>
          </Table>
        )}
        <Pagination page={data.page} pages={data.pages} total={data.total} hrefFor={(p) => withParams(base, sp, { pagina: p, abrir: undefined })} />
      </Card>
      <EntryDrawerHost kind={kind} openId={str(sp, "abrir")} accounts={options.accounts} canManage={canManage} todayStr={today(ctx)} costCenters={options.costCenters} expenseCategories={options.expenseCategories} />
    </>
  );
}
