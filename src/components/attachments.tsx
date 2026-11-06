"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Upload, Loader2, Paperclip } from "lucide-react";
import { Badge, Select } from "@/components/ui";
import { ATTACHMENT_KINDS } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";

export type AttachmentRow = { id: string; fileName: string; mimeType: string; sizeBytes: number; kind: string; createdAt: Date | string; origin?: string };

/** Lista e envio de documentos (vouchers, documentos de viagem, faturas, comprovantes). */
export function AttachmentsPanel({
  target,
  items,
  canUpload,
  kinds = ["VOUCHER", "DOCUMENTO", "COMPROVANTE", "OUTRO"],
  timezone,
  emptyText = "Nenhum documento anexado.",
}: {
  target: { kind: "sale" | "trip" | "invoice" | "receivable" | "payable"; id: string };
  items: AttachmentRow[];
  canUpload: boolean;
  kinds?: string[];
  timezone: string;
  emptyText?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(kinds[0]);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("kind", target.kind);
        fd.set("id", target.id);
        fd.set("docKind", kind);
        const res = await fetch("/api/anexos", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${file.name}: ${body.error ?? "falha ao enviar."}`);
      }
      toast.success(list.length > 1 ? `${list.length} arquivos anexados.` : "Documento anexado.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div
      onPaste={(e) => {
        if (canUpload && !busy && e.clipboardData.files.length) upload(e.clipboardData.files);
      }}
      onDragOver={(e) => canUpload && e.preventDefault()}
      onDrop={(e) => {
        if (!canUpload || busy) return;
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      {items.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
              {a.mimeType.startsWith("image/") ? (
                <a href={`/api/anexos/${a.id}`} target="_blank" rel="noopener" className="block h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-line bg-slate-100" title="Ver imagem">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/anexos/${a.id}`} alt={a.fileName} loading="lazy" className="h-full w-full object-cover" />
                </a>
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <FileText className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <a href={`/api/anexos/${a.id}`} target="_blank" rel="noopener" className="block truncate text-sm font-medium text-ink hover:text-brand-700">
                  {a.fileName}
                </a>
                <span className="block text-xs text-muted">
                  {(a.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(a.createdAt, timezone)}
                  {a.origin && ` · ${a.origin}`}
                </span>
              </span>
              <Badge tone={a.kind === "VOUCHER" ? "blue" : "gray"}>{ATTACHMENT_KINDS.label(a.kind)}</Badge>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-auto text-xs" aria-label="Tipo do documento">
            {kinds.map((k) => (
              <option key={k} value={k}>
                {ATTACHMENT_KINDS.label(k)}
              </option>
            ))}
          </Select>
          <input ref={input} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-medium shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Anexar arquivo
          </button>
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <Paperclip className="h-3 w-3" /> Imagem ou PDF até 5 MB · arraste ou cole (Ctrl+V)
          </span>
        </div>
      )}
    </div>
  );
}
