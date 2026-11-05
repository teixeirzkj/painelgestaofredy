import Link from "next/link";
import { Paperclip, Receipt } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can, today } from "@/server/context";
import { listPayables, listReceivables, financeOptions } from "@/server/services/finance";
import { Badge, Card, EmptyState, Pagination, Stat, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect, MoreFilters } from "@/components/filter-form";
import { EntryStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYABLE_CATEGORIES, PAYMENT_METHODS, RECEIVABLE_CATEGORIES } from "@/lib/constants";
import { int, str, withParams } from "@/lib/params";
import { EntryDrawerHost, NewEntryButton } from "./entry-drawer";

type SP = Record<string, string | string[] | undefined>;
const dateCls = "h-9 rounded-lg border border-line bg-white px-2 text-sm shadow-[0_1px_1px_rgba(16,42,86,0.03)] hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100";

export async function EntriesView({ ctx, kind, sp }: { ctx: Ctx; kind: "receivable" | "payable"; sp: SP }) {
  const base = kind === "receivable" ? "/financeiro/receber" : "/financeiro/pagar";
  const f = { q: str(sp, "q"), status: str(sp, "status"), from: str(sp, "de") ?? str(sp, "from"), to: str(sp, "ate") ?? str(sp, "to"), category: str(sp, "category") ?? str(sp, "categoria"), costCenterId: str(sp, "centro"), invoice: str(sp, "fatura") as "sem" | "com" | undefined, sort: str(sp, "ordem"), page: int(sp, "pagina") };
  const [data, options] = await Promise.all([kind === "receivable" ? listReceivables(ctx, f) : listPayables(ctx, f), financeOptions(ctx)]);
  const cats = kind === "receivable" ? RECEIVABLE_CATEGORIES : PAYABLE_CATEGORIES;
  const canManage = can(ctx, "finance.manage");
  const moved = "receivedCents" in data.totals ? data.totals.receivedCents : (data.totals as { paidCents: number }).paidCents;
  const isRec = kind === "receivable";

  return (
    <>
      <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Valor dos lançamentos filtrados" value={formatBRL(data.totals.amountCents)} />
        <Stat label={isRec ? "Recebido" : "Pago"} value={formatBRL(moved)} tone="success" />
        <Stat label="Saldo em aberto" value={formatBRL(f.status === "CANCELADO" ? 0 : data.totals.amountCents - data.totals.settledCents)} />
        <div className="flex items-center justify-end">{canManage && <NewEntryButton kind={kind} options={options} todayStr={today(ctx)} />}</div>
      </Card>
      <Card>
        <div className="border-b border-line px-4 py-3">
          <FilterForm>
            <FilterSearch value={f.q} placeholder={isRec ? "Descrição, cliente ou venda" : "Descrição, fornecedor ou venda"} />
            <FilterSelect
              name="status"
              label="Situação"
              value={f.status}
              options={[
                { value: "ABERTO", label: "Em aberto" },
                { value: "VENCIDO", label: "Vencidos" },
                { value: "PENDENTE", label: "A vencer" },
                { value: "PARCIAL", label: "Parciais a vencer" },
                { value: "PAGO", label: isRec ? "Recebidos" : "Pagos" },
                { value: "CANCELADO", label: "Cancelados" },
              ]}
              all="Todos (exceto cancelados)"
            />
            <FilterSelect name="category" label="Categoria" value={f.category} options={cats.values.map((v) => ({ value: v, label: cats.label(v) }))} all="Todas" />
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
            <MoreFilters active={[f.from, f.to, f.costCenterId, f.invoice].filter(Boolean).length}>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">Vencimento de</span>
                <input type="date" name="de" defaultValue={f.from} className={dateCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted">até</span>
                <input type="date" name="ate" defaultValue={f.to} className={dateCls} />
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
            </MoreFilters>
          </FilterForm>
        </div>
        {data.items.length === 0 ? (
          <EmptyState icon={Receipt} title="Nenhum lançamento encontrado" description={isRec ? "Lançamentos de vendas confirmadas aparecem aqui automaticamente." : "Custos de vendas e comissões aparecem aqui automaticamente. Cadastre também despesas operacionais."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vencimento</Th>
                <Th>Descrição</Th>
                <Th>{isRec ? "Cliente / fornecedor" : "Fornecedor"}</Th>
                <Th>Venda</Th>
                <Th align="right">Valor</Th>
                <Th align="right">{isRec ? "Recebido" : "Pago"}</Th>
                <Th align="right">Saldo</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => {
                const party = ("client" in e && (e as { client: { name: string } | null }).client?.name) || e.supplier?.name;
                const href = withParams(base, sp, { abrir: e.id });
                return (
                  <tr key={e.id} className="cursor-pointer">
                    <Td className="whitespace-nowrap">
                      <Link href={href} scroll={false} className="block">
                        {formatDate(e.dueDate)}
                      </Link>
                    </Td>
                    <Td className="max-w-80">
                      <Link href={href} scroll={false} className="block truncate font-medium text-ink hover:text-brand-700">
                        {e.description}
                      </Link>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                        {cats.label(e.category)}
                        {e.costCenter && <Badge className="py-0 text-[10px]">{e.costCenter.name}</Badge>}
                        {"invoice" in e && (e as { invoice: { number: string } | null }).invoice && <Badge tone="blue" className="py-0 text-[10px]">fatura {(e as { invoice: { number: string } }).invoice.number}</Badge>}
                        {e.method && ` · ${PAYMENT_METHODS.label(e.method)}`}
                        {e._count.attachments > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Paperclip className="h-3 w-3" />
                            {e._count.attachments}
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td className="max-w-48 truncate text-slate-600">{party ?? "—"}</Td>
                    <Td className="whitespace-nowrap">
                      {e.sale ? (
                        <Link href={`/vendas/${e.sale.id}`} className="text-brand-700 hover:underline">
                          {e.sale.code}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td align="right">{formatBRL(e.amountCents)}</Td>
                    <Td align="right" className="text-slate-600">
                      {formatBRL("receivedCents" in e ? (e as { receivedCents: number }).receivedCents : (e as { paidCents: number }).paidCents)}
                    </Td>
                    <Td align="right" className="font-medium">
                      {formatBRL(e.balanceCents)}
                    </Td>
                    <Td>
                      <EntryStatusBadge kind={kind} s={e.displayStatus} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} pages={data.pages} total={data.total} hrefFor={(p) => withParams(base, sp, { pagina: p, abrir: undefined })} />
      </Card>
      <EntryDrawerHost kind={kind} openId={str(sp, "abrir")} accounts={options.accounts} canManage={canManage} todayStr={today(ctx)} costCenters={options.costCenters} />
    </>
  );
}
