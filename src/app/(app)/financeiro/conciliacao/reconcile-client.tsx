"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Upload, Check, EyeOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { importStatementAction, matchStatementAction, setStatementStatusAction } from "@/app/actions";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export function ImportStatement({ accountId }: { accountId: string }) {
  const { run, busy } = useAction();
  return (
    <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700 ${busy ? "opacity-50" : ""}`}>
      <Upload className="h-4 w-4" /> Importar CSV
      <input
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 2 * 1024 * 1024) return toast.error("Arquivo maior que 2 MB.");
          const text = await file.text();
          await run(() => importStatementAction(accountId, text), {
            success: false,
            onSuccess: (r) => {
              toast.success(`${r.imported} linha(s) importada(s); ${r.duplicates} duplicada(s) ignorada(s).`);
              if (r.errors.length) toast.warning(`${r.errors.length} linha(s) com erro: ${r.errors.slice(0, 3).join(" ")}`);
            },
          });
        }}
      />
    </label>
  );
}

export function LineActions({ lineId, suggestions, ignored }: { lineId: string; suggestions: { id: string; date: string; amountCents: number; description: string }[]; ignored?: boolean }) {
  const { run, busy } = useAction();
  if (ignored)
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setStatementStatusAction(lineId, "PENDENTE"))}>
        <RotateCcw className="h-3.5 w-3.5" /> Reabrir
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestions.length === 0 && <span className="text-xs text-muted">Sem baixa correspondente (mesmo valor, ±5 dias).</span>}
      {suggestions.map((s) => (
        <Button key={s.id} size="sm" variant="secondary" disabled={busy} title={s.description} onClick={() => run(() => matchStatementAction(lineId, s.id))}>
          <Check className="h-3.5 w-3.5" /> {formatDate(s.date)} · {formatBRL(s.amountCents)} · <span className="max-w-32 truncate">{s.description}</span>
        </Button>
      ))}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setStatementStatusAction(lineId, "IGNORADO"))}>
        <EyeOff className="h-3.5 w-3.5" /> Ignorar
      </Button>
    </div>
  );
}
