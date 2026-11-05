"use client";
import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { saveCardFeeAction } from "@/app/actions";

type Fee = { id: string; modality: string; installmentsFrom: number; installmentsTo: number; rateBps: number; settlementDays: number; brand: string | null; active: boolean };

export function CardFeeEditor({ fee }: { fee?: Fee }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const init = () => ({
    modality: fee?.modality ?? "CREDITO",
    installmentsFrom: fee?.installmentsFrom ?? 1,
    installmentsTo: fee?.installmentsTo ?? 1,
    rate: fee ? String(fee.rateBps / 100).replace(".", ",") : "",
    settlementDays: fee?.settlementDays ?? 30,
    brand: fee?.brand ?? "",
    active: fee?.active ?? true,
  });
  const [f, setF] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      {fee ? (
        <Button variant="ghost" size="sm" onClick={() => (setF(init()), setOpen(true))} aria-label="Editar taxa">
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button onClick={() => (setF(init()), setOpen(true))}>
          <Plus className="h-4 w-4" /> Nova taxa
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={fee ? "Editar taxa de cartão" : "Nova taxa de cartão"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const rateBps = Math.round(Number(f.rate.replace(",", ".")) * 100);
                if (!Number.isFinite(rateBps) || rateBps < 0) return setErrors({ rateBps: "Informe a taxa em %." });
                const r = await run(
                  () => saveCardFeeAction(fee?.id ?? null, { modality: f.modality, installmentsFrom: f.installmentsFrom, installmentsTo: f.modality === "DEBITO" ? 1 : f.installmentsTo, rateBps, settlementDays: f.settlementDays, brand: f.brand, active: f.active }),
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
          <Field label="Modalidade">
            <Select value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value })}>
              <option value="CREDITO">Crédito</option>
              <option value="DEBITO">Débito</option>
            </Select>
          </Field>
          <Field label="Bandeira (opcional)">
            <Input value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} placeholder="Todas" />
          </Field>
          {f.modality === "CREDITO" && (
            <>
              <Field label="Parcelas de" error={errors.installmentsFrom}>
                <Input type="number" min={1} max={24} value={f.installmentsFrom} onChange={(e) => setF({ ...f, installmentsFrom: Number(e.target.value) })} />
              </Field>
              <Field label="até" error={errors.installmentsTo}>
                <Input type="number" min={1} max={24} value={f.installmentsTo} onChange={(e) => setF({ ...f, installmentsTo: Number(e.target.value) })} />
              </Field>
            </>
          )}
          <Field label="Taxa (%)" required error={errors.rateBps}>
            <Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="Ex.: 3,49" className="text-right" />
          </Field>
          <Field label="Liquidação (dias após o pagamento)" error={errors.settlementDays}>
            <Input type="number" min={0} max={365} value={f.settlementDays} onChange={(e) => setF({ ...f, settlementDays: Number(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Taxa ativa
          </label>
        </div>
      </Modal>
    </>
  );
}
