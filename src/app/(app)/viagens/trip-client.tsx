"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Link2, Ban, RotateCcw, Pencil } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ConfirmDialog, Modal } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { createTripAction, linkSaleToTripAction, searchClientsAction, setTripCancelledAction, tripOptionsAction, updateTripAction } from "@/app/actions";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";

type ClientRef = { id: string; name: string };

export function NewTripButton({ label = "Nova viagem" }: { label?: string }) {
  const router = useRouter();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClientRef[]>([]);
  const [client, setClient] = useState<ClientRef | null>(null);
  const [f, setF] = useState({ title: "", destination: "", notes: "" });
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!open || client) return;
    clearTimeout(t.current);
    t.current = setTimeout(async () => {
      const r = await searchClientsAction(q);
      if (r.ok) setResults(r.data);
    }, 200);
  }, [q, open, client]);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nova viagem"
        description="A viagem agrupa as vendas do cliente: aéreo, hospedagem, seguro e serviços comprados em momentos diferentes."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              disabled={!client}
              onClick={() => run(() => createTripAction({ clientId: client!.id, ...f }), { refresh: false, onSuccess: (d) => router.push(`/viagens/${d.id}`) })}
            >
              Criar viagem
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Cliente" required>
            {client ? (
              <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-25 px-3 py-2 text-sm">
                <span className="font-medium">{client.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setClient(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                  <Input className="pl-9" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" />
                </div>
                <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-line">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setClient(c)}>
                        {c.name}
                      </button>
                    </li>
                  ))}
                  {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhum cliente encontrado.</li>}
                </ul>
              </div>
            )}
          </Field>
          <Field label="Nome da viagem" required hint="Ex.: Férias em Lisboa, Lua de mel Maldivas">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Destino">
            <Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
          </Field>
          <Field label="Observações">
            <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function TripActions({ trip, canCancel }: { trip: { id: string; clientId: string; title: string; destination: string | null; notes: string | null; cancelled: boolean }; canCancel: boolean }) {
  const { run, busy } = useAction();
  const [edit, setEdit] = useState(false);
  const [link, setLink] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [f, setF] = useState({ title: trip.title, destination: trip.destination ?? "", notes: trip.notes ?? "" });
  const [loose, setLoose] = useState<{ id: string; code: string; destination: string | null; saleDate: string; grossCents: number }[]>([]);
  return (
    <>
      {!trip.cancelled && (
        <Button
          variant="outline"
          onClick={async () => {
            const r = await tripOptionsAction(trip.clientId);
            if (r.ok) setLoose(r.data.looseSales);
            setLink(true);
          }}
        >
          <Link2 className="h-4 w-4" /> Vincular venda existente
        </Button>
      )}
      <Button variant="outline" onClick={() => setEdit(true)}>
        <Pencil className="h-4 w-4" /> Editar
      </Button>
      {canCancel &&
        (trip.cancelled ? (
          <Button variant="ghost" loading={busy} onClick={() => run(() => setTripCancelledAction(trip.id, false))}>
            <RotateCcw className="h-4 w-4" /> Reativar
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            <Ban className="h-4 w-4" /> Cancelar viagem
          </Button>
        ))}
      <Modal
        open={edit}
        onClose={() => setEdit(false)}
        title="Editar viagem"
        footer={
          <>
            <Button variant="outline" onClick={() => setEdit(false)}>
              Voltar
            </Button>
            <Button loading={busy} onClick={() => run(() => updateTripAction(trip.id, { clientId: trip.clientId, ...f }), { onSuccess: () => setEdit(false) })}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nome da viagem" required>
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Destino">
            <Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
          </Field>
          <Field label="Observações">
            <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
      <Modal open={link} onClose={() => setLink(false)} title="Vincular venda existente" description="Vendas do mesmo cliente que ainda não estão em nenhuma viagem.">
        {loose.length === 0 ? (
          <p className="text-sm text-muted">Não há vendas avulsas deste cliente.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {loose.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{s.code}</span> · {s.destination ?? "sem destino"} · {formatDate(s.saleDate)}
                  <span className="block text-xs text-muted">{formatBRL(s.grossCents)}</span>
                </span>
                <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => linkSaleToTripAction(trip.id, s.id), { onSuccess: () => setLoose((l) => l.filter((x) => x.id !== s.id)) })}>
                  Vincular
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Cancelar viagem"
        description="A viagem fica marcada como cancelada. As vendas vinculadas não são alteradas: cancele-as individualmente se necessário."
        confirmLabel="Cancelar viagem"
        onConfirm={async () => {
          await run(() => setTripCancelledAction(trip.id, true));
          setConfirm(false);
        }}
      />
    </>
  );
}

export function UnlinkSaleButton({ saleId }: { saleId: string }) {
  const { run, busy } = useAction();
  return (
    <Button variant="ghost" size="sm" loading={busy} onClick={() => run(() => linkSaleToTripAction(null, saleId))}>
      Desvincular
    </Button>
  );
}

export function TripStatusFilter({ value }: { value?: string }) {
  const router = useRouter();
  return (
    <Select
      value={value ?? ""}
      className="w-auto"
      aria-label="Situação"
      onChange={(e) => router.push(e.target.value ? `/viagens?status=${e.target.value}` : "/viagens")}
    >
      <option value="">Todas as situações</option>
      <option value="A_INICIAR">A iniciar</option>
      <option value="EM_VIAGEM">Em viagem</option>
      <option value="FINALIZADA">Finalizadas</option>
      <option value="SEM_DATAS">Sem datas</option>
      <option value="CANCELADA">Canceladas</option>
    </Select>
  );
}
