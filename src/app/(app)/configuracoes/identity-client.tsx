"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageUp, Trash2, Loader2, Plane } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { useAction, issuesToMap } from "@/components/use-action";
import { updateCompanyProfileAction } from "@/app/actions";

/** Logo da agência: aparece no topo do menu lateral. */
export function LogoUploader({ hasLogo }: { hasLogo: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(() => Date.now());

  async function send(fd: FormData, ok: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/agencia/logo", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Falha ao enviar.");
      toast.success(ok);
      setVersion(Date.now());
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-brand-25">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/agencia/logo?v=${version}`} alt="Logo da agência" className="h-full w-full object-contain p-2" />
        ) : (
          <Plane className="h-8 w-8 -rotate-12 text-brand-300" />
        )}
      </span>
      <div className="space-y-2">
        <p className="text-sm text-muted">PNG, JPG ou WEBP até 1 MB. Prefira imagem quadrada com fundo transparente.</p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const fd = new FormData();
              fd.set("file", file);
              send(fd, "Logo atualizada.");
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />} {hasLogo ? "Trocar logo" : "Enviar logo"}
          </Button>
          {hasLogo && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                const fd = new FormData();
                fd.set("remove", "1");
                send(fd, "Logo removida.");
              }}
            >
              <Trash2 className="h-4 w-4" /> Remover
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type Profile = {
  name: string;
  tradeName: string;
  document: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  responsibleName: string;
  responsibleDocument: string;
  responsibleRole: string;
};

/** Dados da agência e do responsável legal (usados em contratos e documentos). */
export function CompanyProfileForm({ initial }: { initial: Profile }) {
  const { run, busy } = useAction();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => updateCompanyProfileAction(f));
        setErrors(r.ok ? {} : issuesToMap(r.issues));
      }}
    >
      <Field label="Razão social" required error={errors.name}>
        <Input value={f.name} onChange={set("name")} />
      </Field>
      <Field label="Nome fantasia">
        <Input value={f.tradeName} onChange={set("tradeName")} />
      </Field>
      <Field label="CNPJ">
        <Input value={f.document} onChange={set("document")} inputMode="numeric" />
      </Field>
      <Field label="Telefone">
        <Input value={f.contactPhone} onChange={set("contactPhone")} inputMode="tel" />
      </Field>
      <Field label="E-mail de contato">
        <Input type="email" value={f.contactEmail} onChange={set("contactEmail")} />
      </Field>
      <Field label="Endereço">
        <Input value={f.address} onChange={set("address")} />
      </Field>
      <p className="pt-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:col-span-2">Responsável legal (assina os contratos)</p>
      <Field label="Nome">
        <Input value={f.responsibleName} onChange={set("responsibleName")} />
      </Field>
      <Field label="CPF">
        <Input value={f.responsibleDocument} onChange={set("responsibleDocument")} inputMode="numeric" />
      </Field>
      <Field label="Cargo">
        <Input value={f.responsibleRole} onChange={set("responsibleRole")} placeholder="Ex.: Sócia-administradora" />
      </Field>
      <div className="flex items-end justify-end">
        <Button type="submit" loading={busy}>
          Salvar identidade
        </Button>
      </div>
    </form>
  );
}
