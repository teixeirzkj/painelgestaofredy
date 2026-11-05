"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Search, ArrowRightLeft, Ban } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog, Modal, MoneyInput } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { cancelCreditAction, consumeCreditAction, createCreditAction, creditSalesOptionsAction, searchClientsAction } from "@/app/actions";
import { formatDate } from "@/lib/dates";

type ClientRef = { id: string; name: string };

/** Lançar crédito: manual (com busca de cliente) ou a partir de uma venda cancelada (cliente fixo). */
export function NewCreditButton({ fixedClient, originSaleId, label = "Lançar crédito manual", defaultAmount = 0, variant = "primary" }: { fixedClient?: ClientRef; originSaleId?: string; label?: string; defaultAmount?: number; variant?: "primary" | "outline" }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<ClientRef | null>(fixedClient ?? null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClientRef[]>([]);
  const [f, setF] = useState({ amountCents: defaultAmount, reason: originSaleId ? "Crédito de viagem cancelada para remarcação" : "", supplierName: "", expiresAt: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
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
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={originSaleId ? "Gerar crédito ao cliente" : "Lançar crédito"}
        description="O crédito fica disponível para ser usado em uma próxima venda do cliente (remarcação)."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              disabled={!client}
              onClick={async () => {
                const r = await run(() => createCreditAction({ clientId: client!.id, ...f, originSaleId: originSaleId ?? null }), { onSuccess: () => setOpen(false) });
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Lançar crédito
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cliente" required className="sm:col-span-2" error={errors.clientId}>
            {client ? (
              <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-25 px-3 py-2 text-sm">
                <span className="font-medium">{client.name}</span>
                {!fixedClient && (
                  <Button variant="ghost" size="sm" onClick={() => setClient(null)}>
                    Trocar
                  </Button>
                )}
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                  <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" autoFocus />
                </div>
                <ul className="mt-1 max-h-44 overflow-auto rounded-xl border border-line">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button className="w-full px-3 py-2 text-left text-sm hover:bg-brand-25" onClick={() => setClient(c)}>
                        {c.name}
                      </button>
                    </li>
                  ))}
                  {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nenhum cliente encontrado.</li>}
                </ul>
              </div>
            )}
          </Field>
          <Field label="Valor" required error={errors.amountCents}>
            <MoneyInput value={f.amountCents} onChange={(v) => setF({ ...f, amountCents: v })} />
          </Field>
          <Field label="Validade" hint="Prazo para usar o crédito junto ao fornecedor" error={errors.expiresAt}>
            <Input type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
          </Field>
          <Field label="Motivo" required className="sm:col-span-2" error={errors.reason}>
            <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
          <Field label="Onde está o crédito" hint="Operadora, companhia aérea ou a própria agência" className="sm:col-span-2">
            <Input value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function CreditRowActions({ id, clientId, canCancel }: { id: string; clientId: string; canCancel: boolean }) {
  const { run, busy } = useAction();
  const [use, setUse] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [sales, setSales] = useState<{ id: string; code: string; destination: string | null; saleDate: string }[]>([]);
  const [saleId, setSaleId] = useState("");
  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          const r = await creditSalesOptionsAction(clientId);
          if (r.ok) {
            setSales(r.data);
            setSaleId(r.data[0]?.id ?? "");
          }
          setUse(true);
        }}
      >
        <ArrowRightLeft className="h-3.5 w-3.5" /> Usar em venda
      </Button>
      {canCancel && (
        <Button variant="ghost" size="sm" onClick={() => setCancel(true)} aria-label="Cancelar crédito">
          <Ban className="h-3.5 w-3.5" />
        </Button>
      )}
      <Modal
        open={use}
        onClose={() => setUse(false)}
        title="Usar crédito em uma venda"
        description="O crédito fica registrado como consumido pela venda escolhida."
        footer={
          <Button loading={busy} disabled={!saleId} onClick={() => run(() => consumeCreditAction(id, saleId), { onSuccess: () => setUse(false) })}>
            Confirmar uso
          </Button>
        }
      >
        {sales.length === 0 ? (
          <p className="text-sm text-muted">Este cliente não tem vendas ativas. Registre a nova venda e volte aqui.</p>
        ) : (
          <Field label="Venda">
            <Select value={saleId} onChange={(e) => setSaleId(e.target.value)}>
              {sales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.destination ?? "sem destino"} · {formatDate(s.saleDate)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Modal>
      <ConfirmDialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="Cancelar crédito?"
        description="Use quando o crédito expirou ou foi devolvido em dinheiro. O registro continua no histórico."
        confirmLabel="Cancelar crédito"
        onConfirm={async () => {
          await run(() => cancelCreditAction(id), { onSuccess: () => setCancel(false) });
        }}
      />
    </div>
  );
}
