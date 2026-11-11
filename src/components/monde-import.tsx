"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, Unplug, Upload } from "lucide-react";
import { Button, Field } from "@/components/ui";
import { Modal, PasswordInput } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import type { ActionResult } from "@/server/errors";
import {
  connectMondeAction,
  disconnectMondeAction,
  importMondeBatchAction,
  importMondeSalesBatchAction,
  restartMondeImportAction,
  restartMondeSalesImportAction,
} from "@/app/actions";

export type MondeState = {
  login: string;
  status: string;
  lastError: string | null;
  nextPage: number;
  importing: boolean;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  lastImportAt: Date | string | null;
  salesImporting: boolean;
  salesCreated: number;
  salesSkipped: number;
  salesFailed: number;
  salesErrors: { id: string; numero: number | null; motivo: string }[];
  salesLastImportAt: Date | string | null;
} | null;

/** Botão da tela de vendas: abre a conexão e a importação do Monde. */
export function MondeSalesButton({ monde }: { monde: MondeState }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Importar do Monde
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Importar do Monde" size="lg">
        <MondePanel monde={monde} />
      </Modal>
    </>
  );
}

/** Conexão com o Monde (credencial da API v3) e importação de clientes e de vendas. */
export function MondePanel({ monde }: { monde: MondeState }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const { run, busy } = useAction();

  if (!monde || monde.login.includes("@"))
    return (
      <form
        className="space-y-3 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (monde) await run(() => disconnectMondeAction(), { success: false });
          await run(() => connectMondeAction({ token }), { onSuccess: () => router.refresh() });
        }}
      >
        {monde && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">A conexão com o Monde mudou: agora é pela credencial da API. Cole a credencial abaixo para conectar de novo.</p>}
        <p className="text-slate-700">
          Traz do Monde, pela API oficial, o cadastro dos clientes e as vendas com o financeiro (parcelas do cliente, contas dos fornecedores e comissões). O que já está pago no Monde entra pago na gestão.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-slate-700">
          <li>No Monde, abra <strong>Cadastros › Integrações › API Monde</strong> e gere uma credencial.</li>
          <li>
            Marque <strong>Visualizar</strong> em: Pessoas, Vendas (inclusive de outros vendedores), Contas a pagar e receber, Vendedores, Formas de pagamento, Cidades e Empresas. Não precisa de nenhuma permissão de alterar.
          </li>
          <li>Copie a credencial e cole aqui.</li>
        </ol>
        <Field label="Credencial da API do Monde" required hint="Fica guardada criptografada e só é usada para importar. Pode ser revogada no Monde a qualquer momento.">
          <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </Field>
        <Button type="submit" loading={busy} disabled={!token.trim()}>
          Conectar ao Monde
        </Button>
      </form>
    );

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-slate-700">
          Conectado: <strong>{monde.login}</strong>
        </p>
        <Button variant="ghost" className="text-danger" onClick={() => run(() => disconnectMondeAction(), { onSuccess: () => router.refresh() })}>
          <Unplug className="h-4 w-4" /> Desconectar
        </Button>
      </div>
      {monde.lastError && <p className="rounded-lg bg-red-50 p-3 text-danger">{monde.lastError}</p>}
      <ClientsSection monde={monde} />
      <SalesSection monde={monde} />
      <p className="text-xs text-muted">
        O Monde permite 10 consultas a cada 3 segundos, então importações grandes levam um tempo. Pode fechar esta janela e continuar depois: a importação retoma de onde parou e nada é duplicado.
      </p>
    </div>
  );
}

