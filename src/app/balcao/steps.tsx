"use client";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = ["Cliente", "Venda", "Contrato"];

/** Indicador das três etapas da venda rápida. */
export function BalcaoSteps() {
  const path = usePathname();
  const current = path === "/balcao" ? 0 : path.startsWith("/balcao/venda") || path.endsWith("/editar") ? 1 : 2;
  return (
    <ol className="flex items-center gap-1.5 text-xs" aria-label="Etapas">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          {i > 0 && <span className="h-px w-4 bg-line" aria-hidden />}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium",
              i < current && "bg-emerald-50 text-emerald-700",
              i === current && "bg-brand-600 text-white",
              i > current && "bg-slate-100 text-muted",
            )}
            aria-current={i === current ? "step" : undefined}
          >
            {i < current ? <Check className="h-3 w-3" /> : <span className="tabular">{i + 1}</span>} {s}
          </span>
        </li>
      ))}
    </ol>
  );
}
