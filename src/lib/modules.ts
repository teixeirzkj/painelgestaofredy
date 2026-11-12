/**
 * Módulos do painel que a plataforma liga e desliga por agência (Plataforma › Agência › Módulos).
 * Módulo desligado some do menu e a página fica bloqueada para todos os usuários da agência.
 * O Dashboard e as configurações básicas da agência não entram aqui (sempre ligados).
 */
export type ModuleDef = {
  key: string;
  label: string;
  group: string;
  /** caminhos do painel que pertencem ao módulo (prefixos) */
  paths: string[];
  /** como vem para uma agência nova ou que nunca mexeu no módulo */
  defaultOn: boolean;
  description?: string;
};

export const MODULES: ModuleDef[] = [
  { key: "painel_vendedor", label: "Painel do vendedor", group: "Dashboards", paths: ["/vendedor"], defaultOn: true },
  { key: "relatorios", label: "Relatórios", group: "Dashboards", paths: ["/relatorios"], defaultOn: true },
  { key: "vendas", label: "Vendas", group: "Vendas", paths: ["/vendas"], defaultOn: true },
  { key: "viagens", label: "Viagens", group: "Vendas", paths: ["/viagens"], defaultOn: true },
  { key: "excursoes", label: "Excursões e grupos", group: "Vendas", paths: ["/excursoes"], defaultOn: true },
  { key: "contratos", label: "Contratos", group: "Vendas", paths: ["/contratos"], defaultOn: true },
  { key: "clientes", label: "Clientes", group: "Vendas", paths: ["/clientes"], defaultOn: true },
  { key: "central_viagem", label: "Central da Viagem", group: "Vendas", paths: ["/central-viagem"], defaultOn: true },
  {
    key: "monitor_voos",
    label: "Monitor de voos (cancelamento, atraso, horário)",
    group: "Vendas",
    paths: [],
    defaultOn: false,
    description: "Confere os voos dos clientes no AeroDataBox todo dia e mostra os alertas na Central da Viagem. Gasta consultas do plano da plataforma.",
  },
  { key: "embarques", label: "Próximos embarques", group: "Vendas", paths: ["/embarques"], defaultOn: true },
  { key: "creditos", label: "Créditos", group: "Vendas", paths: ["/creditos"], defaultOn: true },
  { key: "aniversariantes", label: "Aniversariantes", group: "Vendas", paths: ["/aniversariantes"], defaultOn: true },
  { key: "solicitacoes", label: "Solicitações de edição", group: "Vendas", paths: ["/solicitacoes"], defaultOn: true },
  { key: "financeiro", label: "Financeiro (todas as telas)", group: "Financeiro", paths: ["/financeiro", "/configuracoes/categorias", "/configuracoes/taxas-cartao"], defaultOn: true },
  { key: "equipe", label: "Equipe (metas, ranking, tarefas, calendário)", group: "Equipe", paths: ["/equipe"], defaultOn: true },
  { key: "marketing", label: "Marketing (destinos e hotéis)", group: "Marketing", paths: ["/marketing"], defaultOn: true },
  { key: "fornecedores", label: "Fornecedores", group: "Configurações", paths: ["/fornecedores"], defaultOn: true },
  { key: "integracoes", label: "Integrações (Frédy, Monde, ZapSign)", group: "Configurações", paths: ["/configuracoes/integracoes"], defaultOn: true },
  { key: "automacoes", label: "Automações", group: "Configurações", paths: ["/automacoes"], defaultOn: true },
];

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/** Módulos ligados, a partir do que a plataforma gravou para a agência ({ chave: true/false }). */
export function enabledModules(json: string | null | undefined): Set<string> {
  let overrides: Record<string, unknown> = {};
  try {
    overrides = JSON.parse(json || "{}") ?? {};
  } catch {
    overrides = {};
  }
  return new Set(MODULES.filter((m) => (typeof overrides[m.key] === "boolean" ? overrides[m.key] : m.defaultOn)).map((m) => m.key));
}

/** Módulo dono de um caminho do painel (o prefixo mais longo vence), ou null se o caminho é sempre liberado. */
export function moduleForPath(pathname: string): ModuleDef | null {
  let best: ModuleDef | null = null;
  let len = 0;
  for (const m of MODULES)
    for (const p of m.paths)
      if ((pathname === p || pathname.startsWith(p + "/")) && p.length > len) {
        best = m;
        len = p.length;
      }
  return best;
}

export const isModuleKey = (k: string) => BY_KEY.has(k);
export const moduleLabel = (k: string) => BY_KEY.get(k)?.label ?? k;
