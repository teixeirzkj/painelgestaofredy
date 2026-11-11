"use client";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { deleteFlightAction, saveFlightAction } from "@/app/actions";

export type Flight = { id: string; airline: string; flightNumber: string; origin: string; destination: string; departureAt: string; arrivalAt: string | null; source: string };

const hhmm = (v: string | null) => (v ? v.slice(11, 16) : "");
const ddmm = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}`;
const EMPTY = { airline: "", flightNumber: "", origin: "", destination: "", departureAt: "", arrivalAt: "" };

/** Voos da venda: aparecem na Central da Viagem (voos do dia, conexões curtas). */
export function FlightsPanel({ saleId, flights, canEdit }: { saleId: string; flights: Flight[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<{ id: string | null; d: typeof EMPTY } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();

  async function save() {
    if (!editing) return;
    const r = await run(() => saveFlightAction(saleId, editing.id, editing.d), { onSuccess: () => setEditing(null) });
    setErrors(r.ok ? {} : issuesToMap(r.issues));
  }

  return (
    <div className="space-y-2 text-sm">
      {flights.length === 0 && <p className="text-muted">Nenhum voo cadastrado.{canEdit && " Cadastre os trechos para a viagem aparecer na Central da Viagem."}</p>}
      {flights.map((f) => (
        <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
          <div>
            <p className="font-semibold text-ink">
              {f.airline} {f.flightNumber} · {f.origin} → {f.destination}
            </p>
            <p className="text-xs text-muted">
              {ddmm(f.departureAt)} {hhmm(f.departureAt)}
              {f.arrivalAt && ` → ${f.arrivalAt.slice(0, 10) !== f.departureAt.slice(0, 10) ? ddmm(f.arrivalAt) + " " : ""}${hhmm(f.arrivalAt)}`}
              {f.source === "MONDE" && " · do Monde"}
            </p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className="rounded-md p-1.5 text-muted hover:bg-slate-100 hover:text-ink"
                title="Editar voo"
                onClick={() => {
                  setErrors({});
                  setEditing({ id: f.id, d: { airline: f.airline, flightNumber: f.flightNumber, origin: f.origin, destination: f.destination, departureAt: f.departureAt, arrivalAt: f.arrivalAt ?? "" } });
                }}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-danger"
                title="Excluir voo"
                onClick={() => {
                  if (confirm(`Excluir o voo ${f.airline} ${f.flightNumber}?`)) run(() => deleteFlightAction(saleId, f.id));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      ))}
      {canEdit && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setErrors({});
            setEditing({ id: null, d: EMPTY });
          }}
        >
          <Plus className="h-4 w-4" /> Incluir voo
        </Button>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar voo" : "Incluir voo"}
        size="sm"
        footer={
          <Button loading={busy} onClick={save}>
            Salvar
          </Button>
        }
      >
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Companhia" required hint="Código de 2 letras: LA, G3, AD, TP…" error={errors.airline}>
              <Input value={editing.d.airline} maxLength={3} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, airline: e.target.value.toUpperCase() } })} placeholder="LA" />
            </Field>
            <Field label="Número do voo" required error={errors.flightNumber}>
              <Input value={editing.d.flightNumber} maxLength={5} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, flightNumber: e.target.value.toUpperCase() } })} placeholder="8084" />
            </Field>
            <Field label="Origem" required hint="Aeroporto (3 letras)" error={errors.origin}>
              <Input value={editing.d.origin} maxLength={3} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, origin: e.target.value.toUpperCase() } })} placeholder="GRU" />
            </Field>
            <Field label="Destino" required hint="Aeroporto (3 letras)" error={errors.destination}>
              <Input value={editing.d.destination} maxLength={3} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, destination: e.target.value.toUpperCase() } })} placeholder="LIS" />
            </Field>
            <Field label="Partida" required hint="Horário local da origem" error={errors.departureAt}>
              <Input type="datetime-local" value={editing.d.departureAt} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, departureAt: e.target.value } })} />
            </Field>
            <Field label="Chegada" hint="Horário local do destino" error={errors.arrivalAt}>
              <Input type="datetime-local" value={editing.d.arrivalAt} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, arrivalAt: e.target.value } })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
