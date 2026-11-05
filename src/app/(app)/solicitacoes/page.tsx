import Link from "next/link";
import { FileClock } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listEditRequests } from "@/server/services/ops";
import { Badge, Card, EmptyState, Notice, PageHeader, Table, Tabs, Td, Th, type Tone } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { EDIT_REQUEST_STATUS } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { ReviewButtons } from "./review-client";

export const metadata = { title: "Solicitações de edição" };

const TONE: Record<string, Tone> = { PENDENTE: "amber", APROVADA: "green", REJEITADA: "red", UTILIZADA: "gray" };

export default async function EditRequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const raw = str(sp, "status");
  const status = raw === "todas" ? undefined : raw && ["APROVADA", "REJEITADA", "UTILIZADA"].includes(raw) ? raw : raw === undefined ? "PENDENTE" : "PENDENTE";
  const rows = await listEditRequests(ctx, status);
  const canReview = can(ctx, "finance.manage");

  return (
    <>
      <PageHeader title="Solicitações de edição" description="Pedidos de alteração em vendas já conferidas pelo financeiro. Quem tem permissão revisa e aprova." />
      <Notice className="mb-5">
        Depois que o financeiro confere uma venda, ela fica travada para o vendedor. Para mudar algo, o vendedor pede a edição pela própria venda; com a aprovação, ele altera uma vez e a venda volta para a fila de conferência.
      </Notice>
      <Tabs
        active={raw === "todas" ? "todas" : status ?? "PENDENTE"}
        items={[
          { key: "PENDENTE", href: "/solicitacoes", label: "Pendentes" },
          { key: "APROVADA", href: "/solicitacoes?status=APROVADA", label: "Aprovadas" },
          { key: "REJEITADA", href: "/solicitacoes?status=REJEITADA", label: "Rejeitadas" },
          { key: "todas", href: "/solicitacoes?status=todas", label: "Todas" },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={FileClock} title="Nenhuma solicitação aqui" description={canReview ? "Quando um vendedor pedir para alterar uma venda conferida, o pedido aparece nesta lista." : "Seus pedidos de alteração aparecem aqui."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Venda</Th>
                <Th>Solicitante</Th>
                <Th>Motivo</Th>
                <Th>Pedido em</Th>
                <Th>Situação</Th>
                {canReview && status === "PENDENTE" && <Th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="py-3.5">
                    <Link href={`/vendas/${r.sale.id}`} className="font-semibold text-brand-700 hover:underline">
                      {r.sale.code}
                    </Link>
                    <p className="text-xs text-muted">
                      {r.sale.client.name} · {formatBRL(r.sale.grossCents)}
                    </p>
                  </Td>
                  <Td>{r.requestedBy}</Td>
                  <Td className="max-w-80 text-slate-700">
                    {r.reason}
                    {r.reviewNote && <p className="mt-1 text-xs text-muted">Resposta: {r.reviewNote}</p>}
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-slate-600">
                    {formatDateTime(r.createdAt, ctx.timezone)}
                    {r.reviewedBy && <p className="text-xs text-muted">por {r.reviewedBy}</p>}
                  </Td>
                  <Td>
                    <Badge tone={TONE[r.status] ?? "gray"} dot>
                      {EDIT_REQUEST_STATUS.label(r.status)}
                    </Badge>
                  </Td>
                  {canReview && status === "PENDENTE" && (
                    <Td align="right">
                      <ReviewButtons id={r.id} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
