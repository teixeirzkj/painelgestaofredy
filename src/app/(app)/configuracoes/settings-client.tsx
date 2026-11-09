"use client";
import { useState } from "react";
import { Plus, Pencil, KeyRound, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button, Card, CardHeader, Field, Input, Select, Notice } from "@/components/ui";
import { Modal, PasswordInput } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { rotateApiKeyAction, saveUserAction, sendTestWebhookAction, setRolePermissionAction, updateCompanyAction } from "@/app/actions";
import { ROLES } from "@/lib/constants";
import { cn } from "@/lib/utils";

type Company = { name: string; document: string; timezone: string; commissionPayDay: number; upcomingDueDays: number; upcomingTripDays: number; webhookUrl?: string; webhookSecret?: string };

export function CompanyForm({ initial }: { initial: Company }) {
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => updateCompanyAction(d));
        if (!r.ok) setErrors(issuesToMap(r.issues));
      }}
    >
      <Field label="Nome da agência" required error={errors.name}>
        <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label="CNPJ">
        <Input value={d.document} onChange={(e) => setD({ ...d, document: e.target.value })} />
      </Field>
      <Field label="Fuso horário" error={errors.timezone} hint="Define o 'hoje' para vencimentos e alertas.">
        <Select value={d.timezone} onChange={(e) => setD({ ...d, timezone: e.target.value })}>
          {["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Rio_Branco", "America/Noronha"].map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace("America/", "").replace("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Dia de pagamento das comissões" hint="Dia do mês seguinte à venda">
        <Input type="number" min={1} max={28} value={d.commissionPayDay} onChange={(e) => setD({ ...d, commissionPayDay: Number(e.target.value) })} />
      </Field>
      <Field label="Alertar vencimentos com antecedência de (dias)">
        <Input type="number" min={1} max={60} value={d.upcomingDueDays} onChange={(e) => setD({ ...d, upcomingDueDays: Number(e.target.value) })} />
      </Field>
      <Field label="Considerar 'viagem próxima' com (dias)">
        <Input type="number" min={1} max={90} value={d.upcomingTripDays} onChange={(e) => setD({ ...d, upcomingTripDays: Number(e.target.value) })} />
      </Field>
      <div className="sm:col-span-2 flex justify-end">
        <Button type="submit" loading={busy}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

export function IntegrationsForm({ hasApiKey, webhookUrl, hasSecret, base }: { hasApiKey: boolean; webhookUrl: string; hasSecret: boolean; base: Omit<Company, "webhookUrl" | "webhookSecret"> }) {
  const [url, setUrl] = useState(webhookUrl);
  const [secret, setSecret] = useState(hasSecret ? "••••••••" : "");
  const [key, setKey] = useState<string | null>(null);
  const { run, busy } = useAction();
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Webhook de eventos" description="Envia cada evento (venda confirmada, pagamento identificado…) via POST JSON." />
        <div className="space-y-4 p-5">
          <Field label="URL de destino (https)" hint="Ex.: um sistema externo que recebe os eventos da gestão.">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Segredo para assinatura HMAC" hint="Enviado como X-Fredy-Signature (SHA-256 do corpo).">
            <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
          </Field>
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-muted">
            Eventos enviados: venda.confirmada, pagamento.identificado, viagem.concluida e contrato.assinado. Ative cada um em Automações.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" loading={busy} disabled={!url} onClick={() => run(() => sendTestWebhookAction())}>
              Enviar evento de teste
            </Button>
            <Button loading={busy} onClick={() => run(() => updateCompanyAction({ ...base, webhookUrl: url, webhookSecret: secret }))}>
              Salvar webhook
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="API de eventos (consulta)" description="Para o Frédy consultar eventos pendentes: GET /api/v1/eventos com Authorization: Bearer <chave>." />
        <div className="space-y-4 p-5 text-sm">
          <p>{hasApiKey ? "Uma chave está ativa. Gerar outra invalida a anterior." : "Nenhuma chave gerada."}</p>
          {key && (
            <Notice tone="amber" title="Copie agora: a chave não será exibida novamente">
              <span className="flex items-center gap-2">
                <code className="break-all">{key}</code>
                <Button size="sm" variant="outline" onClick={() => (navigator.clipboard?.writeText(key), toast.success("Copiada."))}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </span>
            </Notice>
          )}
          <Button variant="outline" loading={busy} onClick={() => run(() => rotateApiKeyAction(), { success: "Nova chave gerada.", onSuccess: setKey })}>
            <KeyRound className="h-4 w-4" /> {hasApiKey ? "Gerar nova chave" : "Gerar chave"}
          </Button>
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Pendências de integração" />
        <ul className="list-disc space-y-1.5 p-5 pl-10 text-sm text-slate-700">
          <li>
            <strong>CRM Frédy (nativo):</strong> adaptador <code>FredyCrmAdapter</code> criado e desativado — aguarda definição de endpoint, autenticação e formato pela equipe Frédy.
          </li>
          <li>
            <strong>Assinatura eletrônica:</strong> webhook <code>/api/webhooks/assinatura</code> pronto; requer contratação de provedor e <code>SIGNATURE_WEBHOOK_SECRET</code>.
          </li>
          <li>
            <strong>Bancos:</strong> conciliação por CSV disponível; integração automática (Open Finance) depende de credenciais e homologação.
          </li>
          <li>
            <strong>Agendamento:</strong> configure um cron chamando <code>POST /api/cron/automacoes</code> com <code>CRON_SECRET</code> para lembretes e eventos de viagem.
          </li>
        </ul>
      </Card>
    </div>
  );
}

export function PermissionToggle({ role, permission, allowed }: { role: string; permission: string; allowed: boolean | null }) {
  const { run, busy } = useAction();
  const isDefaultOn = role === "GESTOR" && (permission === "finance.view" || permission === "reports.financial");
  const on = allowed ?? isDefaultOn;
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={() => run(() => setRolePermissionAction(role, permission, !on))}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", on ? "bg-brand-600" : "bg-slate-300")}
    >
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

type U = { id: string; name: string; email: string; role: string; active: boolean; commissionRateBps: number };

export function UserButton({ user }: { user?: U }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ name: user?.name ?? "", email: user?.email ?? "", role: user?.role ?? "VENDEDOR", active: user?.active ?? true, commissionRateBps: user?.commissionRateBps ?? 0, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  return (
    <>
      {user ? (
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Editar usuário">
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={user ? "Editar usuário" : "Novo usuário"}
        size="sm"
        footer={
          <Button
            loading={busy}
            onClick={async () => {
              const r = await run(() => saveUserAction(user?.id ?? null, { ...d, password: d.password || null }), { onSuccess: () => setOpen(false) });
              if (!r.ok) setErrors(issuesToMap(r.issues));
            }}
          >
            Salvar
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Nome" required error={errors.name}>
            <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </Field>
          <Field label="E-mail" required error={errors.email}>
            <Input type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
          </Field>
          <Field label="Perfil">
            <Select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })}>
              {ROLES.values.map((r) => (
                <option key={r} value={r}>
                  {ROLES.label(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Comissão padrão (% sobre a margem da venda)">
            <Input type="number" min={0} max={100} step={0.5} value={d.commissionRateBps / 100} onChange={(e) => setD({ ...d, commissionRateBps: Math.round(Number(e.target.value) * 100) })} />
          </Field>
          <Field label={user ? "Nova senha (deixe em branco para manter)" : "Senha inicial"} error={errors.password}>
            <PasswordInput autoComplete="new-password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Usuário ativo
          </label>
        </div>
      </Modal>
    </>
  );
}
