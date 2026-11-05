"use client";
import { useActionState } from "react";
import { platformLoginAction } from "../actions";
import { Button, Field, Input } from "@/components/ui";
import { PasswordInput } from "@/components/ui/client";

export function PlatformLoginForm() {
  const [state, action, pending] = useActionState(platformLoginAction, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <Field label="E-mail">
        <Input name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Senha">
        <PasswordInput name="password" autoComplete="current-password" required />
      </Field>
      {state?.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <Button type="submit" className="w-full" size="lg" loading={pending}>
        Entrar
      </Button>
    </form>
  );
}
