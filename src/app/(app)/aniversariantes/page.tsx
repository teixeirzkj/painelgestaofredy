import Link from "next/link";
import { Cake, ShieldCheck, ShieldOff, PartyPopper } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { workMonth } from "@/server/month";
import { birthdays } from "@/server/services/team";
import { Badge, Card, EmptyState, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Aniversariantes" };

export default async function BirthdaysPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const quem = (["clientes", "equipe"].includes(str(sp, "quem") ?? "") ? str(sp, "quem") : "todos") as "todos" | "clientes" | "equipe";
  const wm = await workMonth(ctx.timezone);
  const rows = await birthdays(ctx, wm.month, quem);

  return (
    <>
      <PageHeader title="Aniversariantes" description={<span>{rows.length} aniversariante(s) em {wm.label}</span>} />
      <Tabs
        active={quem}
        items={[
          { key: "todos", href: "/aniversariantes", label: "Todos" },
          { key: "clientes", href: "/aniversariantes?quem=clientes", label: "Clientes" },
          { key: "equipe", href: "/aniversariantes?quem=equipe", label: "Equipe" },
        ]}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Cake} title="Nenhum aniversariante encontrado" description="Cadastre a data de nascimento dos clientes e da equipe para acompanhar aqui. Troque o mês no topo da tela para ver outros meses." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Dia</Th>
                <Th>Nome</Th>
                <Th>Tipo</Th>
                <Th align="center">Idade</Th>
                <Th>Contato</Th>
                <Th>Mensagens automáticas</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className={cn(r.isToday && "bg-brand-25")}>
                  <Td className="w-20 py-3.5">
                    <span className={cn("flex h-10 w-10 flex-col items-center justify-center rounded-xl text-sm font-semibold", r.isToday ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700")}>{r.day}</span>
                  </Td>
                  <Td>
                    {r.href ? (
                      <Link href={r.href} className="font-medium text-brand-700 hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.name}</span>
                    )}
                    {r.isToday && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700">
                        <PartyPopper className="h-3.5 w-3.5" /> hoje
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={r.kind === "Cliente" ? "blue" : "violet"}>{r.kind}</Badge>
                  </Td>
                  <Td align="center">{r.age > 0 && r.age < 120 ? `${r.age} anos` : "—"}</Td>
                  <Td className="text-slate-600">{r.contact ?? "—"}</Td>
                  <Td>
                    {r.kind === "Cliente" ? (
                      r.consent ? (
                        <span className="inline-flex items-center gap-1 text-sm text-success">
                          <ShieldCheck className="h-4 w-4" /> autorizadas
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-muted">
                          <ShieldOff className="h-4 w-4" /> sem consentimento
                        </span>
                      )
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
