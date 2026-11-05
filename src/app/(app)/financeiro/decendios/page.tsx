import Link from "next/link";
import { CalendarClock, FileStack, Building2, Info } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { workMonth } from "@/server/month";
import { decendialReconciliation } from "@/server/services/ops";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, ProgressBar, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { InvoiceStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Conciliação por decêndio" };

const STATE: Record<string, { label: string; tone: "blue" | "gray" | "amber" | "red" }> = {
  EM_ANDAMENTO: { label: "Em andamento", tone: "blue" },
  FUTURO: { label: "Futuro", tone: "gray" },
  FECHADO: { label: "Fechado · aguardando fatura", tone: "amber" },
  VENCIDO: { label: "Vencimento passou", tone: "red" },
};

export default async function DecendiosPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const d = await decendialReconciliation(ctx, str(sp, "fornecedor"), wm.month);
  return (
    <>
      <PageHeader
        title="Conciliação por decêndio"
        description="Para consolidadoras e operadoras que faturam a cada 10 dias: o que foi lançado no sistema em cada decêndio, o vencimento e as faturas recebidas."
        actions={
          <LinkButton href="/financeiro/faturas" variant="outline">
            <FileStack className="h-4 w-4" /> Faturas do fornecedor
          </LinkButton>
        }
      />
      {!d.supplier ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Nenhum fornecedor com faturamento decendial"
            description="Em Fornecedores, edite a consolidadora (ex.: Azul Viagens) e marque o ciclo de faturamento como Decendial."
            action={<LinkButton href="/fornecedores">Ir para fornecedores</LinkButton>}
          />
        </Card>
      ) : (
        <>
          <Card className="mb-5 flex flex-wrap items-end gap-4 px-5 py-4">
            <FilterForm>
              <FilterSelect name="fornecedor" label="Fornecedor" value={d.supplier.id} all={null} options={d.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
            </FilterForm>
            <p className="flex items-center gap-1.5 pb-2 text-xs text-muted">
              <Info className="h-3.5 w-3.5" /> Importação automática do PDF da fatura fica para a etapa de integrações.
            </p>
          </Card>

          <div className="mb-6 grid gap-4 lg:grid-cols-3">
            {d.periods.map((p) => (
              <Card key={p.n} className={cn("p-5", p.state === "EM_ANDAMENTO" && "ring-2 ring-brand-200")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{p.n}º decêndio</p>
                    <p className="mt-0.5 text-sm text-ink">
                      {formatDate(p.from)} a {formatDate(p.to)}
                    </p>
                  </div>
                  <Badge tone={STATE[p.state].tone} dot>
                    {STATE[p.state].label}
                  </Badge>
                </div>
                <ProgressBar value={p.progressPct} max={100} className="mt-3" />
                <p className="mt-1.5 text-xs text-muted">
                  Fecha {formatDate(p.closes)} · vence <span className="font-semibold text-ink">{formatDate(p.due)}</span>
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-brand-25 p-3 text-sm">
                  <dt className="text-muted">Vendas</dt>
                  <dd className="text-right font-medium">{p.sales}</dd>
                  <dt className="text-muted">Vendido</dt>
                  <dd className="text-right font-medium">{formatBRL(p.soldCents)}</dd>
                  <dt className="text-muted">Custo (a pagar)</dt>
                  <dd className="text-right font-medium">{formatBRL(p.costCents)}</dd>
                  <dt className="text-muted">Comissão / over</dt>
                  <dd className="text-right font-medium text-success">{formatBRL(p.commissionCents + p.overCents)}</dd>
                </dl>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card>
              <CardHeader title="Calendário de decêndios" icon={CalendarClock} />
              <Table>
                <thead>
                  <tr>
                    <Th>Decêndio</Th>
                    <Th>Vendas</Th>
                    <Th>Fecha</Th>
                    <Th>Vence</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td className="font-medium">1º</Td>
                    <Td>01 a 10</Td>
                    <Td>dia 11</Td>
                    <Td className="font-semibold">dia 23</Td>
                  </tr>
                  <tr>
                    <Td className="font-medium">2º</Td>
                    <Td>11 a 20</Td>
                    <Td>dia 21</Td>
                    <Td className="font-semibold">dia 03 (mês seguinte)</Td>
                  </tr>
                  <tr>
                    <Td className="font-medium">3º</Td>
                    <Td>21 ao fim</Td>
                    <Td>dia 01</Td>
                    <Td className="font-semibold">dia 13 (mês seguinte)</Td>
                  </tr>
                </tbody>
              </Table>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader title={`Faturas de ${d.supplier.name}`} description="Vencendo neste mês e no próximo" icon={FileStack} />
              {d.invoices.length === 0 ? (
                <EmptyState icon={FileStack} title="Nenhuma fatura registrada" description="Registre a fatura em Faturas do fornecedor para conferir com o sistema." />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Nº fatura</Th>
                      <Th>Vencimento</Th>
                      <Th align="right">Valor da fatura</Th>
                      <Th align="right">No sistema</Th>
                      <Th align="right">Saldo</Th>
                      <Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.invoices.map((i) => (
                      <tr key={i.id}>
                        <Td>
                          <Link href={`/financeiro/faturas/${i.id}`} className="font-semibold text-ink hover:text-brand-700">
                            {i.number}
                          </Link>
                        </Td>
                        <Td>{formatDate(i.dueDate)}</Td>
                        <Td align="right">{formatBRL(i.declaredCents)}</Td>
                        <Td align="right" className={i.declaredCents !== i.systemCents ? "text-danger" : ""}>
                          {formatBRL(i.systemCents)}
                        </Td>
                        <Td align="right">{formatBRL(i.openCents)}</Td>
                        <Td>
                          <InvoiceStatusBadge s={i.status} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
