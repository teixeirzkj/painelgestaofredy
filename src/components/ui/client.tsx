"use client";
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { centsToInput, parseBRL } from "@/lib/money";
import { Button, Field, Input, Textarea } from "./index";

/** Campo monetário: mostra "1.234,56", entrega centavos. */
export function MoneyInput({ value, onChange, className, ...rest }: { value: number | null | undefined; onChange: (cents: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = React.useState(centsToInput(value ?? 0));
  const focused = React.useRef(false);
  React.useEffect(() => {
    if (!focused.current) setText(centsToInput(value ?? 0));
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
      <Input
        inputMode="decimal"
        className="pl-9 text-right tabular"
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(centsToInput(value ?? 0));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseBRL(e.target.value);
          if (c !== null) onChange(c);
          else if (e.target.value.trim() === "") onChange(0);
        }}
        {...rest}
      />
    </div>
  );
}

// ------------------------------ Modal e Drawer ------------------------------
export function Modal({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("flex max-h-[92vh] w-full animate-pop-in flex-col rounded-t-2xl bg-white shadow-[var(--shadow-pop)] sm:rounded-2xl", w)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in justify-end bg-slate-900/30 backdrop-blur-[1px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-xl animate-slide-in flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
            {description && <div className="mt-0.5 text-sm text-muted">{description}</div>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

/** Confirmação antes de operações destrutivas, com campo de motivo opcional. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmar",
  danger = true,
  reason,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  reason?: { label: string; required?: boolean };
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) setText("");
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            disabled={reason?.required && text.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(text);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-600">
        <div>{description}</div>
        {reason && (
          <Field label={reason.label} required={reason.required}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </Field>
        )}
      </div>
    </Modal>
  );
}

