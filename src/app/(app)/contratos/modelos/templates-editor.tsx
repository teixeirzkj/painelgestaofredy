"use client";
import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { saveTemplateAction, createSuggestedTemplatesAction } from "@/app/actions";
import { PRODUCT_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Trecho dos modelos antigos que só serve para CPF/CNPJ (não identifica o cliente estrangeiro). */
const OLD_DOC = /CPF\/CNPJ:?\s*\{\{\s*cliente\.documento\s*\}\}/;
const OLD_DOC_ALL = new RegExp(OLD_DOC.source, "g");

type T = { id: string | null; name: string; productType: string; body: string; clauses: string; active: boolean; version: number };

export function TemplatesEditor({ templates, variables }: { templates: T[]; variables: { key: string; label: string; required?: boolean }[] }) {
  const [list, setList] = useState(templates);
  const [sel, setSel] = useState<T | null>(templates[0] ?? null);
  const { run, busy } = useAction();
  const router = useRouter();

  const blank: T = { id: null, name: "Novo modelo", productType: "OUTROS", body: "CONTRATO DE PRESTAÇÃO DE SERVIÇOS\n\nCONTRATANTE: {{cliente.nome}}, {{cliente.identificacao}}\n\n{{clausulas}}", clauses: "", active: true, version: 0 };

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr_260px]">
      <Card className="h-fit p-2">
        {list.map((t) => (
          <button key={t.id ?? "novo"} onClick={() => setSel(t)} className={cn("w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50", sel?.id === t.id && "bg-brand-50")}>
            <span className="block font-medium">{t.name}</span>
            <span className="flex items-center gap-1 text-xs text-muted">
              {PRODUCT_TYPES.label(t.productType)} · v{t.version} {!t.active && <Badge>Inativo</Badge>}
            </span>
          </button>
        ))}
        <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setSel(blank)}>
          <Plus className="h-4 w-4" /> Novo modelo
        </Button>
      </Card>
      {sel ? (
        <Card className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nome" className="sm:col-span-2">
              <Input value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} />
            </Field>
            <Field label="Tipo de produto">
              <Select value={sel.productType} onChange={(e) => setSel({ ...sel, productType: e.target.value })}>
                {PRODUCT_TYPES.values.map((v) => (
                  <option key={v} value={v}>
                    {PRODUCT_TYPES.label(v)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Texto do contrato" hint="Use {{clausulas}} onde as cláusulas específicas devem aparecer.">
            <Textarea className="min-h-80 font-mono text-xs" value={sel.body} onChange={(e) => setSel({ ...sel, body: e.target.value })} />
          </Field>
          {OLD_DOC.test(sel.body) && (
            <Notice tone="amber" title="Contrato de cliente estrangeiro">
              <p>
                Para clientes estrangeiros, troque &quot;CPF/CNPJ {"{{cliente.documento}}"}&quot; por &quot;{"{{cliente.identificacao}}"}&quot;: o contrato mostra CPF, CNPJ, passaporte ou
                RNE conforme o cadastro.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setSel({ ...sel, body: sel.body.replace(OLD_DOC_ALL, "{{cliente.identificacao}}") })}>
                Trocar no texto
              </Button>
              <p className="mt-1 text-xs">Depois de trocar, clique em Salvar modelo.</p>
            </Notice>
          )}
          <Field label="Cláusulas específicas do produto (cancelamento, alteração, reembolso)">
            <Textarea className="min-h-40 font-mono text-xs" value={sel.clauses} onChange={(e) => setSel({ ...sel, clauses: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sel.active} onChange={(e) => setSel({ ...sel, active: e.target.checked })} /> Modelo ativo
          </label>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">Salvar cria uma nova versão; contratos já emitidos não são alterados.</p>
            <Button
              loading={busy}
              onClick={() =>
                run(() => saveTemplateAction(sel.id, { name: sel.name, productType: sel.productType, body: sel.body, clauses: sel.clauses, active: sel.active }), {
                  onSuccess: (t) => {
                    const saved = { ...sel, id: t.id, version: t.version };
                    setList((l) => (sel.id ? l.map((x) => (x.id === sel.id ? saved : x)) : [...l, saved]));
                    setSel(saved);
                  },
                })
              }
            >
              Salvar modelo
            </Button>
          </div>
        </Card>
      ) : list.length === 0 ? (
        <Card className="space-y-3 p-8 text-center">
          <p className="font-medium text-ink">Nenhum modelo de contrato ainda</p>
          <p className="text-sm text-muted">Sem modelo, o contrato das vendas fica como "não gerado". Carregue os 5 modelos sugeridos (pacote, aéreo, hospedagem, cruzeiro e outros) e revise o texto com o jurídico da agência.</p>
          <Button loading={busy} onClick={() => run(() => createSuggestedTemplatesAction(), { onSuccess: () => router.refresh() })}>
            <Sparkles className="h-4 w-4" /> Carregar modelos sugeridos
          </Button>
        </Card>
      ) : (
        <Card className="p-8 text-center text-sm text-muted">Selecione ou crie um modelo.</Card>
      )}
      <Card className="h-fit p-4">
        <h3 className="mb-2 text-sm font-semibold">Variáveis disponíveis</h3>
        <p className="mb-3 text-xs text-muted">Clique para copiar. As marcadas com * são obrigatórias para emitir.</p>
        <ul className="space-y-1">
          {variables.map((v) => (
            <li key={v.key}>
              <button className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-slate-50" onClick={() => navigator.clipboard?.writeText(`{{${v.key}}}`)}>
                <code className="text-brand-700">{`{{${v.key}}}`}</code>
                {v.required && <span className="text-danger">*</span>}
                <span className="block text-muted">{v.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
