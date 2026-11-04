import Link from "next/link";
import { Bus } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listExcursions } from "@/server/services/excursions";
import { Card, EmptyState, PageHeader, ProgressBar, Table, Td, Th } from "@/components/ui";
import { ExcursionStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ExcursionFormButton } from "./excursion-client";

export const metadata = { title: "Excursões e grupos" };

export default async function ExcursionsPage() {
  const ctx = await requirePageContext();
  const rows = await listExcursions(ctx);
  return (
    <>
      <PageHeader
        title="Excursões e grupos"
        description="Operação própria: vagas, passageiros, rooming list, custos, recebimentos e resultado de cada saída."
        actions={can(ctx, "sales.edit_all") && <ExcursionFormButton />}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Bus} title="Nenhuma excursão cadastrada" description="Cadastre uma saída com datas, vagas e preço. As reservas são lançadas como vendas vinculadas à excursão." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Excursão</Th>
                <Th>Saída</Th>
                <Th>Ocupação</Th>
                <Th align="right">Vendido</Th>
                {rows[0].resultCents !== null && <Th align="right">Resultado</Th>}
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <Td className="py-3.5">
                    <Link href={`/excursoes/${e.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {e.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {e.code} · {e.destination}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {formatDate(e.startDate)} – {formatDate(e.endDate)}
                  </Td>
                  <Td className="min-w-40">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted">
                        {e.booked}/{e.seats} vagas
                      </span>
                      <span className="font-medium">{Math.round((e.booked / Math.max(e.seats, 1)) * 100)}%</span>
                    </div>
                    <ProgressBar value={e.booked} max={e.seats} tone={e.booked >= e.seats ? "green" : "blue"} />
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatBRL(e.grossCents)}
                  </Td>
                  {e.resultCents !== null && (
                    <Td align="right" className={cn("font-medium", e.resultCents < 0 ? "text-danger" : "text-success")}>
                      {formatBRL(e.resultCents)}
                    </Td>
                  )}
                  <Td>
                    <ExcursionStatusBadge s={e.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
