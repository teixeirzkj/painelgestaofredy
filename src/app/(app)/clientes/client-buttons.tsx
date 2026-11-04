"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui";
import { ConfirmDialog, Modal } from "@/components/ui/client";
import { ClientForm, type ClientFormData } from "@/components/forms/client-form";
import { useAction } from "@/components/use-action";
import { archiveClientAction } from "@/app/actions";

export function NewClientButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Novo cliente
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Novo cliente" size="lg">
        <ClientForm onCancel={() => setOpen(false)} onSaved={(c) => (setOpen(false), router.push(`/clientes/${c.id}`))} />
      </Modal>
    </>
  );
}

export function EditClientButton({ id, initial }: { id: string; initial: Partial<ClientFormData> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> Editar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Editar cliente" size="lg">
        <ClientForm id={id} initial={initial} onCancel={() => setOpen(false)} onSaved={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function ArchiveClientButton({ id, archived }: { id: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const { run } = useAction();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />} {archived ? "Reativar" : "Arquivar"}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        danger={!archived}
        title={archived ? "Reativar cliente?" : "Arquivar cliente?"}
        description={archived ? "O cliente volta a aparecer nas buscas." : "O cliente deixa de aparecer nas buscas de novas vendas. O histórico de vendas e lançamentos é preservado."}
        confirmLabel={archived ? "Reativar" : "Arquivar"}
        onConfirm={async () => {
          await run(() => archiveClientAction(id, !archived), { onSuccess: () => setOpen(false) });
        }}
      />
    </>
  );
}
