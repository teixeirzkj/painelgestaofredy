import { redirect } from "next/navigation";
import { Plane, ShieldCheck } from "lucide-react";
import { getContext } from "@/server/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getContext()) redirect("/");
  const demo = process.env.NODE_ENV !== "production";
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="bg-sidebar-gradient hidden flex-col justify-between p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand-600">
            <Plane className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">Frédy Gestão</span>
        </div>
        <div className="max-w-md">
          <h1 className="font-display text-3xl font-bold leading-tight">Venda concluída, operação organizada.</h1>
          <p className="mt-4 text-blue-100/80">
            Lance a venda uma única vez e o sistema prepara contas a receber, pagamentos a fornecedores, comissões e contrato automaticamente.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-blue-200/70">
          <ShieldCheck className="h-4 w-4" /> Dados isolados por agência e acesso por perfil.
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="font-display text-2xl font-bold text-ink">Entrar</h2>
          <p className="mt-1 text-sm text-muted">Acesse a gestão da sua agência.</p>
          <LoginForm />
          {demo && (
            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <p className="mb-2 font-semibold">Ambiente de demonstração — usuários fictícios (senha: demo1234)</p>
              <ul className="space-y-0.5 font-mono">
                <li>admin@azulviagens.demo — Administrador</li>
                <li>gestora@azulviagens.demo — Gestor</li>
                <li>ana@azulviagens.demo — Vendedora</li>
                <li>financeiro@azulviagens.demo — Financeiro</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
