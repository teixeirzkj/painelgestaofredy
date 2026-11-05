"use client";
import { useRef, useState } from "react";
import { Sparkles, Upload, FileText, CircleAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDocument } from "@/lib/utils";
import type { SaleExtraction } from "@/server/services/ai-extract";

/** "Preencher pelo print": envia a reserva para a IA e devolve os dados para o formulário (sem gravar nada). */
export function AiImport({ onApply }: { onApply: (d: SaleExtraction) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<{ file: string; data: SaleExtraction } | null>(null);

  async function send(file: File) {
    if (file.size > 8 * 1024 * 1024) return toast.error("Arquivo acima de 8 MB.");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("arquivo", file);
      const res = await fetch("/api/vendas/extrair", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { data?: SaleExtraction; error?: string };
      if (!res.ok || !json.data) return toast.error(json.error ?? "Não foi possível ler o arquivo.");
      onApply(json.data);
      setResult({ file: file.name, data: json.data });
      toast.success("Dados preenchidos. Confira cada campo e ajuste a forma de pagamento.");
    } catch {
      toast.error("Falha de comunicação. Tente de novo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const d = result?.data;
  const missingSuppliers = d?.items.filter((i) => !i.supplierId && i.supplierName).map((i) => i.supplierName!) ?? [];
  return (
    <Card className="overflow-hidden">
      <div
        className={`flex flex-col gap-4 p-5 transition-colors sm:flex-row sm:items-center ${drag ? "bg-brand-50" : "bg-gradient-to-r from-brand-25 to-white"}`}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) send(f);
        }}
        onPaste={(e) => {
          const f = [...e.clipboardData.files][0];
          if (f && !busy) send(f);
        }}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold text-ink">Preencher pelo print da reserva</h2>
          <p className="text-sm text-muted">Envie, arraste ou cole (Ctrl+V) o print ou PDF da reserva. A IA preenche cliente, passageiros, produtos, datas e valores; você confere e ajusta o pagamento.</p>
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
        <Button type="button" onClick={() => input.current?.click()} loading={busy} className="shrink-0">
          {!busy && <Upload className="h-4 w-4" />} {busy ? "Lendo a reserva…" : "Enviar print ou PDF"}
        </Button>
      </div>
      {d && (
        <div className="space-y-2 border-t border-line px-5 py-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-ink">
            <FileText className="h-4 w-4 text-brand-600" /> Lido de {result!.file}: {d.items.length} produto(s), {d.passengers.length} passageiro(s){d.totalCents ? `, total ${formatBRL(d.totalCents)}` : ""}.
          </p>
          {d.client.match ? (
            <p className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-4 w-4" /> Cliente encontrado no cadastro: {d.client.match.name}.
            </p>
          ) : d.client.name ? (
            <p className="flex items-start gap-2 text-amber-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Cliente do documento não está cadastrado: <strong>{d.client.name}</strong>
                {d.client.document ? ` (${formatDocument(d.client.document)})` : ""}
                {d.client.email ? ` · ${d.client.email}` : ""}. Cadastre no campo Cliente abaixo.
              </span>
            </p>
          ) : null}
          {missingSuppliers.length > 0 && (
            <p className="flex items-start gap-2 text-amber-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Fornecedor sem cadastro: {[...new Set(missingSuppliers)].join(", ")}. Escolha ou cadastre em cada produto.
            </p>
          )}
          {d.paymentNotes && <p className="text-muted">Pagamento no documento: {d.paymentNotes}</p>}
        </div>
      )}
    </Card>
  );
}
