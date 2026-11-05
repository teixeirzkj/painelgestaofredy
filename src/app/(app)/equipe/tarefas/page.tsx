import Link from "next/link";
import { ListTodo, Clock, PlayCircle, AlarmClock, CheckCircle2 } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { listTasks } from "@/server/services/team";
import { Badge, Card, EmptyState, KpiCard, PageHeader, Table, Td, Th, type Tone } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { formatDate } from "@/lib/dates";
import { TASK_PRIORITY, TASK_STATUS, TASK_TYPES } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { TaskButton, TaskQuickActions } from "./task-client";

export const metadata = { title: "Tarefas" };

const prioTone: Record<string, Tone> = { URGENTE: "red", ALTA: "amber", MEDIA: "blue", BAIXA: "gray" };
const statusTone: Record<string, Tone> = { PENDENTE: "amber", EM_ANDAMENTO: "violet", CONCLUIDA: "green", CANCELADA: "gray" };

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const f = { status: str(sp, "status"), priority: str(sp, "prioridade"), assigneeId: str(sp, "responsavel") };
  const d = await listTasks(ctx, f);

  return (
    <>
      <PageHeader title="Tarefas" description="Tarefas, follow-ups e lembretes da equipe." actions={<TaskButton users={d.users} />} />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pendentes" value={String(d.stats.pending)} icon={Clock} tone="amber" />
        <KpiCard label="Em andamento" value={String(d.stats.inProgress)} icon={PlayCircle} tone="violet" />
        <KpiCard label="Vencidas" value={String(d.stats.overdue)} icon={AlarmClock} tone={d.stats.overdue ? "red" : "slate"} />
        <KpiCard label="Concluídas no mês" value={String(d.stats.doneThisMonth)} icon={CheckCircle2} tone="green" />
      </section>
      <Card>
        <div className="border-b border-line px-5 py-3">
          <FilterForm>
            <FilterSelect name="status" label="Status" value={f.status} options={TASK_STATUS.values.map((v) => ({ value: v, label: TASK_STATUS.label(v) }))} all="Em aberto" />
            <FilterSelect name="prioridade" label="Prioridade" value={f.priority} options={TASK_PRIORITY.values.map((v) => ({ value: v, label: TASK_PRIORITY.label(v) }))} all="Todas as prioridades" />
            <FilterSelect name="responsavel" label="Responsável" value={f.assigneeId} options={d.users.map((u) => ({ value: u.id, label: u.name }))} all="Todos os responsáveis" />
          </FilterForm>
        </div>
        {d.items.length === 0 ? (
          <EmptyState icon={ListTodo} title="Nenhuma tarefa encontrada" description="Crie tarefas para follow-ups, cobranças, documentos e pós-venda." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tarefa</Th>
                <Th>Prioridade</Th>
                <Th>Responsável</Th>
                <Th>Cliente</Th>
                <Th>Vencimento</Th>
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Ações</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((t) => (
                <tr key={t.id}>
                  <Td className="max-w-80 py-3.5">
                    <p className="truncate font-medium text-ink">{t.title}</p>
                    <p className="truncate text-xs text-muted">
                      {TASK_TYPES.label(t.type)}
                      {t.description && ` · ${t.description}`}
                    </p>
                  </Td>
                  <Td>
                    <Badge tone={prioTone[t.priority] ?? "gray"}>{TASK_PRIORITY.label(t.priority)}</Badge>
                  </Td>
                  <Td className="text-slate-600">{t.assigneeName}</Td>
                  <Td>
                    {t.client ? (
                      <Link href={`/clientes/${t.client.id}`} className="text-brand-700 hover:underline">
                        {t.client.name}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className={cn("whitespace-nowrap", t.overdue && "font-medium text-danger")}>{formatDate(t.dueDate)}</Td>
                  <Td>
                    <Badge dot tone={statusTone[t.status] ?? "gray"}>
                      {TASK_STATUS.label(t.status)}
                    </Badge>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <TaskQuickActions id={t.id} status={t.status} />
                      <TaskButton
                        users={d.users}
                        task={{ id: t.id, title: t.title, description: t.description ?? "", type: t.type, priority: t.priority, status: t.status, dueDate: t.dueDate ?? "", assigneeId: t.assigneeId ?? "", client: t.client }}
                      />
                    </div>
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
