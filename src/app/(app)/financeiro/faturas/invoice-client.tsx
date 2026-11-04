"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, CheckCheck, Banknote, Undo2, Ban, Scale, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ConfirmDialog, Modal, MoneyInput } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import {
  addInvoiceItemsAction,
  cancelInvoiceAction,
  checkInvoiceAction,
  createInvoiceAction,
  payInvoiceAction,
  registerInvoiceDifferenceAction,
  removeInvoiceItemAction,
  reopenInvoiceAction,
} from "@/app/actions";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PAYMENT_METHODS } from "@/lib/constants";

type Opt = { id: string; name: string };

export function NewInvoiceButton({ suppliers, today }: { suppliers: Opt[]; today: string }) {
  const router = useRouter();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ supplierId: suppliers[0]?.id ?? "", number: "", issueDate: today, dueDate: today, declaredCents: 0, notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Receber fatura
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Receber fatura de fornecedor"
        description="Informe os dados da fatura. Em seguida, vincule os lançamentos cobrados e confira os valores."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(() => createInvoiceAction(f), { refresh: false, onSuccess: (id) => router.push(`/financeiro/faturas/${id}`) });
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Registrar fatura
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fornecedor (operadora/consolidadora)" required className="sm:col-span-2" error={errors.supplierId}>
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Número da fatura" required error={errors.number}>
            <Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
          </Field>
          <Field label="Valor cobrado na fatura" required error={errors.declaredCents}>
            <MoneyInput value={f.declaredCents} onChange={(v) => setF({ ...f, declaredCents: v })} />
          </Field>
          <Field label="Emissão" required>
            <Input type="date" value={f.issueDate} onChange={(e) => setF({ ...f, issueDate: e.target.value })} />
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

type Candidate = { id: string; description: string; dueDate: string; amountCents: number; balanceCents: number; sale: { code: string; client: { name: string } } | null };

export function AddItems({ invoiceId, candidates }: { invoiceId: string; candidates: Candidate[] }) {
  const { run, busy } = useAction();
  const [sel, setSel] = useState<string[]>([]);
  if (!candidates.length) return <p className="px-5 py-5 text-sm text-muted">Não há outros lançamentos em aberto deste fornecedor.</p>;
  const total = candidates.filter((c) => sel.includes(c.id)).reduce((a, c) => a + c.amountCents, 0);
  return (
    <div>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
              <input type="checkbox" className="h-4 w-4 rounded border-line accent-brand-600" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{c.description}</span>
                <span className="block text-xs text-muted">
                  {c.sale ? `${c.sale.code} · ${c.sale.client.name} · ` : ""}vence {formatDate(c.dueDate)}
                </span>
              </span>
              <span className="tabular">{formatBRL(c.amountCents)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
        <span className="text-xs text-muted">
          {sel.length} selecionado(s) · {formatBRL(total)}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSel(sel.length === candidates.length ? [] : candidates.map((c) => c.id))}>
            {sel.length === candidates.length ? "Limpar" : "Selecionar todos"}
          </Button>
          <Button size="sm" disabled={!sel.length} loading={busy} onClick={() => run(() => addInvoiceItemsAction(invoiceId, sel), { onSuccess: () => setSel([]) })}>
            Vincular à fatura
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RemoveItemButton({ invoiceId, payableId }: { invoiceId: string; payableId: string }) {
  const { run, busy } = useAction();
  return (
    <Button variant="ghost" size="sm" loading={busy} onClick={() => run(() => removeInvoiceItemAction(invoiceId, payableId))} aria-label="Remover da fatura">
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

export function InvoiceActions({
  id,
  status,
  divergenceCents,
  openCents,
  accounts,
  today,
  hasPayments,
}: {
  id: string;
  status: string;
  divergenceCents: number;
  openCents: number;
  accounts: Opt[];
  today: string;
  hasPayments: boolean;
}) {
  const { run, busy } = useAction();
  const [pay, setPay] = useState(false);
  const [diff, setDiff] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [p, setP] = useState({ date: today, accountId: accounts[0]?.id ?? "", method: "TRANSFERENCIA", notes: "" });
  return (
    <>
      {status === "ABERTA" && divergenceCents > 0 && (
        <Button variant="outline" onClick={() => setDiff(true)}>
          <Scale className="h-4 w-4" /> Registrar diferença
        </Button>
      )}
      {status === "ABERTA" && (
        <Button variant={divergenceCents === 0 ? "primary" : "outline"} loading={busy} disabled={divergenceCents !== 0} onClick={() => run(() => checkInvoiceAction(id))} title={divergenceCents !== 0 ? "Resolva a divergência antes de conferir" : undefined}>
          <CheckCheck className="h-4 w-4" /> Marcar como conferida
        </Button>
      )}
      {status === "CONFERIDA" && (
        <>
          {!hasPayments && (
            <Button variant="ghost" loading={busy} onClick={() => run(() => reopenInvoiceAction(id))}>
              <Undo2 className="h-4 w-4" /> Reabrir
            </Button>
          )}
          <Button onClick={() => setPay(true)}>
            <Banknote className="h-4 w-4" /> Registrar pagamento
          </Button>
        </>
      )}
      {(status === "ABERTA" || status === "CONFERIDA") && !hasPayments && (
        <Button variant="ghost" onClick={() => setCancel(true)}>
          <Ban className="h-4 w-4" /> Cancelar
        </Button>
      )}
      <Modal
        open={pay}
        onClose={() => setPay(false)}
        title="Pagamento da fatura"
        description={`Baixa o saldo de todos os lançamentos da fatura (${formatBRL(openCents)}) numa única operação.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setPay(false)}>
              Voltar
            </Button>
            <Button loading={busy} disabled={!p.accountId} onClick={() => run(() => payInvoiceAction(id, p), { onSuccess: () => setPay(false) })}>
              Confirmar pagamento de {formatBRL(openCents)}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data do pagamento" required>
            <Input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} />
          </Field>
          <Field label="Conta de saída" required>
            <Select value={p.accountId} onChange={(e) => setP({ ...p, accountId: e.target.value })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Forma">
            <Select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>
              {PAYMENT_METHODS.values.map((v) => (
                <option key={v} value={v}>
                  {PAYMENT_METHODS.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
      <ConfirmDialog
        open={diff}
        onClose={() => setDiff(false)}
        title="Registrar diferença da fatura"
        danger={false}
        description={`O fornecedor cobrou ${formatBRL(divergenceCents)} a mais que o sistema. A diferença será lançada como conta a pagar dentro desta fatura (ex.: taxa administrativa, ajuste de tarifa).`}
        confirmLabel="Registrar"
        reason={{ label: "Motivo da diferença", required: true }}
        onConfirm={async (reason) => {
          await run(() => registerInvoiceDifferenceAction(id, reason), { onSuccess: () => setDiff(false) });
        }}
      />
      <ConfirmDialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="Cancelar fatura"
        description="Os lançamentos voltam a ficar avulsos em contas a pagar. Ajustes registrados nesta fatura são cancelados."
        confirmLabel="Cancelar fatura"
        onConfirm={async () => {
          await run(() => cancelInvoiceAction(id), { onSuccess: () => setCancel(false) });
        }}
      />
    </>
  );
}
