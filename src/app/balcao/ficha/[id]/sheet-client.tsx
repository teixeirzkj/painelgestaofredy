"use client";
import { toast } from "sonner";
import { Copy, CopyCheck, TriangleAlert } from "lucide-react";
import type { SheetPerson } from "@/server/services/passenger-sheet";
import { cn } from "@/lib/utils";

const ddmmyyyy = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : v);
const cpf = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return v;
};
const gender = (g: string | null) => (g === "F" ? "Feminino" : g === "M" ? "Masculino" : null);

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copiado.`),
    () => toast.error("Não foi possível copiar. Selecione e copie manualmente."),
  );
}

/** Campos da pessoa na ordem em que costumam ser pedidos na emissão. */
function fields(p: SheetPerson) {
  const parts = p.name.trim().split(/\s+/);
  return [
    { label: "Nome completo", value: p.name, required: true },
    { label: "Nome", value: parts[0] ?? null },
    { label: "Sobrenome", value: parts.slice(1).join(" ") || null },
    { label: p.document && p.document.replace(/\D/g, "").length === 14 ? "CNPJ" : "CPF", value: cpf(p.document), raw: p.document, required: !p.foreigner },
    { label: "Nascimento", value: ddmmyyyy(p.birthDate), required: true },
    { label: "Sexo", value: gender(p.gender) },
    { label: "RG", value: p.rg },
    { label: "Passaporte", value: p.passportNumber, required: p.foreigner },
    { label: "Validade do passaporte", value: ddmmyyyy(p.passportExpiry) },
    ...(p.foreigner ? [{ label: "Nacionalidade", value: p.nationality }, { label: "RNE / RNM", value: p.rne }] : []),
    { label: "E-mail", value: p.email },
    { label: "Telefone", value: p.phone },
  ] as { label: string; value: string | null; raw?: string | null; required?: boolean }[];
}

/** Texto de uma pessoa para colar (só o que está preenchido). */
function personText(p: SheetPerson) {
  return fields(p)
    .filter((f) => f.value && f.label !== "Nome" && f.label !== "Sobrenome")
    .map((f) => `${f.label}: ${f.value}`)
    .join("\n");
}

export function PassengerCards({ people }: { people: SheetPerson[] }) {
  if (!people.length) return <p className="rounded-[14px] border border-line bg-white p-5 text-sm text-muted">Nenhum passageiro cadastrado nesta venda.</p>;
  const all = people.map((p, i) => `${i + 1}. ${p.role === "CLIENTE" ? "Cliente (comprador)" : "Passageiro"}\n${personText(p)}`).join("\n\n");
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => copy(all, "Todos os passageiros")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">
          <CopyCheck className="h-4 w-4" /> Copiar todos ({people.length})
        </button>
      </div>
      {people.map((p, i) => {
        const fs = fields(p);
        const missing = fs.filter((f) => f.required && !f.value).map((f) => f.label);
        const expired = p.passportExpiry && p.passportExpiry < new Date().toISOString().slice(0, 10);
        return (
          <section key={i} className="rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
              <div>
                <p className="text-xs font-medium text-muted">
                  {i + 1}. {p.role === "CLIENTE" ? "Cliente (comprador)" : "Passageiro"}
                  {p.foreigner && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Estrangeiro</span>}
                </p>
                <p className="font-semibold text-ink">{p.name}</p>
              </div>
              <button type="button" onClick={() => copy(personText(p), p.name)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium hover:bg-slate-50">
                <Copy className="h-3.5 w-3.5" /> Copiar dados
              </button>
            </div>
            {(missing.length > 0 || expired) && (
              <p className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                {missing.length > 0 && <>Falta: {missing.join(", ")}. </>}
                {expired && <>Passaporte vencido.</>}
              </p>
            )}
            <dl className="grid gap-x-6 gap-y-1 px-5 py-3 sm:grid-cols-2">
              {fs.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-2 border-b border-dashed border-line py-1.5 last:border-0">
                  <dt className="text-xs text-muted">{f.label}</dt>
                  {f.value ? (
                    <dd>
                      <button type="button" onClick={() => copy(f.raw ?? f.value!, f.label)} className="group inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-right text-sm font-medium text-ink hover:bg-brand-50" title={`Copiar ${f.label.toLowerCase()}`}>
                        <span className="tabular">{f.value}</span>
                        <Copy className="h-3 w-3 text-muted opacity-60 group-hover:opacity-100" />
                      </button>
                    </dd>
                  ) : (
                    <dd className={cn("text-xs", f.required ? "font-medium text-amber-700" : "text-muted")}>{f.required ? "falta" : "—"}</dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
