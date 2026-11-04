"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";

/** Executa uma server action com feedback (toast), estado de carregamento e atualização da página. */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function run<T>(fn: () => Promise<ActionResult<T>>, opts: { success?: string | false; onSuccess?: (data: T) => void; refresh?: boolean } = {}) {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error);
        return { ok: false as const, issues: r.issues ?? [] };
      }
      if (opts.success !== false) {
        const msg = opts.success ?? r.message;
        if (msg) toast.success(msg);
      }
      opts.onSuccess?.(r.data);
      if (opts.refresh !== false) startTransition(() => router.refresh());
      return { ok: true as const, data: r.data };
    } catch {
      toast.error("Falha de comunicação. Verifique a conexão e tente novamente.");
      return { ok: false as const, issues: [] };
    } finally {
      setBusy(false);
    }
  }

  return { run, busy: busy || pending };
}

export function issuesToMap(issues: { field: string; message: string }[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const i of issues) if (!m[i.field]) m[i.field] = i.message;
  return m;
}
