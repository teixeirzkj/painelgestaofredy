"use client";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ListTodo, FileSignature, Wallet, Cake } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Item = { id: string; title: string; date: string | null; href: string };

const TABS = [
  { key: "todos", label: "Todos" },
  { key: "tarefas", label: "Tarefas", icon: ListTodo },
  { key: "contratos", label: "Contratos", icon: FileSignature },
  { key: "creditos", label: "Créditos", icon: Wallet },
  { key: "aniversarios", label: "Aniversários", icon: Cake },
] as const;

/** Card "Para fazer" do painel do vendedor, com abas por tipo de pendência. */
export function TodoTabs({ tasks, contracts, credits, birthdays }: { tasks: Item[]; contracts: Item[]; credits: Item[]; birthdays: Item[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("todos");
  const groups = { tarefas: tasks, contratos: contracts, creditos: credits, aniversarios: birthdays };
  const icon = { tarefas: ListTodo, contratos: FileSignature, creditos: Wallet, aniversarios: Cake };
  const list = (tab === "todos" ? (Object.keys(groups) as (keyof typeof groups)[]).flatMap((k) => groups[k].map((i) => ({ ...i, kind: k }))) : groups[tab].map((i) => ({ ...i, kind: tab }))) as (Item & { kind: keyof typeof groups })[];
  const count = (k: string) => (k === "todos" ? tasks.length + contracts.length + credits.length + birthdays.length : groups[k as keyof typeof groups].length);
  return (
    <Card>
      <CardHeader title="Para fazer" description="o que pede ação" />
      <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              tab === t.key ? "border-brand-200 bg-brand-50 text-brand-700" : "border-line bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {t.label} <span className="text-subtle">{count(t.key)}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-50 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-medium text-ink">Tudo em dia</span>
            <span className="block text-xs text-muted">Nenhuma tarefa, contrato, crédito ou aniversário pendente.</span>
          </span>
        </div>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto">
          {list.map((i) => {
            const Icon = icon[i.kind];
            return (
              <li key={`${i.kind}-${i.id}`}>
                <Link href={i.href} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-slate-50">
                  <Icon className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{i.title}</span>
                  {i.date && <span className="shrink-0 text-xs text-muted">{formatDate(i.date)}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
