"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Play, Check, Search, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { saveTaskAction, searchClientsAction, setTaskStatusAction } from "@/app/actions";
import { TASK_PRIORITY, TASK_STATUS, TASK_TYPES } from "@/lib/constants";

type User = { id: string; name: string };
type ClientRef = { id: string; name: string };
type TaskData = { id: string; title: string; description: string; type: string; priority: string; status: string; dueDate: string; assigneeId: string; client: ClientRef | null };

function ClientField({ value, onChange }: { value: ClientRef | null; onChange: (c: ClientRef | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClientRef[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await searchClientsAction(q);
      if (r.ok) setResults(r.data);
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q, open]);
  if (value)
    return (
      <div className="flex h-9 items-center justify-between rounded-xl border border-brand-200 bg-brand-25 px-3 text-sm">
        <span className="truncate">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} aria-label="Remover cliente" className="text-muted hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
      <Input className="pl-9" placeholder="Buscar cliente (opcional)" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onMouseDown={() => onChange({ id: c.id, name: c.name })}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskButton({ users, task }: { users: User[]; task?: TaskData }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const blank: TaskData = { id: "", title: "", description: "", type: "FOLLOW_UP", priority: "MEDIA", status: "PENDENTE", dueDate: "", assigneeId: "", client: null };
  const [f, setF] = useState<TaskData>(task ?? blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      {task ? (
        <Button variant="ghost" size="sm" aria-label="Editar tarefa" onClick={() => (setF(task), setErrors({}), setOpen(true))}>
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button onClick={() => (setF(blank), setErrors({}), setOpen(true))}>
          <Plus className="h-4 w-4" /> Nova tarefa
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={task ? "Editar tarefa" : "Nova tarefa"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(
                  () =>
                    saveTaskAction(task?.id ?? null, {
                      title: f.title,
                      description: f.description,
                      type: f.type,
                      priority: f.priority,
                      status: f.status,
                      dueDate: f.dueDate || null,
                      assigneeId: f.assigneeId || null,
                      clientId: f.client?.id ?? null,
                    }),
                  { onSuccess: () => setOpen(false) },
                );
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título" required error={errors.title} className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
          </Field>
          <Field label="Tipo">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {TASK_TYPES.values.map((v) => (
                <option key={v} value={v}>
                  {TASK_TYPES.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridade">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {TASK_PRIORITY.values.map((v) => (
                <option key={v} value={v}>
                  {TASK_PRIORITY.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsável" hint="Vazio = você">
            <Select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vencimento" error={errors.dueDate}>
            <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
          <Field label="Cliente" className="sm:col-span-2">
            <ClientField value={f.client} onChange={(c) => setF({ ...f, client: c })} />
          </Field>
          {task && (
            <Field label="Status">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {TASK_STATUS.values.map((v) => (
                  <option key={v} value={v}>
                    {TASK_STATUS.label(v)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Descrição" className="sm:col-span-2">
            <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function TaskQuickActions({ id, status }: { id: string; status: string }) {
  const { run, busy } = useAction();
  if (status === "CONCLUIDA" || status === "CANCELADA") return null;
  return (
    <>
      {status === "PENDENTE" && (
        <Button variant="ghost" size="sm" loading={busy} aria-label="Iniciar" title="Iniciar" onClick={() => run(() => setTaskStatusAction(id, "EM_ANDAMENTO"), { success: "Tarefa em andamento." })}>
          <Play className="h-4 w-4" />
        </Button>
      )}
      <Button variant="ghost" size="sm" loading={busy} aria-label="Concluir" title="Concluir" onClick={() => run(() => setTaskStatusAction(id, "CONCLUIDA"), { success: "Tarefa concluída." })}>
        <Check className="h-4 w-4 text-success" />
      </Button>
    </>
  );
}
