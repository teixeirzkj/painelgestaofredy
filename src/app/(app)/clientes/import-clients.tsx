"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, RefreshCw, Unplug, Upload } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { Modal, PasswordInput } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { connectMondeAction, disconnectMondeAction, importClientsCsvAction, importMondeBatchAction, restartMondeImportAction } from "@/app/actions";
import { CLIENT_CSV_TEMPLATE } from "@/lib/client-csv";
import { cn } from "@/lib/utils";

export type MondeState = { login: string; status: string; lastError: string | null; nextPage: number; totalPages: number | null; importing: boolean; createdCount: number; updatedCount: number; skippedCount: number; lastImportAt: Date | string | null } | null;
type CsvResult = { criados: number; atualizados: number; semMudanca: number; erros: { linha: number; motivo: string }[]; avisos: { linha: number; motivo: string }[] };

/** Importar clientes por planilha (CSV) ou pela API do Monde. */
export function ImportClientsButton({ monde, canMonde }: { monde: MondeState; canMonde: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"planilha" | "monde">("planilha");
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Importar clientes
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Importar clientes" size="lg">
        {canMonde && (
          <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
            {(["planilha", "monde"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1.5 font-medium", tab === t ? "bg-white text-brand-700 shadow-sm" : "text-muted hover:text-ink")}>
                {t === "planilha" ? "Planilha (CSV)" : "Do Monde"}
              </button>
            ))}
          </div>
        )}
        {tab === "planilha" || !canMonde ? <CsvImport /> : <MondeImport monde={monde} />}
      </Modal>
    </>
  );
}

function CsvImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvResult | null>(null);
  const { run, busy } = useAction();
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + CLIENT_CSV_TEMPLATE)}`;

  async function send(file: File) {
    if (file.size > 5 * 1024 * 1024) return toast.error("Planilha acima de 5 MB. Divida em partes.");
    const buf = await file.arrayBuffer();
    // Excel em português costuma salvar CSV em Windows-1252; tenta UTF-8 e cai para Latin-1 se houver caracteres inválidos
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    const r = await run(() => importClientsCsvAction(text), { success: false });
    if (r.ok) {
      setResult(r.data as CsvResult);
      router.refresh();
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div className="space-y-4 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-slate-700">
        <li>
          Baixe o modelo, ou exporte a planilha do sistema antigo (no Excel: <strong>Salvar como → CSV</strong>).
        </li>
        <li>A primeira linha precisa ter os nomes das colunas. Só a coluna <strong>nome</strong> é obrigatória. Para estrangeiro, use as colunas <strong>nacionalidade</strong>, <strong>rne</strong> e <strong>passaporte</strong> (o CPF pode ficar vazio).</li>
        <li>Cliente que já existe (mesmo CPF/CNPJ, passaporte ou e-mail) não é duplicado: só os campos vazios são completados.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <a href={templateHref} download="modelo-clientes.csv" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 font-medium shadow-sm hover:bg-slate-50">
          <Download className="h-4 w-4" /> Baixar modelo
        </a>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
        <Button onClick={() => input.current?.click()} loading={busy}>
          {!busy && <FileSpreadsheet className="h-4 w-4" />} {busy ? "Importando…" : "Escolher planilha"}
        </Button>
      </div>
      {result && (
        <div className="space-y-2 rounded-lg border border-line p-4">
          <p className="font-medium text-ink">
            {result.criados} cliente(s) novo(s) · {result.atualizados} completado(s) · {result.semMudanca} já estavam iguais
          </p>
          {result.erros.length > 0 && (
            <details className="text-danger">
              <summary className="cursor-pointer">{result.erros.length} linha(s) não importada(s)</summary>
              <ul className="mt-1 max-h-40 overflow-auto text-xs">
                {result.erros.map((e) => (
                  <li key={e.linha}>
                    Linha {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.avisos.length > 0 && (
            <details className="text-amber-800">
              <summary className="cursor-pointer">{result.avisos.length} aviso(s)</summary>
              <ul className="mt-1 max-h-40 overflow-auto text-xs">
                {result.avisos.map((e) => (
                  <li key={e.linha}>
                    Linha {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function MondeImport({ monde }: { monde: MondeState }) {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ page: number | null; totalPages: number | null; created: number; updated: number; skipped: number } | null>(null);
  const { run, busy } = useAction();

  async function importAll(restart: boolean) {
    setRunning(true);
    try {
      if (restart) {
        const r = await run(() => restartMondeImportAction(), { success: false });
        if (!r.ok) return;
      }
      for (let i = 0; i < 400; i++) {
        const r = await run(() => importMondeBatchAction(), { success: false });
        if (!r.ok) return;
        setProgress(r.data);
        if (r.data.done) {
          toast.success(`Importação do Monde concluída: ${r.data.created} novo(s), ${r.data.updated} completado(s).`);
          break;
        }
      }
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  if (!monde)
    return (
      <form
        className="space-y-3 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          await run(() => connectMondeAction({ login, password }), { onSuccess: () => router.refresh() });
        }}
      >
        <p className="text-slate-700">
          Traz o cadastro dos clientes do Monde pela API oficial: nome, CPF/CNPJ, RG, nascimento, sexo, contatos, endereço e passaporte. Nacionalidade e RNE não vêm do Monde (a API não tem esses campos): marque o cliente estrangeiro no cadastro. A API do Monde <strong>não entrega as vendas nem as imagens</strong> dos documentos; as vendas antigas entram por planilha e as fotos dos documentos podem ser anexadas no cadastro de cada cliente.
        </p>
        <Field label="Usuário do Monde" required hint="Formato: usuario@suaagencia.monde.com.br. O usuário precisa ter acesso total no Monde.">
          <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="admin@suaagencia.monde.com.br" autoComplete="off" />
        </Field>
        <Field label="Senha do Monde" required hint="Fica guardada criptografada e só é usada para importar.">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button type="submit" loading={busy}>
          Conectar ao Monde
        </Button>
      </form>
    );

  const p = progress ?? (monde.importing ? { page: monde.nextPage - 1, totalPages: monde.totalPages, created: monde.createdCount, updated: monde.updatedCount, skipped: monde.skippedCount } : null);
  const pct = p?.totalPages ? Math.min(100, Math.round(((p.page ?? 0) / p.totalPages) * 100)) : 0;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-700">
        Conectado como <strong>{monde.login}</strong>
        {monde.lastImportAt && <> · última importação completa em {new Date(monde.lastImportAt).toLocaleString("pt-BR")}</>}.
      </p>
      {monde.lastError && !running && <p className="rounded-lg bg-red-50 p-3 text-danger">{monde.lastError}</p>}
      {p && (
        <div className="space-y-2 rounded-lg border border-line p-4">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-ink">
            {p.totalPages ? `Página ${p.page} de ${p.totalPages}` : "Calculando…"} · {p.created} novo(s) · {p.updated} completado(s) · {p.skipped} ignorado(s)
          </p>
          <p className="text-xs text-muted">O Monde permite 60 consultas por minuto; cada página traz 50 pessoas. Pode fechar esta janela e continuar depois: a importação retoma de onde parou.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => importAll(!monde.importing)} loading={running}>
          {!running && <RefreshCw className="h-4 w-4" />} {running ? "Importando do Monde…" : monde.importing ? "Continuar importação" : "Importar clientes do Monde"}
        </Button>
        <Button variant="ghost" className="text-danger" disabled={running} onClick={() => run(() => disconnectMondeAction(), { onSuccess: () => router.refresh() })}>
          <Unplug className="h-4 w-4" /> Desconectar
        </Button>
        {running && <Loader2 className="h-4 w-4 animate-spin self-center text-muted" />}
      </div>
      <p className="text-xs text-muted">Cliente que já existe (mesmo id do Monde, CPF/CNPJ, passaporte ou e-mail) não é duplicado: só os campos vazios são completados. Usuários do Monde (agentes) não entram como clientes.</p>
    </div>
  );
}