function useBatches() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const { run } = useAction();
  async function loop<T extends { done: boolean }>(
    restart: (() => Promise<ActionResult<unknown>>) | null,
    batch: () => Promise<ActionResult<T>>,
    onStep: (d: T) => void,
    onDone: (d: T) => void,
  ) {
    setRunning(true);
    try {
      if (restart) {
        const r = await run(restart, { success: false, refresh: false });
        if (!r.ok) return;
      }
      for (let i = 0; i < 2000; i++) {
        const r = await run(batch, { success: false, refresh: false });
        if (!r.ok) return;
        onStep(r.data);
        if (r.data.done) {
          onDone(r.data);
          break;
        }
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  }
  return { running, loop };
}

function ClientsSection({ monde }: { monde: NonNullable<MondeState> }) {
  const { running, loop } = useBatches();
  const [p, setP] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const shown = p ?? (monde.importing ? { created: monde.createdCount, updated: monde.updatedCount, skipped: monde.skippedCount } : null);
  return (
    <section className="space-y-2 rounded-lg border border-line p-4">
      <h3 className="font-semibold text-ink">Clientes</h3>
      <p className="text-slate-700">
        Nome, CPF/CNPJ, RG, nascimento, sexo, contatos, endereço, passaporte e documento de estrangeiro. Cliente que já existe (mesmo cadastro do Monde, CPF/CNPJ, passaporte ou e-mail) não é duplicado: só os campos vazios são completados.
        {monde.lastImportAt && <> Última importação completa em {new Date(monde.lastImportAt).toLocaleString("pt-BR")}.</>}
      </p>
      {shown && (
        <p className="text-ink">
          {shown.created} novo(s) · {shown.updated} completado(s) · {shown.skipped} ignorado(s)
        </p>
      )}
      <Button
        onClick={() =>
          loop(
            monde.importing ? null : () => restartMondeImportAction(),
            () => importMondeBatchAction(),
            (d: { done: boolean; created: number; updated: number; skipped: number }) => setP(d),
            (d) => toast.success(`Clientes do Monde importados: ${d.created} novo(s), ${d.updated} completado(s).`),
          )
        }
        loading={running}
      >
        {!running && <RefreshCw className="h-4 w-4" />} {running ? "Importando clientes…" : monde.importing ? "Continuar importação de clientes" : "Importar clientes do Monde"}
      </Button>
    </section>
  );
}

function SalesSection({ monde }: { monde: NonNullable<MondeState> }) {
  const { running, loop } = useBatches();
  const [p, setP] = useState<{ created: number; skipped: number; failed: number } | null>(null);
  const shown = p ?? (monde.salesImporting || monde.salesLastImportAt ? { created: monde.salesCreated, skipped: monde.salesSkipped, failed: monde.salesFailed } : null);
  const failures = monde.salesErrors.filter((e) => !e.motivo.includes("(ignorada)"));
  return (
    <section className="space-y-2 rounded-lg border border-line p-4">
      <h3 className="font-semibold text-ink">Vendas</h3>
      <p className="text-slate-700">
        Todas as vendas abertas e fechadas, com cliente, produtos, fornecedores, passageiros, parcelas, contas dos fornecedores e comissões. O que já está pago no Monde entra pago, na conta <strong>Monde (baixas importadas)</strong>, sem
        mexer no saldo dos bancos. Venda importada não gera contrato novo nem marca card no CRM. Vendas canceladas no Monde não entram.
        {monde.salesLastImportAt && <> Última importação completa em {new Date(monde.salesLastImportAt).toLocaleString("pt-BR")}.</>}
      </p>
      {shown && (
        <p className="text-ink">
          {shown.created} importada(s) · {shown.skipped} sem produto com valor · {shown.failed} com falha
        </p>
      )}
      {failures.length > 0 && !running && (
        <details className="rounded-lg bg-amber-50 p-3 text-amber-900">
          <summary className="cursor-pointer font-medium">Vendas que não entraram ({failures.length})</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
            {failures.map((e) => (
              <li key={e.id}>
                Venda nº {e.numero ?? "?"}: {e.motivo}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Corrija no Monde (ou lance à mão) e clique em &quot;Importar de novo&quot;: as que já entraram são reconhecidas e não duplicam.</p>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            loop(
              monde.salesImporting ? null : () => restartMondeSalesImportAction(),
              () => importMondeSalesBatchAction(),
              (d: { done: boolean; created: number; skipped: number; failed: number }) => setP(d),
              (d) => toast.success(`Vendas do Monde importadas: ${d.created}${d.failed ? `, ${d.failed} com falha` : ""}.`),
            )
          }
          loading={running}
        >
          {!running && <RefreshCw className="h-4 w-4" />} {running ? "Importando vendas…" : monde.salesImporting ? "Continuar importação de vendas" : monde.salesLastImportAt ? "Importar de novo" : "Importar vendas do Monde"}
        </Button>
        {running && <Loader2 className="h-4 w-4 animate-spin self-center text-muted" />}
      </div>
    </section>
  );
}
