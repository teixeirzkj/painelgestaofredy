"use client";
import { useState } from "react";
import { Plus, Pencil, ArrowLeftRight, Undo2, Power } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog, Modal, MoneyInput } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { createTransferAction, reverseTransferAction, saveAccountAction, setAccountActiveAction } from "@/app/actions";
import { ACCOUNT_TYPES } from "@/lib/constants";

type Account = { id: string; name: string; type: string; bankName: string | null; initialBalanceCents: number };

export function AccountButton({ account }: { account?: Account }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ name: account?.name ?? "", type: account?.type ?? "BANCO", bankName: account?.bankName ?? "", initialBalanceCents: account?.initialBalanceCents ?? 0 });
  const { run, busy } = useAction();
  return (
    <>
      {account ? (
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Editar conta">
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Nova conta
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={account ? "Editar conta" : "Nova conta financeira"}
        size="sm"
        footer={
          <Button loading={busy} onClick={() => run(() => saveAccountAction(account?.id ?? null, d), { onSuccess: () => setOpen(false) })}>
            Salvar
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required>
            <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ex.: Sicredi conta corrente" />
          </Field>
          <Field label="Tipo">
            <Select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}>
              {ACCOUNT_TYPES.values.map((v) => (
                <option key={v} value={v}>
                  {ACCOUNT_TYPES.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Banco / instituição">
            <Input value={d.bankName} onChange={(e) => setD({ ...d, bankName: e.target.value })} />
          </Field>
          <Field label="Saldo inicial" hint="Não pode ser alterado depois que houver movimentação.">
            <MoneyInput value={d.initialBalanceCents} onChange={(v) => setD({ ...d, initialBalanceCents: v })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function AccountToggle({ id, active }: { id: string; active: boolean }) {
  const { run } = useAction();
  return (
    <Button variant="ghost" size="icon" title={active ? "Desativar" : "Reativar"} aria-label={active ? "Desativar conta" : "Reativar conta"} onClick={() => run(() => setAccountActiveAction(id, !active))}>
      <Power className="h-4 w-4" />
    </Button>
  );
}

export function TransferButton({ accounts, todayStr }: { accounts: { id: string; name: string }[]; todayStr: string }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ fromAccountId: accounts[0].id, toAccountId: accounts[1].id, amountCents: 0, date: todayStr, description: "" });
  const { run, busy } = useAction();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <ArrowLeftRight className="h-4 w-4" /> Transferir
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Transferência entre contas"
        size="sm"
        footer={
          <Button loading={busy} onClick={() => run(() => createTransferAction(d), { onSuccess: () => setOpen(false) })}>
            Registrar
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="De">
            <Select value={d.fromAccountId} onChange={(e) => setD({ ...d, fromAccountId: e.target.value })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Para">
            <Select value={d.toAccountId} onChange={(e) => setD({ ...d, toAccountId: e.target.value })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" required>
            <MoneyInput value={d.amountCents} onChange={(v) => setD({ ...d, amountCents: v })} />
          </Field>
          <Field label="Data">
            <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
          </Field>
          <Field label="Descrição">
            <Input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Ex.: depósito do caixa" />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function ReverseTransferButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const { run } = useAction();
  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Estornar transferência" onClick={() => setOpen(true)}>
        <Undo2 className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Estornar transferência?"
        description="Os saldos das duas contas voltam ao estado anterior. O registro é mantido como estornado."
        confirmLabel="Estornar"
        onConfirm={async () => {
          await run(() => reverseTransferAction(id), { onSuccess: () => setOpen(false) });
        }}
      />
    </>
  );
}
