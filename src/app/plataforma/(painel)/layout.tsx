import Link from "next/link";
import { ShieldCheck, LogOut } from "lucide-react";
import { requirePlatform } from "@/server/platform";
import { platformLogoutAction } from "../actions";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const p = await requirePlatform();
  return (
    <div className="min-h-screen">
      <header className="bg-sidebar-gradient text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/plataforma" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <ShieldCheck className="h-[18px] w-[18px]" />
            </span>
            <span>
              <span className="block text-sm font-semibold leading-tight">Frédy Gestão</span>
              <span className="block text-[11px] uppercase tracking-[0.12em] text-white/60">Painel da plataforma</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-white/70 sm:inline">{p.name}</span>
            <form action={platformLogoutAction}>
              <button className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-white/80 hover:bg-white/10 hover:text-white">
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
