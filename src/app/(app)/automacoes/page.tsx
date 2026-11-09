import { requirePageContext } from "@/server/auth";
import { prisma } from "@/server/db";
import { listAutomationSettings, listEvents } from "@/server/services/automations";
import { Card, CardHeader, Notice, PageHeader, Pagination, Table, Td, Th, Badge } from "@/components/ui";
import { EventStatusBadge } from "@/components/status";
import { formatDateTime } from "@/lib/dates";
import { int, withParams, type SearchParams } from "@/lib/params";
import { AutomationToggle, RunNowButton, PayloadButton } from "./automation-client";
import { Lock } from "lucide-react";

export const metadata = { title: "Automações" };

export default async function AutomationsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("automations.manage");
  const sp = await searchParams;
  const [automations, events, company] = await Promise.all([
    listAutomationSettings(ctx),
    listEvents(ctx, { page: int(sp, "pagina") }),
    prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { webhookUrl: true, apiKeyHash: true } }),
  ]);
  const groups = [...new Set(automations.map((a) => a.group))];
  const hasDestination = !!company.webhookUrl || !!company.apiKeyHash;

  return (
    <>
      <PageHeader title="Automações" description="Automações prontas: ative com um clique. Cada fato gera no máximo um evento (idempotência)." actions={<RunNowButton />} />
      <div className="mb-6 space-y-3">
        {!hasDestination && (
          <Notice tone="amber" title="Integração com o Frédy ainda não configurada">
            Os eventos estão sendo registrados, mas nenhum destino foi configurado. Em Configurações → Integrações, defina um webhook ou
            gere uma chave de API para o Frédy consultar os eventos. Nenhum endpoint do Frédy é presumido por este módulo.
          </Notice>
        )}
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader title={g} />
            <ul className="divide-y divide-line">
              {automations
                .filter((a) => a.group === g)
                .map((a) => (
                  <li key={a.key} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{a.description}</p>
                      {"eventType" in a && <code className="mt-1 inline-block rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{a.eventType}</code>}
                    </div>
                    {a.core ? (
                      <span title="Sempre ativa: parte do lançamento da venda" className="flex items-center gap-1 text-xs text-muted">
                        <Lock className="h-3.5 w-3.5" /> Sempre ativa
                      </span>
                    ) : (
                      <AutomationToggle k={a.key} enabled={a.enabled} />
                    )}
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Histórico de eventos" description="Registro de execução: tipo, entidade, status de entrega e tentativas." />
        {events.items.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Nenhum evento gerado ainda.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Quando</Th>
                <Th>Evento</Th>
                <Th>Entidade</Th>
                <Th>Status</Th>
                <Th align="right">Tentativas</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {events.items.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-slate-600">{formatDateTime(e.createdAt, ctx.timezone)}</Td>
                  <Td>
                    <Badge tone="blue">{e.type}</Badge>
                  </Td>
                  <Td className="text-xs text-slate-600">
                    {e.entityType} · {e.entityId.slice(-8)}
                  </Td>
                  <Td>
                    <EventStatusBadge s={e.status === "PENDENTE" && !hasDestination ? "SEM_DESTINO" : e.status} />
                    {e.lastError && <p className="text-xs text-danger">{e.lastError}</p>}
                  </Td>
                  <Td align="right">{e.attempts}</Td>
                  <Td align="right">
                    <PayloadButton payload={e.payloadJson} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={events.page} pages={events.pages} total={events.total} hrefFor={(p) => withParams("/automacoes", sp, { pagina: p })} />
      </Card>
    </>
  );
}
