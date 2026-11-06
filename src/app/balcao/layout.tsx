import Link from "next/link";
import { ExternalLink, Plane } from "lucide-react";
import { getContext } from "@/server/auth";
import { prisma } from "@/server/db";
import { BalcaoSteps } from "./steps";

export const metadata = { title: "Venda rápida" };

/** Tela do vendedor para abrir em popup: só cliente, venda e contrato, sem o menu da gestão. */
export default async function BalcaoLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const company = ctx ? await prisma.company.findUnique({ where: { id: ctx.companyId }, select: { name: true, tradeName: true } }) : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Plane className="h-4 w-4" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-ink">Venda rápida</span>
              {company && <span className="block text-[11px] text-muted">{company.tradeName || company.name}</span>}
            </span>
          </span>
          {ctx && <BalcaoSteps />}
          {ctx && (
            <Link href="/" target="_blank" className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-brand-700">
              Abrir a gestão completa <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
