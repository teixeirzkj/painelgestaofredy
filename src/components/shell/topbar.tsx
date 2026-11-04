"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, Plus, LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { logoutAction } from "@/app/actions";

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      className="relative hidden w-full max-w-sm md:block"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/vendas?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar venda, cliente, destino ou localizador…"
        aria-label="Busca rápida"
        className="h-9 w-full rounded-lg border border-line bg-slate-50 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
    </form>
  );
}

export function NewSaleButton() {
  const router = useRouter();
  return (
    <Button onClick={() => router.push("/vendas/nova")}>
      <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nova venda</span>
    </Button>
  );
}

export function UserMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-ink">{name}</span>
          <span className="block text-[11px] text-muted">{role}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-line bg-white py-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
          <form action={logoutAction}>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
