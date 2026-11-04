"use client";
import { useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { ReservationStatusBadge } from "@/components/status";
import { useAction } from "@/components/use-action";
import { updateReservationAction } from "@/app/actions";
import { RESERVATION_STATUS } from "@/lib/constants";

export function ReservationEditor({ r, readOnly }: { r: { id: string; status: string; locator: string | null; notes: string | null }; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ status: r.status, locator: r.locator ?? "", notes: r.notes ?? "" });
  const { run, busy } = useAction();
  if (readOnly)
    return (
      <span className="flex items-center gap-2">
        <ReservationStatusBadge s={r.status} />
        {r.locator && <span className="text-xs text-muted">{r.locator}</span>}
      </span>
    );
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-md hover:bg-slate-50" title="Atualizar reserva">
        <ReservationStatusBadge s={r.status} />
        <span className="text-xs text-muted">{r.locator ?? "sem localizador"}</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reserva"
        size="sm"
        footer={
          <Button loading={busy} onClick={() => run(() => updateReservationAction(r.id, { status: d.status, locator: d.locator || null, notes: d.notes || null }), { onSuccess: () => setOpen(false) })}>
            Salvar
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Status com o fornecedor">
            <Select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>
              {RESERVATION_STATUS.values.map((v) => (
                <option key={v} value={v}>
                  {RESERVATION_STATUS.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Localizador">
            <Input value={d.locator} onChange={(e) => setD({ ...d, locator: e.target.value })} />
          </Field>
          <Field label="Observações operacionais">
            <Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
