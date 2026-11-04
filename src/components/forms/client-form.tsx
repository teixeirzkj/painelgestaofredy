"use client";
import { useState } from "react";
import { ShieldCheck, User, Building } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { useAction, issuesToMap } from "@/components/use-action";
import { saveClientAction } from "@/app/actions";
import { cn, formatDocument } from "@/lib/utils";

export type ClientFormData = {
  personType: string;
  name: string;
  tradeName: string | null;
  document: string | null;
  rg: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  specialNeeds: string | null;
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
  personType: "PF",
  name: "",
  tradeName: "",
  document: "",
  rg: "",
  passportNumber: "",
  passportExpiry: "",
  specialNeeds: "",
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
  const base = Object.fromEntries(Object.entries({ ...empty, ...initial }).map(([k, v]) => [k, v ?? (typeof empty[k as keyof ClientFormData] === "boolean" ? false : "")])) as ClientFormData;
  const [d, setD] = useState<ClientFormData>({ ...base, document: initial?.document ? formatDocument(initial.document) : "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const set = (k: keyof ClientFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  const pj = d.personType === "PJ";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => saveClientAction(id ?? null, d), { onSuccess: (c) => onSaved?.(c) });
    setErrors(r.ok ? {} : issuesToMap(r.issues));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="inline-flex rounded-lg border border-line bg-slate-50 p-0.5" role="radiogroup" aria-label="Tipo de pessoa">
        {[
          { v: "PF", label: "Pessoa física", Icon: User },
          { v: "PJ", label: "Pessoa jurídica", Icon: Building },
        ].map(({ v, label, Icon }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={d.personType === v}
            onClick={() => setD({ ...d, personType: v })}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors", d.personType === v ? "bg-white text-brand-700 shadow-sm" : "text-muted hover:text-ink")}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={pj ? "Razão social" : "Nome completo"} required error={errors.name} className="sm:col-span-2">
          <Input value={d.name} onChange={set("name")} autoFocus required />
        </Field>
        {pj && (
          <Field label="Nome fantasia" className="sm:col-span-2">
            <Input value={d.tradeName ?? ""} onChange={set("tradeName")} />
          </Field>
        )}
        <Field label={pj ? "CNPJ" : "CPF"} error={errors.document} hint="Necessário para emitir contrato.">
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
            {!pj && (
              <Field label="Data de nascimento" error={errors.birthDate}>
                <Input type="date" value={d.birthDate ?? ""} onChange={set("birthDate")} />
              </Field>
            )}
          </>
        )}
      </div>
      {!compact && !pj && (
        <details className="rounded-xl border border-line px-4 py-3" open={!!(d.rg || d.passportNumber || d.specialNeeds)}>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Documentos de viagem (opcional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="RG">
              <Input value={d.rg ?? ""} onChange={set("rg")} autoComplete="off" />
            </Field>
            <Field label="Passaporte">
              <Input value={d.passportNumber ?? ""} onChange={set("passportNumber")} autoComplete="off" />
            </Field>
            <Field label="Validade do passaporte" error={errors.passportExpiry} hint="Alertamos se vencer em menos de 6 meses de uma viagem.">
              <Input type="date" value={d.passportExpiry ?? ""} onChange={set("passportExpiry")} />
            </Field>
            <Field label="Necessidades especiais / restrições" className="sm:col-span-3">
              <Input value={d.specialNeeds ?? ""} onChange={set("specialNeeds")} placeholder="Ex.: mobilidade reduzida, restrição alimentar" />
            </Field>
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
            <ShieldCheck className="h-3 w-3" /> Dados sensíveis: colete apenas quando o produto exigir. São exibidos mascarados.
          </p>
        </details>
      )}
      <details className="rounded-xl border border-line px-4 py-3" open={!compact}>
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
          <Textarea value={d.notes ?? ""} onChange={set("notes")} placeholder="Preferências, observações de atendimento…" />
        </Field>
      )}
      <label className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 accent-brand-600" checked={d.consentMessaging} onChange={(e) => setD({ ...d, consentMessaging: e.target.checked })} />
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
          Salvar cadastro
        </Button>
      </div>
    </form>
  );
}
