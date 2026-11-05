import { auditActionLabel } from "@/lib/constants";
import Link from "next/link";
import { LogIn, Users, Clock, History } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { today } from "@/server/context";
import { listAccessLogs } from "@/server/services/admin";
import { listAudit } from "@/server/services/settings";
import { Badge, Card, EmptyState, KpiCard, PageHeader, Pagination, Table, Tabs, Td, Th, type Tone } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { addDays, formatDateTime } from "@/lib/dates";
import { int, str, withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Log de acessos" };

const TYPE: Record<string, { label: string; tone: Tone }> = { LOGIN: { label: "Entrada", tone: "green" }, LOGOUT: { label: "Saída", tone: "gray" }, FALHA: { label: "Tentativa recusada", tone: "red" } };

export default async function AccessLogPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("settings.manage");
  const sp = await searchParams;
  const tab = str(sp, "aba") === "acoes" ? "acoes" : "acessos";
  const t = today(ctx);
  const periodo = str(sp, "periodo");
  const from = periodo === "hoje" ? t : periodo === "semana" ? addDays(t, -7) : periodo === "mes" ? addDays(t, -30) : undefined;
  const logs = await listAccessLogs(ctx, { userId: str(sp, "membro"), type: str(sp, "tipo"), from, page: tab === "acessos" ? int(sp, "pagina") : 1 });
  const audit = tab === "acoes" ? await listAudit(ctx, int(sp, "pagina")) : null;

  return (
    <>
      <PageHeader back={{ href: "/configuracoes", label: "Configurações" }} title="Log de acessos" description="Registro de entradas no sistema e das ações realizadas pela equipe." />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Acessos hoje" value={String(logs.stats.loginsToday)} icon={LogIn} />
        <KpiCard label="Usuários ativos hoje" value={String(logs.stats.usersToday)} icon={Users} tone="green" />
        <KpiCard label="Último acesso" value={logs.stats.last ? logs.stats.last.name : "—"} icon={Clock} tone="violet" hint={logs.stats.last ? formatDateTime(logs.stats.last.at, ctx.timezone) : undefined} />
      </section>
      <Tabs
        active={tab}
        items={[
          { key: "acessos", href: "/configuracoes/acessos", label: "Acessos (entrada e saída)" },
          { key: "acoes", href: "/configuracoes/acessos?aba=acoes", label: "Ações (auditoria)" },
        ]}
      />
      {tab === "acessos" ? (
        <Card>
          <div className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-3">
            <FilterForm>
              <FilterSelect name="membro" label="Membro" value={str(sp, "membro")} options={logs.users.map((u) => ({ value: u.id, label: u.name }))} all="Todos os membros" />
              <FilterSelect
                name="tipo"
                label="Tipo"
                value={str(sp, "tipo")}
                options={[
                  { value: "LOGIN", label: "Entrada" },
                  { value: "LOGOUT", label: "Saída" },
                  { value: "FALHA", label: "Tentativa recusada" },
                ]}
                all="Todos os tipos"
              />
              {periodo && <input type="hidden" name="periodo" value={periodo} />}
            </FilterForm>
            <div className="flex rounded-xl border border-line bg-white p-0.5">
              {[
                { k: "", label: "Tudo" },
                { k: "hoje", label: "Hoje" },
                { k: "semana", label: "Última semana" },
                { k: "mes", label: "Último mês" },
              ].map((o) => (
                <Link key={o.k} href={withParams("/configuracoes/acessos", sp, { periodo: o.k || undefined, pagina: undefined })} className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", (periodo ?? "") === o.k ? "bg-brand-600 text-white" : "text-muted hover:text-ink")}>
                  {o.label}
                </Link>
              ))}
            </div>
          </div>
          {logs.items.length === 0 ? (
            <EmptyState icon={History} title="Nenhum registro encontrado" description="As entradas e saídas passam a ser registradas a partir de agora." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Membro</Th>
                  <Th>Tipo</Th>
                  <Th>IP</Th>
                  <Th>Navegador</Th>
                </tr>
              </thead>
              <tbody>
                {logs.items.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(l.createdAt, ctx.timezone)}</Td>
                    <Td>
                      <p className="font-medium">{l.userName}</p>
                      {l.userName !== l.email && <p className="text-xs text-muted">{l.email}</p>}
                    </Td>
                    <Td>
                      <Badge tone={TYPE[l.type]?.tone ?? "gray"} dot>
                        {TYPE[l.type]?.label ?? l.type}
                      </Badge>
                    </Td>
                    <Td className="font-mono text-xs text-slate-600">{l.ip ?? "—"}</Td>
                    <Td className="max-w-72 truncate text-xs text-muted" title={l.userAgent ?? undefined}>
                      {l.userAgent ?? "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination page={logs.page} pages={logs.pages} total={logs.total} hrefFor={(p) => withParams("/configuracoes/acessos", sp, { pagina: p })} />
        </Card>
      ) : (
        audit && (
          <Card>
            {audit.items.length === 0 ? (
              <EmptyState icon={History} title="Nenhuma ação registrada" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Quando</Th>
                    <Th>Usuário</Th>
                    <Th>Ação</Th>
                    <Th>Registro</Th>
                  </tr>
                </thead>
                <tbody>
                  {audit.items.map((a) => (
                    <tr key={a.id}>
                      <Td className="whitespace-nowrap">{formatDateTime(a.createdAt, ctx.timezone)}</Td>
                      <Td>{a.user?.name ?? "Sistema"}</Td>
                      <Td>
                        <Badge tone="blue">{auditActionLabel(a.action)}</Badge>
                      </Td>
                      <Td className="text-xs text-muted">
                        {a.entityType}
                        {a.entityId ? ` · ${a.entityId.slice(-8)}` : ""}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <Pagination page={audit.page} pages={audit.pages} total={audit.total} hrefFor={(p) => withParams("/configuracoes/acessos", sp, { pagina: p })} />
          </Card>
        )
      )}
    </>
  );
}
