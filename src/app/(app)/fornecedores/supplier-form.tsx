"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Archive } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ConfirmDialog, Modal } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { archiveSupplierAction, saveSupplierAction } from "@/app/actions";
import { BILLING_CYCLES, SUPPLIER_CATEGORIES } from "@/lib/constants";
import { formatDocument } from "@/lib/utils";

type S = { name: string; document: string | null; contactName: string | null; email: string | null; phone: string | null; category: string; billingCycle?: string; bankInfo: string | null; pixKey: string | null; notes: string | null };

export function SupplierButton({ id, initial }: { id?: string; initial?: S }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<S>(initial ? { ...initial, document: initial.document ? formatDocument(initial.document) : "" } : { name: "", document: "", contactName: "", email: "", phone: "", category: "OPERADORA", billingCycle: "AVULSO", bankInfo: "", pixKey: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const set = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  return (
    <>
      {id ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil className="h-4 w-4" /> Editar
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Novo fornecedor
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={id ? "Editar fornecedor" : "Novo fornecedor"}
        size="lg"
        footer={
          <Button
            loading={busy}
            onClick={async () => {
              const r = await run(() => saveSupplierAction(id ?? null, d), { onSuccess: (s) => (setOpen(false), !id && router.push(`/fornecedores/${s.id}`)) });
              if (!r.ok) setErrors(issuesToMap(r.issues));
            }}
          >
            Salvar
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome ou razão social" required error={errors.name} className="sm:col-span-2">
            <Input value={d.name} onChange={set("name")} autoFocus />
          </Field>
          <Field label="CNPJ" error={errors.document}>
            <Input value={d.document ?? ""} onChange={set("document")} inputMode="numeric" />
          </Field>
          <Field label="Categoria" required>
            <Select value={d.category} onChange={set("category")}>
              {SUPPLIER_CATEGORIES.values.map((v) => (
                <option key={v} value={v}>
                  {SUPPLIER_CATEGORIES.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Faturamento" hint="Decendial: entra na conciliação por decêndio">
            <Select value={d.billingCycle ?? "AVULSO"} onChange={set("billingCycle")}>
              {BILLING_CYCLES.values.map((v) => (
                <option key={v} value={v}>
                  {BILLING_CYCLES.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contato">
            <Input value={d.contactName ?? ""} onChange={set("contactName")} />
          </Field>
          <Field label="Telefone">
            <Input value={d.phone ?? ""} onChange={set("phone")} />
          </Field>
          <Field label="E-mail" error={errors.email} className="sm:col-span-2">
            <Input type="email" value={d.email ?? ""} onChange={set("email")} />
          </Field>
          <Field label="Dados bancários" hint="Visível apenas para perfis com acesso ao financeiro." className="sm:col-span-2">
            <Textarea value={d.bankInfo ?? ""} onChange={set("bankInfo")} placeholder="Banco, agência, conta" />
          </Field>
          <Field label="Chave PIX">
            <Input value={d.pixKey ?? ""} onChange={set("pixKey")} />
          </Field>
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={d.notes ?? ""} onChange={set("notes")} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function ArchiveSupplierButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run } = useAction();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4" /> Arquivar
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Arquivar fornecedor?"
        description="Ele deixa de aparecer na seleção de novas vendas. Só é possível arquivar sem contas a pagar em aberto. O histórico é preservado."
        confirmLabel="Arquivar"
        onConfirm={async () => {
          await run(() => archiveSupplierAction(id), { onSuccess: () => router.push("/fornecedores") });
        }}
      />
    </>
  );
}
