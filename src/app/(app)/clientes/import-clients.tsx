"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import Papa from "papaparse";
import { importClientRowsAction } from "@/app/actions";
import { browserInflate, readXlsxRows } from "@/lib/xlsx";
import { MondePanel, type MondeState } from "@/components/monde-import";
import { CLIENT_CSV_TEMPLATE } from "@/lib/client-csv";
import { cn } from "@/lib/utils";

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
        {tab === "planilha" || !canMonde ? <CsvImport /> : <MondePanel monde={monde} />}
      </Modal>
    </>
  );
}

function CsvImport() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const { run, busy } = useAction();
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + CLIENT_CSV_TEMPLATE)}`;

  async function readRows(file: File): Promise<string[][]> {
    const buf = await file.arrayBuffer();
    if (/\.xlsx$/i.test(file.name)) return readXlsxRows(buf, browserInflate);
    // Excel em português costuma salvar CSV em Windows-1252; tenta UTF-8 e cai para Latin-1 se houver caracteres inválidos
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    return Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimiter: "" }).data;
  }

  async function send(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024) return toast.error("Planilha acima de 5 MB. Divida em partes.");
      if (/\.xls$/i.test(file.name)) return toast.error("Formato .xls antigo: abra no Excel e salve como .xlsx ou CSV.");
      let all: string[][];
      try {
        all = await readRows(file);
      } catch {
        return toast.error("Não consegui ler a planilha. Salve como .xlsx ou CSV e tente de novo.");
      }
      const [header, ...rows] = all;
      if (!header?.length || !rows.length) return toast.error("Planilha vazia.");
      if (rows.length > 10000) return toast.error("Máximo de 10.000 clientes por planilha. Divida em partes.");
      const total: CsvResult = { criados: 0, atualizados: 0, semMudanca: 0, erros: [], avisos: [] };
      setResult(null);
      setImporting(true);
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        setProgress({ done: i, total: rows.length });
        const part = rows.slice(i, i + CHUNK);
        const r = await run(() => importClientRowsAction({ header, rows: part, firstLine: i + 2, last: i + CHUNK >= rows.length }), { success: false, refresh: false });
        if (!r.ok) break;
        const d = r.data as CsvResult;
        total.criados += d.criados;
        total.atualizados += d.atualizados;
        total.semMudanca += d.semMudanca;
        total.erros.push(...d.erros);
        total.avisos.push(...d.avisos);
        setResult({ ...total });
      }
      setProgress(null);
      router.refresh();
    } finally {
      setImporting(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <ol className="list-decimal space-y-1 pl-5 text-slate-700">
        <li>
          Baixe o modelo, ou use a planilha exportada do sistema antigo: aceita <strong>.xlsx</strong> (Excel) e <strong>CSV</strong>. A exportação de clientes do Monde entra direto, sem ajustar nada.
        </li>
        <li>A primeira linha precisa ter os nomes das colunas. Só a coluna <strong>nome</strong> é obrigatória. Para estrangeiro, use as colunas <strong>nacionalidade</strong>, <strong>rne</strong> e <strong>passaporte</strong> (o CPF pode ficar vazio).</li>
        <li>Cliente que já existe (mesmo CPF/CNPJ, passaporte ou e-mail) não é duplicado: só os campos vazios são completados.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <a href={templateHref} download="modelo-clientes.csv" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 font-medium shadow-sm hover:bg-slate-50">
          <Download className="h-4 w-4" /> Baixar modelo
        </a>
        <input ref={input} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
        <Button onClick={() => input.current?.click()} loading={busy || importing}>
          {!(busy || importing) && <FileSpreadsheet className="h-4 w-4" />} {importing ? "Importando…" : "Escolher planilha"}
        </Button>
      </div>
      {progress && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted">
            {progress.done} de {progress.total} linhas… Não feche esta janela até terminar.
          </p>
        </div>
      )}
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
