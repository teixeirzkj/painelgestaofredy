"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Receipt, Check } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal, MoneyInput } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { addExcursionCostAction, saveExcursionAction, updatePassengerRoomAction } from "@/app/actions";
import { EXCURSION_STATUS } from "@/lib/constants";

type Exc = { id?: string; name: string; destination: string; startDate: string; endDate: string; seats: number; pricePerSeatCents: number; status: string; notes: string };

export function ExcursionFormButton({ initial, label }: { initial?: Exc; label?: string }) {
  const router = useRouter();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Exc>(initial ?? { name: "", destination: "", startDate: "", endDate: "", seats: 40, pricePerSeatCents: 0, status: "VENDAS_ABERTAS", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      <Button variant={initial ? "outline" : "primary"} onClick={() => setOpen(true)}>
        {initial ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {label ?? (initial ? "Editar" : "Nova excursão")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={initial ? "Editar excursão" : "Nova excursão"}
        description="Grupo de operação própria: as reservas são vendas vinculadas e os custos viram contas a pagar."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(() => saveExcursionAction(initial?.id ?? null, f), {
                  refresh: !!initial,
                  onSuccess: (d) => {
                    setOpen(false);
                    if (!initial) router.push(`/excursoes/${d.id}`);
                  },
                });
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required error={errors.name} className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Beto Carrero World — feriado de novembro" />
          </Field>
          <Field label="Destino" required error={errors.destination}>
            <Input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
          </Field>
          <Field label="Situação">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {EXCURSION_STATUS.values.map((v) => (
                <option key={v} value={v}>
                  {EXCURSION_STATUS.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Saída" required error={errors.startDate}>
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Retorno" required error={errors.endDate}>
            <Input type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </Field>
          <Field label="Vagas" required error={errors.seats}>
            <Input type="number" min={1} value={f.seats} onChange={(e) => setF({ ...f, seats: Number(e.target.value) })} />
          </Field>
          <Field label="Preço por passageiro" hint="sugerido ao lançar reservas">
            <MoneyInput value={f.pricePerSeatCents} onChange={(v) => setF({ ...f, pricePerSeatCents: v })} />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function AddCostButton({ excursionId, suppliers, defaultDue }: { excursionId: string; suppliers: { id: string; name: string }[]; defaultDue: string }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ description: "", supplierId: "", amountCents: 0, dueDate: defaultDue });
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Receipt className="h-4 w-4" /> Lançar custo
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Custo da excursão"
        description="Ônibus, hospedagem, guia, ingressos… vira uma conta a pagar vinculada à excursão."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                run(() => addExcursionCostAction(excursionId, { ...f, supplierId: f.supplierId || null }), {
                  onSuccess: () => {
                    setOpen(false);
                    setF({ ...f, description: "", amountCents: 0 });
                  },
                })
              }
            >
              Lançar
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Descrição" required className="sm:col-span-2">
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: Fretamento do ônibus" />
          </Field>
          <Field label="Fornecedor">
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" required>
            <MoneyInput value={f.amountCents} onChange={(v) => setF({ ...f, amountCents: v })} />
          </Field>
          <Field label="Vencimento" required>
            <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/** Edição inline de quarto e poltrona (rooming list). */
export function RoomCell({ passengerId, room, seat, editable }: { passengerId: string; room: string | null; seat: string | null; editable: boolean }) {
  const { run, busy } = useAction();
  const [r, setR] = useState(room ?? "");
  const [s, setS] = useState(seat ?? "");
  const dirty = r !== (room ?? "") || s !== (seat ?? "");
  if (!editable) return <span className="text-sm text-slate-600">{[room && `Quarto ${room}`, seat && `Poltrona ${seat}`].filter(Boolean).join(" · ") || "—"}</span>;
  return (
    <div className="flex items-center gap-1.5">
      <Input value={r} onChange={(e) => setR(e.target.value)} placeholder="Quarto" className="h-8 w-24 text-xs" aria-label="Quarto" />
      <Input value={s} onChange={(e) => setS(e.target.value)} placeholder="Poltrona" className="h-8 w-20 text-xs" aria-label="Poltrona" />
      {dirty && (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => run(() => updatePassengerRoomAction(passengerId, { room: r, seat: s }), { success: false })} aria-label="Salvar quarto">
          <Check className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
