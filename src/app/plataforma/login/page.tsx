import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPlatformContext } from "@/server/platform";
import { PlatformLoginForm } from "./form";

export const metadata = { title: "Plataforma · Entrar" };

export default async function PlatformLoginPage() {
  if (await getPlatformContext()) redirect("/plataforma");
  return (
    <div className="bg-sidebar-gradient flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[var(--shadow-pop)]">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-ink">Painel da plataforma</h1>
        <p className="mt-1 text-sm text-muted">Acesso restrito à equipe Frédy para administrar as contas das agências.</p>
        <PlatformLoginForm />
        {process.env.NODE_ENV !== "production" && <p className="mt-6 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Demonstração: plataforma@fredy.demo · demo1234</p>}
      </div>
    </div>
  );
}
