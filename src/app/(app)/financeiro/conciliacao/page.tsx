import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listAccounts } from "@/server/services/finance";
import { listStatementLines } from "@/server/services/reconciliation";
import { Card, CardHeader, EmptyState, Notice, Table, Td, Th, Badge } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { ImportStatement, LineActions } from "./reconcile-client";
import { Landmark } from "lucide-react";

export const metadata = { title: "Conciliação" };

export default async function ReconciliationPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const accounts = await listAccounts(ctx);
  const accountId = str(sp, "conta") ?? accounts[0]?.id;
  const status = str(sp, "situacao") ?? "PENDENTE";
  const data = accountId ? await listStatementLines(ctx, accountId, status === "TODOS" ? "" : status) : { lines: [], suggestions: {} };
  const canManage = can(ctx, "finance.manage");

  return (
    <div className="space-y-4">
      <Notice title="Conciliação manual">
        Importe o extrato em CSV (colunas <code>data;descricao;valor</code>, valores negativos para débitos) e confirme a correspondência com as baixas registradas. Linhas já
        importadas são ignoradas automaticamente. A integração bancária automática (Open Finance/APIs dos bancos) depende de credenciais e homologação e ainda não está ativa.
      </Notice>
      <Card>
        <CardHeader
          title="Extrato importado"
          action={canManage && accountId && <ImportStatement accountId={accountId} />}
        />
        <div className="border-b border-line p-3">
          <FilterForm>
            <FilterSelect name="conta" label="Conta" value={accountId} all={null} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
            <FilterSelect
              name="situacao"
              label="Situação"
              value={status}
              all={null}
              options={[
                { value: "PENDENTE", label: "Pendentes" },
                { value: "CONCILIADO", label: "Conciliadas" },
                { value: "IGNORADO", label: "Ignoradas" },
                { value: "TODOS", label: "Todas" },
              ]}
            />
          </FilterForm>
        </div>
        {data.lines.length === 0 ? (
          <EmptyState icon={Landmark} title="Nenhuma linha de extrato" description="Importe um arquivo CSV do banco para começar a conciliar." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Descrição</Th>
                <Th align="right">Valor</Th>
                <Th>Situação / correspondência</Th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap">{formatDate(l.date)}</Td>
                  <Td className="max-w-72 truncate">{l.description}</Td>
                  <Td align="right" className={l.amountCents < 0 ? "text-danger" : "text-success"}>
                    {formatBRL(l.amountCents)}
                  </Td>
                  <Td>
                    {l.status === "CONCILIADO" ? (
                      <span className="text-xs">
                        <Badge tone="green">Conciliado</Badge> {l.settlement?.receivable?.description ?? l.settlement?.payable?.description}
                      </span>
                    ) : l.status === "IGNORADO" ? (
                      <span className="flex items-center gap-2">
                        <Badge>Ignorado</Badge>
                        {canManage && <LineActions lineId={l.id} suggestions={[]} ignored />}
                      </span>
                    ) : canManage ? (
                      <LineActions lineId={l.id} suggestions={data.suggestions[l.id] ?? []} />
                    ) : (
                      <Badge tone="amber">Pendente</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
