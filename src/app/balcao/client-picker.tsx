"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, UserCheck } from "lucide-react";
import { Card, CardHeader, Input } from "@/components/ui";
import { ClientForm } from "@/components/forms/client-form";
import { searchClientsAction, startBalcaoFlowAction } from "@/app/actions";
import { toast } from "sonner";
import { formatDocument } from "@/lib/utils";

type Found = { id: string; name: string; document: string | null; whatsapp: string | null; email: string | null; reason?: string };

/** Etapa 1: achar o cliente (sugestões pelo contato do card, busca) ou cadastrar um novo. */
export function ClientPicker({ card, canCreate, matches, prefill }: { card: string | null; canCreate: boolean; matches: Found[]; prefill: { name: string; email: string; whatsapp: string; document: string } }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [creating, setCreating] = useState(matches.length === 0);
  // abre (ou retoma) o atendimento do cliente: a tela passa a lembrar em que etapa ele está
  const go = async (id: string) => {
    const r = await startBalcaoFlowAction(id, card);
    if (!r.ok) return toast.error(r.error);
    router.push(`/balcao/a/${r.data.id}`);
  };

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(async () => {
      const r = await searchClientsAction(q.trim());
      if (r.ok) setResults(r.data as Found[]);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const Row = ({ c }: { c: Found }) => (
    <li>
      <button type="button" onClick={() => go(c.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
        <UserCheck className="h-4 w-4 shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{c.name}</span>
          <span className="block truncate text-xs text-muted">{[c.document && formatDocument(c.document), c.whatsapp, c.email].filter(Boolean).join(" · ") || "sem documento"}</span>
        </span>
        {c.reason && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{c.reason}</span>}
        <span className="text-xs font-medium text-brand-700">Usar</span>
      </button>
    </li>
  );

  return (
    <div className="space-y-5">
      {matches.length > 0 && (
        <Card>
          <CardHeader title="Cliente já cadastrado?" description="Encontramos estes cadastros com os dados do contato." />
          <ul className="divide-y divide-line border-t border-line">
            {matches.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Buscar cliente" description="Por nome, CPF ou telefone" icon={Search} />
        <div className="px-5 pb-4">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite para buscar…" aria-label="Buscar cliente" autoFocus={matches.length > 0} />
        </div>
        {results.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {results.map((c) => (
              <Row key={c.id} c={c} />
            ))}
          </ul>
        )}
      </Card>
      {canCreate && (
        <Card>
          <CardHeader
            title="Cadastrar novo cliente"
            icon={UserPlus}
            action={
              !creating && (
                <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setCreating(true)}>
                  Abrir cadastro
                </button>
              )
            }
          />
          {creating && (
            <div className="border-t border-line p-5">
              <ClientForm
                initial={{ name: prefill.name, email: prefill.email || null, whatsapp: prefill.whatsapp || null, document: prefill.document || null }}
                onCancel={() => setCreating(false)}
                onSaved={(c) => go(c.id)}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
