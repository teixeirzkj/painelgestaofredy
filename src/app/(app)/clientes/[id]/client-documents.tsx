"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { deleteClientDocumentAction } from "@/app/actions";
import { CLIENT_DOC_KINDS } from "@/lib/constants";
import { formatDate } from "@/lib/dates";

export type ClientDoc = { id: string; kind: string; fileName: string; mimeType: string; docNumber: string | null; docExpiry: string | null; createdAt: Date | string };

/** Fotos e PDFs dos documentos do cliente (RG, CPF, CNH, passaporte...), com número e validade. */
export function ClientDocuments({ clientId, docs, canManage, todayStr }: { clientId: string; docs: ClientDoc[]; canManage: boolean; todayStr: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("RG");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<ClientDoc | null>(null);
  const { run } = useAction();

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    try {
      for (const f of list) {
        if (f.size > 5 * 1024 * 1024) throw new Error(`${f.name}: arquivo acima de 5 MB.`);
        const fd = new FormData();
        fd.set("file", f);
        fd.set("kind", "client");
        fd.set("id", clientId);
        fd.set("docKind", kind);
        if (number) fd.set("docNumber", number);
        if (expiry) fd.set("docExpiry", expiry);
        const res = await fetch("/api/anexos", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Falha ao enviar.");
      }
      toast.success(list.length > 1 ? `${list.length} arquivos enviados.` : "Documento enviado.");
      setNumber("");
      setExpiry("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  }

  return (
    <div
      onPaste={(e) => {
        if (canManage && !busy && e.clipboardData.files.length) upload(e.clipboardData.files);
      }}
      onDragOver={(e) => canManage && e.preventDefault()}
      onDrop={(e) => {
        if (!canManage || busy) return;
        e.preventDefault();
        upload(e.dataTransfer.files);
      }}
    >
      {docs.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">Nenhum documento enviado. Envie as fotos do RG, CPF, CNH ou passaporte do cliente.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4">
          {docs.map((d) => {
            const expired = !!d.docExpiry && d.docExpiry < todayStr;
            return (
              <li key={d.id} className="group relative overflow-hidden rounded-lg border border-line bg-white">
                <a href={`/api/anexos/${d.id}`} target="_blank" rel="noopener" className="block aspect-[4/3] bg-slate-100" title="Abrir em tamanho original">
                  {d.mimeType.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/anexos/${d.id}`} alt={`${CLIENT_DOC_KINDS.label(d.kind)} do cliente`} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
                      <FileText className="h-8 w-8" />
                      <span className="text-xs">PDF</span>
                    </span>
                  )}
                </a>
                <div className="px-3 py-2 text-xs">
                  <p className="font-semibold text-ink">{CLIENT_DOC_KINDS.label(d.kind)}</p>
                  {d.docNumber && <p className="tabular text-slate-600">Nº {d.docNumber}</p>}
                  {d.docExpiry && (
                    <p className={expired ? "font-medium text-danger" : "text-muted"}>
                      {expired ? "Vencido em" : "Validade"} {formatDate(d.docExpiry)}
                    </p>
                  )}
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setRemove(d)}
                    className="absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1.5 text-slate-500 opacity-0 shadow-sm transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Remover ${CLIENT_DOC_KINDS.label(d.kind)}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canManage && (
        <div className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-[170px_1fr_160px_auto] sm:items-end">
          <Field label="Documento">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {CLIENT_DOC_KINDS.values.map((k) => (
                <option key={k} value={k}>
                  {CLIENT_DOC_KINDS.label(k)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Número (opcional)">
            <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Ex.: 12.345.678-9" />
          </Field>
          <Field label="Validade (opcional)">
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <input ref={file} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
            <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
            <Button type="button" onClick={() => file.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar
            </Button>
            <Button type="button" variant="outline" onClick={() => camera.current?.click()} disabled={busy} title="Tirar foto pelo celular" aria-label="Tirar foto pelo celular">
              <Camera className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted sm:col-span-4">
            Imagem (PNG, JPG, WEBP) ou PDF até 5 MB. Dá para arrastar ou colar (Ctrl+V) a imagem aqui. O número do RG e do passaporte completa o cadastro quando ele estiver vazio.
          </p>
        </div>
      )}
      <ConfirmDialog
        open={!!remove}
        onClose={() => setRemove(null)}
        danger
        title="Remover documento?"
        description={remove ? `A imagem de ${CLIENT_DOC_KINDS.label(remove.kind)} será apagada do cadastro do cliente.` : ""}
        confirmLabel="Remover"
        onConfirm={async () => {
          if (remove) await run(() => deleteClientDocumentAction(remove.id), { onSuccess: () => (setRemove(null), router.refresh()) });
        }}
      />
    </div>
  );
}
