"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Image as ImageIcon, Upload, Loader2, Paperclip } from "lucide-react";
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

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", target.kind);
      fd.set("id", target.id);
      fd.set("docKind", kind);
      const res = await fetch("/api/anexos", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Falha ao enviar.");
      toast.success("Documento anexado.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      {items.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                {a.mimeType.startsWith("image/") ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              </span>
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
          <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-medium shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Anexar arquivo
          </button>
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <Paperclip className="h-3 w-3" /> PDF, PNG, JPG ou WEBP até 5 MB
          </span>
        </div>
      )}
    </div>
  );
}
