"use client";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { useAction, issuesToMap } from "@/components/use-action";
import { saveClientAction } from "@/app/actions";
import { formatDocument } from "@/lib/utils";

export type ClientFormData = {
  name: string;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  birthDate: string | null;
  zipCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  consentMessaging: boolean;
};

const empty: ClientFormData = {
  name: "",
  document: "",
  phone: "",
  whatsapp: "",
  email: "",
  birthDate: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  notes: "",
  consentMessaging: false,
};

export function ClientForm({
  id,
  initial,
  compact,
  onSaved,
  onCancel,
}: {
  id?: string | null;
  initial?: Partial<ClientFormData>;
  compact?: boolean;
  onSaved?: (c: { id: string; name: string }) => void;
  onCancel?: () => void;
}) {
  const [d, setD] = useState<ClientFormData>({ ...empty, ...initial, document: initial?.document ? formatDocument(initial.document) : "" } as ClientFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const set = (k: keyof ClientFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => saveClientAction(id ?? null, d), { onSuccess: (c) => onSaved?.(c) });
    setErrors(r.ok ? {} : issuesToMap(r.issues));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome completo" required error={errors.name} className="sm:col-span-2">
          <Input value={d.name} onChange={set("name")} autoFocus required />
        </Field>
        <Field label="CPF ou CNPJ" error={errors.document} hint="Necessário para emitir contrato.">
          <Input value={d.document ?? ""} onChange={set("document")} inputMode="numeric" />
        </Field>
        <Field label="WhatsApp" error={errors.whatsapp}>
          <Input value={d.whatsapp ?? ""} onChange={set("whatsapp")} inputMode="tel" placeholder="(42) 99999-0000" />
        </Field>
        <Field label="E-mail" error={errors.email}>
          <Input type="email" value={d.email ?? ""} onChange={set("email")} />
        </Field>
        {!compact && (
          <>
            <Field label="Telefone">
              <Input value={d.phone ?? ""} onChange={set("phone")} inputMode="tel" />
            </Field>
            <Field label="Data de nascimento" error={errors.birthDate}>
              <Input type="date" value={d.birthDate ?? ""} onChange={set("birthDate")} />
            </Field>
          </>
        )}
      </div>
      <details className="rounded-lg border border-line px-4 py-3" open={!compact}>
        <summary className="cursor-pointer text-sm font-medium text-slate-700">Endereço (usado no contrato)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-6">
          <Field label="CEP" className="sm:col-span-2">
            <Input value={d.zipCode ?? ""} onChange={set("zipCode")} inputMode="numeric" />
          </Field>
          <Field label="Rua" className="sm:col-span-4">
            <Input value={d.street ?? ""} onChange={set("street")} />
          </Field>
          <Field label="Número" className="sm:col-span-1">
            <Input value={d.number ?? ""} onChange={set("number")} />
          </Field>
          <Field label="Complemento" className="sm:col-span-2">
            <Input value={d.complement ?? ""} onChange={set("complement")} />
          </Field>
          <Field label="Bairro" className="sm:col-span-3">
            <Input value={d.district ?? ""} onChange={set("district")} />
          </Field>
          <Field label="Cidade" className="sm:col-span-4">
            <Input value={d.city ?? ""} onChange={set("city")} />
          </Field>
          <Field label="UF" className="sm:col-span-2" error={errors.state}>
            <Input value={d.state ?? ""} maxLength={2} onChange={(e) => setD({ ...d, state: e.target.value.toUpperCase() })} />
          </Field>
        </div>
      </details>
      {!compact && (
        <Field label="Observações operacionais">
          <Textarea value={d.notes ?? ""} onChange={set("notes")} placeholder="Preferências, restrições, observações de atendimento…" />
        </Field>
      )}
      <label className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={d.consentMessaging} onChange={(e) => setD({ ...d, consentMessaging: e.target.checked })} />
        <span>
          <span className="font-medium">Cliente autorizou comunicações automáticas</span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" /> Lembretes e mensagens automáticas só são disparados com este consentimento (LGPD).
          </span>
        </span>
      </label>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={busy}>
          Salvar cliente
        </Button>
      </div>
    </form>
  );
}
