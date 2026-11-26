import Link from "next/link";
import { Check, IdCard, LogOut, Plane, Users, Workflow } from "lucide-react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { BALCAO_STEPS } from "@/server/services/balcao";
import { logoutAction } from "@/app/actions";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho da venda rápida com as 7 etapas: a feita vira um círculo verde, a que está na tela mostra o nome,
 * as próximas ficam só com o número. Dentro de um atendimento, as etapas feitas são clicáveis (para rever).
 */
export async function BalcaoHeader({ ctx, view, done, baseHref, sheetHref = "/balcao/ficha", showSteps = true }: { ctx: Ctx; view: number; done: boolean[]; baseHref?: string; sheetHref?: string | null; showSteps?: boolean }) {
  const company = await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { name: true, tradeName: true } });
  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Plane className="h-4 w-4" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold text-ink">Venda rápida</span>
            <span className="block text-[11px] text-muted">{company?.tradeName || company?.name}</span>
          </span>
        </span>
        {!showSteps && <span className="flex-1" />}
        {showSteps && <ol className="flex flex-1 flex-wrap items-center justify-center gap-1.5 text-xs" aria-label="Etapas do atendimento">
          {BALCAO_STEPS.map((name, i) => {
            const n = i + 1;
            const isView = n === view;
            const isDone = done[i];
            const label = `Etapa ${n}: ${name}${isDone ? " (feita)" : ""}`;
            let el: React.ReactNode;
            if (isView)
              el = (
                <span
                  className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold", isDone ? "bg-emerald-600 text-white" : "bg-brand-600 text-white")}
                  aria-current="step"
                >
                  {isDone ? <Check className="h-3 w-3" /> : <span className="tabular">{n}</span>} {name}
                </span>
              );
            else if (isDone)
              el = (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white" title={label}>
                  <Check className="h-3.5 w-3.5" />
                  <span className="sr-only">{label}</span>
                </span>
              );
            else
              el = (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 font-medium tabular text-muted" title={label}>
                  {n}
                  <span className="sr-only">{label}</span>
                </span>
              );
            return (
              <li key={name} className="flex items-center gap-1.5">
                {i > 0 && <span className={cn("h-px w-3", done[i - 1] ? "bg-emerald-300" : "bg-line")} aria-hidden />}
                {isDone && !isView && baseHref && n >= 2 ? (
                  <Link href={`${baseHref}?etapa=${n}`} className="rounded-full hover:ring-2 hover:ring-emerald-200">
                    {el}
                  </Link>
                ) : (
                  el
                )}
              </li>
            );
          })}
        </ol>}
        {sheetHref && (
          <Link href={sheetHref} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-slate-50" title="Dados de todos os passageiros da viagem, prontos para copiar">
            <IdCard className="h-3.5 w-3.5" /> Ficha dos passageiros
          </Link>
        )}
        <form action={logoutAction}>
          <button type="submit" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink" title={`Sair (${ctx.userName})`}>
            <LogOut className="h-3.5 w-3.5" /> Sair
          </button>
        </form>
      </div>
    </header>
  );
}

/** As duas entradas do popup: o atendimento (orçamento até o contrato) e a área de clientes (só cadastro). */
export function ModeTabs({ active, attendHref = "/balcao" }: { active: "atendimento" | "clientes"; attendHref?: string }) {
  const tab = (on: boolean) => cn("flex flex-1 items-start gap-3 rounded-xl border px-4 py-3 text-left transition", on ? "border-brand-500 bg-brand-25 ring-2 ring-brand-100" : "border-line bg-white hover:bg-slate-50");
  return (
    <nav className="grid gap-3 sm:grid-cols-2" aria-label="O que você quer fazer">
      <Link href={attendHref} className={tab(active === "atendimento")} aria-current={active === "atendimento" ? "page" : undefined}>
        <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <span>
          <span className="block font-semibold text-ink">Atendimento</span>
          <span className="block text-xs text-muted">Orçamento, venda e contrato, nas 7 etapas.</span>
        </span>
      </Link>
      <Link href="/balcao/clientes" className={tab(active === "clientes")} aria-current={active === "clientes" ? "page" : undefined}>
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <span>
          <span className="block font-semibold text-ink">Clientes</span>
          <span className="block text-xs text-muted">Cadastrar ou atualizar clientes, sem abrir venda nem contrato.</span>
        </span>
      </Link>
    </nav>
  );
}

/** Caixa da etapa: título, o que fazer e o conteúdo. */
export function StepBox({ n, title, optional, children, steps }: { n: number; title: string; optional?: boolean; children?: React.ReactNode; steps?: React.ReactNode[] }) {
  return (
    <section className="rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]">
      <div className="border-b border-line px-5 py-4">
        <p className="text-xs font-medium text-muted">
          Etapa {n} de {BALCAO_STEPS.length}
          {optional && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">recomendado, não obrigatório</span>}
        </p>
        <h1 className="font-display text-lg font-semibold text-ink">{title}</h1>
        {steps && steps.length > 0 && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
      </div>
      {children}
    </section>
  );
}
