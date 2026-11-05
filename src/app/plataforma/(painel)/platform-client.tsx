"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, KeyRound, Copy, PauseCircle, PlayCircle, UserPlus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog, Modal } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { addCompanyAdminAction, createCompanyAccountAction, resetUserPasswordAction, setCompanyActiveAction, updateCompanyPlanAction } from "../actions";

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function Credentials({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const text = `Acesso ao Frédy Gestão\nEndereço: ${typeof window !== "undefined" ? window.location.origin : ""}/login\nE-mail: ${email}\nSenha provisória: ${password}\nTroque a senha em "Minha conta" no primeiro acesso.`;
  return (
    <Modal
      open
      onClose={onClose}
      title="Acesso criado"
      description="Copie e envie ao cliente por um canal seguro. A senha não será exibida novamente."
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(text);
              toast.success("Dados de acesso copiados.");
            }}
          >
            <Copy className="h-4 w-4" /> Copiar
          </Button>
          <Button onClick={onClose}>Concluir</Button>
        </>
      }
    >
      <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-ink">{text}</pre>
    </Modal>
  );
}

export function NewCompanyButton() {
  const router = useRouter();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ id: string; email: string; password: string } | null>(null);
  const blank = { name: "", document: "", plan: "PADRAO", maxUsers: 5, adminName: "", adminEmail: "", adminPassword: genPassword() };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <>
      <Button
        onClick={() => {
          setF({ ...blank, adminPassword: genPassword() });
          setErrors({});
          setOpen(true);
        }}
      >
        <Plus className="h-4 w-4" /> Nova agência
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nova agência"
        description="Cria a conta, a conta financeira inicial, as categorias padrão e o primeiro administrador."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(() => createCompanyAccountAction(f), {
                  success: false,
                  onSuccess: (d) => {
                    setOpen(false);
                    setDone({ id: d.id, email: f.adminEmail, password: f.adminPassword });
                  },
                });
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Criar agência
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da agência" required className="sm:col-span-2" error={errors.name}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="CNPJ">
            <Input value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} />
          </Field>
          <Field label="Plano / limite de usuários">
            <div className="flex gap-2">
              <Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
                <option value="PADRAO">Padrão</option>
                <option value="PROFISSIONAL">Profissional</option>
                <option value="EMPRESARIAL">Empresarial</option>
              </Select>
              <Input type="number" min={1} value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: Number(e.target.value) })} className="w-24" aria-label="Limite de usuários" />
            </div>
          </Field>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted sm:col-span-2">Administrador da agência</p>
          <Field label="Nome" required error={errors.adminName}>
            <Input value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} />
          </Field>
          <Field label="E-mail de login" required error={errors.adminEmail}>
            <Input type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} />
          </Field>
          <Field label="Senha provisória" required error={errors.adminPassword} hint="O cliente troca no primeiro acesso, em Minha conta." className="sm:col-span-2">
            <div className="flex gap-2">
              <Input value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} className="font-mono" />
              <Button type="button" variant="outline" onClick={() => setF({ ...f, adminPassword: genPassword() })}>
                <Wand2 className="h-4 w-4" /> Gerar
              </Button>
            </div>
          </Field>
        </div>
      </Modal>
      {done && (
        <Credentials
          email={done.email}
          password={done.password}
          onClose={() => {
            const id = done.id;
            setDone(null);
            router.push(`/plataforma/agencias/${id}`);
          }}
        />
      )}
    </>
  );
}

export function CompanyActions({ id, active, plan, maxUsers }: { id: string; active: boolean; plan: string; maxUsers: number }) {
  const { run, busy } = useAction();
  const [suspend, setSuspend] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [p, setP] = useState({ plan, maxUsers });
  return (
    <>
      <Button variant="outline" onClick={() => setPlanOpen(true)}>
        Plano e limite
      </Button>
      {active ? (
        <Button variant="outline" onClick={() => setSuspend(true)}>
          <PauseCircle className="h-4 w-4" /> Suspender
        </Button>
      ) : (
        <Button loading={busy} onClick={() => run(() => setCompanyActiveAction(id, true))}>
          <PlayCircle className="h-4 w-4" /> Reativar
        </Button>
      )}
      <ConfirmDialog
        open={suspend}
        onClose={() => setSuspend(false)}
        title="Suspender agência"
        description="Ninguém da agência conseguirá entrar até a reativação. Os dados são preservados."
        confirmLabel="Suspender"
        reason={{ label: "Motivo", required: true }}
        onConfirm={async (reason) => {
          await run(() => setCompanyActiveAction(id, false, reason), { onSuccess: () => setSuspend(false) });
        }}
      />
      <Modal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Plano e limite de usuários"
        footer={
          <Button loading={busy} onClick={() => run(() => updateCompanyPlanAction(id, p), { onSuccess: () => setPlanOpen(false) })}>
            Salvar
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plano">
            <Select value={p.plan} onChange={(e) => setP({ ...p, plan: e.target.value })}>
              <option value="PADRAO">Padrão</option>
              <option value="PROFISSIONAL">Profissional</option>
              <option value="EMPRESARIAL">Empresarial</option>
            </Select>
          </Field>
          <Field label="Limite de usuários ativos">
            <Input type="number" min={1} value={p.maxUsers} onChange={(e) => setP({ ...p, maxUsers: Number(e.target.value) })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function ResetPasswordButton({ companyId, userId, email }: { companyId: string; userId: string; email: string }) {
  const { run, busy } = useAction();
  const [done, setDone] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        onClick={async () => {
          const pwd = genPassword();
          const r = await run(() => resetUserPasswordAction(companyId, userId, pwd), { success: false });
          if (r.ok) setDone(pwd);
        }}
      >
        <KeyRound className="h-4 w-4" /> Nova senha
      </Button>
      {done && <Credentials email={email} password={done} onClose={() => setDone(null)} />}
    </>
  );
}

export function AddAdminButton({ companyId }: { companyId: string }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: genPassword() });
  const [done, setDone] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => (setF({ name: "", email: "", password: genPassword() }), setOpen(true))}>
        <UserPlus className="h-4 w-4" /> Adicionar administrador
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Adicionar administrador"
        footer={
          <Button loading={busy} onClick={() => run(() => addCompanyAdminAction(companyId, f), { success: false, onSuccess: () => (setOpen(false), setDone(true)) })}>
            Criar acesso
          </Button>
        }
      >
        <div className="grid gap-4">
          <Field label="Nome">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="E-mail de login">
            <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Senha provisória">
            <Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="font-mono" />
          </Field>
        </div>
      </Modal>
      {done && <Credentials email={f.email} password={f.password} onClose={() => setDone(false)} />}
    </>
  );
}
