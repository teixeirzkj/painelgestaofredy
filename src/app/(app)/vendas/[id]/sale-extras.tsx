"use client";
import { useState } from "react";
import Link from "next/link";
import { RotateCcw, Map, Unlink } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { Modal, MoneyInput } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { linkSaleToTripAction, registerRefundAction, tripOptionsAction } from "@/app/actions";
import { REFUND_KINDS } from "@/lib/constants";
import { newKey } from "@/lib/utils";

/** Reembolsos e multas ligados à venda (geram o lançamento correto no financeiro). */
export function RefundButton({ saleId, suppliers, today }: { saleId: string; suppliers: { id: string; name: string }[]; today: string }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: "REEMBOLSO_CLIENTE", amountCents: 0, dueDate: today, supplierId: suppliers[0]?.id ?? "", description: "", requestKey: newKey() });
  const needsSupplier = f.kind === "REEMBOLSO_FORNECEDOR" || f.kind === "MULTA_FORNECEDOR";
  const effect: Record<string, string> = {
    REEMBOLSO_CLIENTE: "Gera uma conta a pagar ao cliente. É repasse: não entra no resultado (DRE).",
    REEMBOLSO_FORNECEDOR: "Gera uma conta a receber do fornecedor. É repasse: não entra no resultado (DRE).",
    MULTA_FORNECEDOR: "Gera uma conta a pagar ao fornecedor, lançada como despesa no DRE.",
    MULTA_CLIENTE: "Gera uma conta a receber do cliente, lançada como receita no DRE.",
  };
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setF({ ...f, requestKey: newKey(), amountCents: 0, description: "" });
          setOpen(true);
        }}
      >
        <RotateCcw className="h-4 w-4" /> Reembolso ou multa
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Registrar reembolso ou multa"
        description="Use em cancelamentos, remarcações ou devoluções. Valores já pagos nunca são apagados."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button loading={busy} onClick={() => run(() => registerRefundAction(saleId, { ...f, supplierId: needsSupplier ? f.supplierId : null }), { onSuccess: () => setOpen(false) })}>
              Registrar
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo" className="sm:col-span-2" hint={effect[f.kind]}>
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {REFUND_KINDS.values.map((k) => (
                <option key={k} value={k}>
                  {REFUND_KINDS.label(k)}
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
          {needsSupplier && (
            <Field label="Fornecedor" className="sm:col-span-2">
              <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Descrição" className="sm:col-span-2">
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: cancelamento do hotel, multa de 20%" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

/** Vincula a venda a uma viagem do mesmo cliente (ou desvincula). */
export function TripLink({ saleId, clientId, trip, canEdit }: { saleId: string; clientId: string; trip: { id: string; code: string; title: string } | null; canEdit: boolean }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: string; code: string; title: string }[]>([]);
  const [selected, setSelected] = useState("");
  if (trip)
    return (
      <div className="flex items-center justify-between gap-2">
        <Link href={`/viagens/${trip.id}`} className="flex min-w-0 items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
          <Map className="h-4 w-4 shrink-0" /> <span className="truncate">{trip.code} · {trip.title}</span>
        </Link>
        {canEdit && (
          <Button variant="ghost" size="sm" loading={busy} onClick={() => run(() => linkSaleToTripAction(null, saleId))} title="Desvincular da viagem">
            <Unlink className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  if (!canEdit) return <p className="text-sm text-muted">Venda avulsa (sem viagem vinculada).</p>;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        onClick={async () => {
          const r = await tripOptionsAction(clientId);
          if (r.ok) {
            setOptions(r.data.trips);
            setSelected(r.data.trips[0]?.id ?? "");
          }
          setOpen(true);
        }}
      >
        <Map className="h-4 w-4" /> Vincular a uma viagem
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Vincular a uma viagem"
        description="Agrupe vendas do mesmo cliente feitas em momentos diferentes."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button disabled={!selected} loading={busy} onClick={() => run(() => linkSaleToTripAction(selected, saleId), { onSuccess: () => setOpen(false) })}>
              Vincular
            </Button>
          </>
        }
      >
        {options.length === 0 ? (
          <p className="text-sm text-muted">
            Este cliente ainda não tem viagens. Crie uma em{" "}
            <Link href="/viagens" className="text-brand-600 hover:underline">
              Viagens
            </Link>{" "}
            ou pelo formulário da venda.
          </p>
        ) : (
          <Field label="Viagem">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Modal>
    </>
  );
}
