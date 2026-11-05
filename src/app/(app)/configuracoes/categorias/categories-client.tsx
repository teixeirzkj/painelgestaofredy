"use client";
import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { saveExpenseCategoryAction } from "@/app/actions";
import { cn } from "@/lib/utils";

type Cat = { id: string; name: string; group: string; inDre: boolean; active: boolean; system: boolean };

export function CategoryEditor({ category, group, groups, trigger }: { category?: Cat; group?: string; groups: string[]; trigger: "new" | "add" | "edit" }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const blank = { name: "", group: group ?? groups[0] ?? "", inDre: true, active: true };
  const [f, setF] = useState(category ? { name: category.name, group: category.group, inDre: category.inDre, active: category.active } : blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const openIt = () => {
    setF(category ? { name: category.name, group: category.group, inDre: category.inDre, active: category.active } : blank);
    setErrors({});
    setOpen(true);
  };
  return (
    <>
      {trigger === "new" && (
        <Button onClick={openIt}>
          <Plus className="h-4 w-4" /> Nova categoria
        </Button>
      )}
      {trigger === "add" && (
        <button onClick={openIt} className="inline-flex items-center gap-1.5 py-1 text-sm font-medium text-brand-600 hover:underline">
          <Plus className="h-3.5 w-3.5" /> Adicionar categoria
        </button>
      )}
      {trigger === "edit" && (
        <button onClick={openIt} className="rounded-md p-1 text-subtle opacity-0 transition-opacity hover:bg-brand-25 hover:text-ink group-hover:opacity-100" aria-label={`Editar ${category?.name}`}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={category ? "Editar categoria" : "Nova categoria"}
        description={category?.system ? "Categoria usada pelas regras automáticas: só o nome e o grupo podem mudar." : "Os valores lançados nesta categoria aparecem no DRE dentro do grupo escolhido."}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(() => saveExpenseCategoryAction(category?.id ?? null, f), { onSuccess: () => setOpen(false) });
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Nome" required error={errors.name}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Grupo" required hint="Escolha um grupo existente ou digite um novo." error={errors.group}>
            <Input list="grupos-categorias" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} />
            <datalist id="grupos-categorias">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <label className={cn("flex items-center gap-2 text-sm", category?.system && "opacity-50")}>
            <input type="checkbox" className="accent-brand-600" disabled={category?.system} checked={f.inDre} onChange={(e) => setF({ ...f, inDre: e.target.checked })} /> Entra no DRE (desmarque para repasses, como reembolsos)
          </label>
          <label className={cn("flex items-center gap-2 text-sm", category?.system && "opacity-50")}>
            <input type="checkbox" className="accent-brand-600" disabled={category?.system} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativa (inativas não aparecem em novos lançamentos)
          </label>
        </div>
      </Modal>
    </>
  );
}
