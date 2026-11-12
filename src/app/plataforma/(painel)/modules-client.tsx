"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plane, RefreshCw } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { PasswordInput } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { runMonitorForCompanyAction, saveCompanyMonitorAction, saveMonitorAction, setCompanyModuleAction } from "../actions";
import { cn } from "@/lib/utils";

type Mod = { key: string; label: string; group: string; description?: string; on: boolean; defaultOn: boolean };

/** Liga e desliga os módulos do painel de uma agência. */
export function ModulesPanel({ companyId, modules }: { companyId: string; modules: Mod[] }) {
  const router = useRouter();
  const { run } = useAction();
  const [pending, setPending] = useState<string | null>(null);
  const groups = [...new Set(modules.map((m) => m.group))];
  async function toggle(m: Mod) {
    setPending(m.key);
    await run(() => setCompanyModuleAction(companyId, m.key, !m.on), { onSuccess: () => router.refresh() });
    setPending(null);
  }
  return (
    <div className="space-y-5 p-5">
      {groups.map((g) => (
        <div key={g}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{g}</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {modules
              .filter((m) => m.group === g)
              .map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{m.label}</p>
                    {m.description && <p className="text-xs text-muted">{m.description}</p>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.on}
                    aria-label={`${m.on ? "Desligar" : "Ligar"} ${m.label}`}
                    disabled={pending === m.key}
                    onClick={() => toggle(m)}
                    className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50", m.on ? "bg-emerald-500" : "bg-slate-300")}
                  >
                    <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", m.on ? "left-[22px]" : "left-0.5")} />
                  </button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="text-xs text-muted">Módulo desligado some do menu da agência e a página fica bloqueada para todos os usuários dela. O Dashboard e os dados da agência ficam sempre ligados.</p>
    </div>
  );
}

/** Botão da página da agência: confere os voos dela agora (no máximo 1 consulta por voo por dia). */
export function RunMonitorButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { run, busy } = useAction();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={busy}
      onClick={() =>
        run(() => runMonitorForCompanyAction(companyId), {
          success: false,
          onSuccess: (r) => {
            const d = r as { skipped?: string; checked?: number; alerts?: number; notFound?: number; error?: string | null };
            if (d.skipped) toast.info(`Não conferiu: ${d.skipped}.`);
            else if (d.error) toast.error(`${d.checked ?? 0} voo(s) conferido(s). ${d.error}`);
            else toast.success(`${d.checked} voo(s) conferido(s), ${d.alerts} alerta(s) novo(s)${d.notFound ? `, ${d.notFound} sem informação` : ""}.`);
            router.refresh();
          },
        })
      }
    >
      {!busy && <Plane className="h-4 w-4" />} Conferir voos agora
    </Button>
  );
}

type MonitorStatus = { configured: boolean; marketplace: string; maxPerRun: number; lastError: string | null; lastRunAt: string | null; month: string; unitsUsed: number; queries: number; companiesEnabled: number };

/** Configuração do AeroDataBox (chave da plataforma) e consumo do mês. */
export function MonitorSettings({ status }: { status: MonitorStatus }) {
  const router = useRouter();
  const { run, busy } = useAction();
  const [key, setKey] = useState("");
  const [marketplace, setMarketplace] = useState(status.marketplace);
  const [maxPerRun, setMaxPerRun] = useState(String(status.maxPerRun));
  return (
    <div className="space-y-4 p-5 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-muted">Chave</p>
          <p className="font-semibold text-ink">{status.configured ? "Configurada" : "Não configurada"}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-muted">Agências com o módulo</p>
          <p className="font-semibold text-ink">{status.companiesEnabled}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-muted">Consultas em {status.month.slice(5)}/{status.month.slice(0, 4)}</p>
          <p className="font-semibold text-ink">
            {status.queries} <span className="text-xs font-normal text-muted">({status.unitsUsed} unidades)</span>
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-muted">Última rodada</p>
          <p className="font-semibold text-ink">{status.lastRunAt ? new Date(status.lastRunAt).toLocaleString("pt-BR") : "—"}</p>
        </div>
      </div>
      {status.lastError && <p className="rounded-lg bg-red-50 p-3 text-danger">{status.lastError}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={status.configured ? "Trocar a chave do AeroDataBox" : "Chave do AeroDataBox"} hint="Fica guardada criptografada.">
          <PasswordInput value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Onde a chave foi criada">
          <Select value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
            <option value="apimarket">API.market</option>
            <option value="rapidapi">RapidAPI</option>
            <option value="direct">Direto no AeroDataBox</option>
          </Select>
        </Field>
        <Field label="Máximo de consultas por rodada" hint="Por agência, a cada dia. Protege o plano.">
          <Input type="number" min={1} max={2000} value={maxPerRun} onChange={(e) => setMaxPerRun(e.target.value)} />
        </Field>
      </div>
      <Button
        loading={busy}
        onClick={() =>
          run(() => saveMonitorAction({ key: key || undefined, marketplace, maxPerRun: Number(maxPerRun) }), {
            onSuccess: () => {
              setKey("");
              router.refresh();
            },
          })
        }
      >
        {!busy && <RefreshCw className="h-4 w-4" />} Salvar
      </Button>
      <p className="text-xs text-muted">
        Todo dia às 6h (Brasília) o sistema confere os voos de hoje e amanhã das agências com o módulo <strong>Monitor de voos</strong> ligado: 1 consulta por voo por dia, 2 unidades do plano por consulta. Os alertas aparecem na Central da
        Viagem da agência. Ligue o módulo na página de cada agência.
      </p>
    </div>
  );
}

type CompanyMonitor = { ownKey: boolean; marketplace: string; lastError: string | null; lastRunAt: string | null; month: string; unitsUsed: number; queries: number };

/** Chave do AeroDataBox só desta agência (opcional) e consumo dela no mês. */
export function CompanyMonitorKey({ companyId, status }: { companyId: string; status: CompanyMonitor }) {
  const router = useRouter();
  const { run, busy } = useAction();
  const [key, setKey] = useState("");
  const [marketplace, setMarketplace] = useState(status.marketplace);
  return (
    <div className="space-y-4 p-5 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-muted">Chave usada</p>
          <p className="font-semibold text-ink">{status.ownKey ? "Própria da agência" : "A da plataforma"}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-muted">Consultas da agência em {status.month.slice(5)}/{status.month.slice(0, 4)}</p>
          <p className="font-semibold text-ink">
            {status.queries} <span className="text-xs font-normal text-muted">({status.unitsUsed} unidades)</span>
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-muted">Última conferência</p>
          <p className="font-semibold text-ink">{status.lastRunAt ? new Date(status.lastRunAt).toLocaleString("pt-BR") : "—"}</p>
        </div>
      </div>
      {status.lastError && <p className="rounded-lg bg-red-50 p-3 text-danger">{status.lastError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={status.ownKey ? "Trocar a chave desta agência" : "Chave do AeroDataBox desta agência"} hint="Opcional. Sem chave própria, usa a da plataforma.">
          <PasswordInput value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Onde a chave foi criada">
          <Select value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
            <option value="apimarket">API.market</option>
            <option value="rapidapi">RapidAPI</option>
            <option value="direct">Direto no AeroDataBox</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} disabled={!key.trim() && marketplace === status.marketplace} onClick={() => run(() => saveCompanyMonitorAction(companyId, { key: key || undefined, marketplace }), { onSuccess: () => { setKey(""); router.refresh(); } })}>
          Salvar
        </Button>
        {status.ownKey && (
          <Button variant="ghost" className="text-danger" loading={busy} onClick={() => run(() => saveCompanyMonitorAction(companyId, { remove: true }), { onSuccess: () => router.refresh() })}>
            Remover chave própria
          </Button>
        )}
      </div>
    </div>
  );
}
