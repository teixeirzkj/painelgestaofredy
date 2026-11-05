"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal, MoneyInput } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { createAgencyTransferAction } from "@/app/actions";

export function NewTransferButton({ today }: { today: string }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const blank = { counterparty: "", direction: "A_RECEBER", amountCents: 0, reference: "", dueDate: today, notes: "" };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      <Button onClick={() => (setF(blank), setErrors({}), setOpen(true))}>
        <Plus className="h-4 w-4" /> Novo repasse
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo repasse"
        description="Gera a conta a pagar (a repassar) ou a conta a receber correspondente no financeiro."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(() => createAgencyTransferAction(f), { onSuccess: () => setOpen(false) });
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Registrar
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Agência parceira" required error={errors.counterparty} className="sm:col-span-2">
            <Input value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />
          </Field>
          <Field label="Tipo">
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="A_RECEBER">A receber da parceira</option>
              <option value="A_REPASSAR">A repassar à parceira</option>
            </Select>
          </Field>
          <Field label="Valor" required error={errors.amountCents}>
            <MoneyInput value={f.amountCents} onChange={(v) => setF({ ...f, amountCents: v })} />
          </Field>
          <Field label="Referência" hint="Fatura ou venda relacionada">
            <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </Field>
          <Field label="Vencimento" required error={errors.dueDate}>
            <Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
