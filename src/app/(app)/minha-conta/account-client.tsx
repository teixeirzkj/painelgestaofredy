"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { PasswordInput } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { changePasswordAction, updateMeAction } from "@/app/actions";

export function ProfileForm({ initial }: { initial: { name: string; email: string; phone: string; birthDate: string } }) {
  const { run, busy } = useAction();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => updateMeAction({ name: f.name, phone: f.phone, birthDate: f.birthDate }));
        setErrors(r.ok ? {} : issuesToMap(r.issues));
      }}
    >
      <Field label="Nome" required error={errors.name} className="sm:col-span-2">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="E-mail de login" hint="Para trocar o e-mail, fale com o administrador da agência.">
        <Input value={f.email} disabled />
      </Field>
      <Field label="Telefone">
        <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" />
      </Field>
      <Field label="Data de nascimento" hint="Aparece na lista de aniversariantes da equipe." error={errors.birthDate}>
        <Input type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} />
      </Field>
      <div className="flex items-end justify-end sm:col-span-2">
        <Button type="submit" loading={busy}>
          Salvar dados
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const { run, busy } = useAction();
  const blank = { current: "", next: "", confirm: "" };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => changePasswordAction(f), { onSuccess: () => setF(blank) });
        setErrors(r.ok ? {} : issuesToMap(r.issues));
      }}
    >
      <Field label="Senha atual" error={errors.current}>
        <PasswordInput autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
      </Field>
      <Field label="Nova senha" hint="Mínimo de 8 caracteres." error={errors.next}>
        <PasswordInput autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
      </Field>
      <Field label="Confirmar nova senha" error={errors.confirm}>
        <PasswordInput autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!f.current || !f.next}>
          Alterar senha
        </Button>
      </div>
    </form>
  );
}
