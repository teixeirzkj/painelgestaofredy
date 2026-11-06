// Domínios (enums) e rótulos em português.

function labels<T extends string>(map: Record<T, string>) {
  return { values: Object.keys(map) as [T, ...T[]], label: (v: string | null | undefined) => (v ? (map as Record<string, string>)[v] ?? v : "—"), map };
}

export const ROLES = labels({
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  VENDEDOR: "Vendedor",
  FINANCEIRO: "Financeiro",
  ATENDENTE: "Atendente (só venda rápida)",
});
export type Role = (typeof ROLES.values)[number];

export const PRODUCT_TYPES = labels({
  AEREO: "Passagem aérea",
  HOTEL: "Hospedagem",
  PACOTE: "Pacote turístico",
  CRUZEIRO: "Cruzeiro",
  SEGURO: "Seguro viagem",
  TRANSFER: "Transfer",
  PASSEIO: "Passeios",
  LOCACAO: "Locação de veículo",
  EXCURSAO: "Excursão",
  OUTROS: "Outros serviços",
});
export type ProductType = (typeof PRODUCT_TYPES.values)[number];

export const COMMERCIAL_MODELS = labels({
  INTERMEDIACAO: "Intermediação",
  REVENDA: "Revenda",
  COMISSAO: "Comissão (cliente paga ao fornecedor)",
});
export type CommercialModel = (typeof COMMERCIAL_MODELS.values)[number];

export const COMMERCIAL_MODEL_HELP: Record<CommercialModel, string> = {
  INTERMEDIACAO:
    "O cliente paga à agência, que repassa o custo ao fornecedor. Receita da agência = valor vendido − custo.",
  REVENDA:
    "A agência compra o produto e revende. Receita bruta = valor vendido; o custo é custo do produto vendido.",
  COMISSAO:
    "O cliente paga diretamente ao fornecedor. A agência recebe apenas a comissão paga pelo fornecedor.",
};

export const SALE_STATUS = labels({
  ORCAMENTO: "Rascunho",
  CONFIRMADA: "Confirmada",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
});
export type SaleStatus = (typeof SALE_STATUS.values)[number];

export const PAYMENT_METHODS = labels({
  PIX: "PIX",
  CARTAO_CREDITO: "Cartão de crédito",
  CARTAO_DEBITO: "Cartão de débito",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  DINHEIRO: "Dinheiro",
  OUTRO: "Outro",
});
export type PaymentMethod = (typeof PAYMENT_METHODS.values)[number];

export const ENTRY_STATUS = labels({
  PENDENTE: "Pendente",
  PARCIAL: "Parcial",
  PAGO: "Pago",
  VENCIDO: "Vencido",
  CANCELADO: "Cancelado",
});
export type EntryStatus = (typeof ENTRY_STATUS.values)[number];

export const PAYABLE_CATEGORIES = labels({
  FORNECEDORES: "Fornecedores turísticos",
  SALARIOS: "Salários",
  COMISSOES: "Comissões",
  OPERACAO_PROPRIA: "Custos de excursões",
  REEMBOLSO_CLIENTE: "Reembolsos a clientes",
  MULTA_FORNECEDOR: "Multas de fornecedores",
  TAXA_CARTAO: "Taxas de cartão (maquininha)",
  ALUGUEL: "Aluguel",
  MARKETING: "Marketing",
  SISTEMAS: "Sistemas",
  IMPOSTOS: "Impostos",
  ADMINISTRATIVAS: "Despesas administrativas",
  FATURA_CARTAO: "Fatura do cartão da agência",
  OUTROS: "Outros",
});

export const RECEIVABLE_CATEGORIES = labels({
  VENDAS: "Vendas",
  COMISSAO_FORNECEDOR: "Comissões de fornecedores",
  OVER: "Incentivos (over)",
  REEMBOLSO_FORNECEDOR: "Reembolsos de fornecedores",
  MULTA_CLIENTE: "Multas cobradas de clientes",
  OUTRAS_RECEITAS: "Outras receitas",
});

export const SUPPLIER_CATEGORIES = labels({
  OPERADORA: "Operadora",
  CIA_AEREA: "Companhia aérea",
  HOTEL: "Hotel",
  CONSOLIDADORA: "Consolidadora",
  SEGURADORA: "Seguradora",
  RECEPTIVO: "Receptivo",
  TRANSPORTADORA: "Transportadora",
  INTERMEDIARIO: "Intermediário / parceiro",
  OUTROS: "Outros",
});

export const ACCOUNT_TYPES = labels({
  BANCO: "Conta bancária",
  CAIXA: "Caixa físico",
  RECEBIVEIS: "Conta de recebíveis",
  CARTAO_CREDITO: "Cartão de crédito da agência",
  OUTRA: "Outra",
});

export const CONTRACT_STATUS = labels({
  NAO_GERADO: "Não gerado",
  EM_PREPARACAO: "Em preparação",
  AGUARDANDO_ENVIO: "Aguardando envio",
  ENVIADO: "Enviado",
  ASSINADO: "Assinado",
  CANCELADO: "Cancelado",
});

export const RESERVATION_STATUS = labels({
  PENDENTE: "Pendente",
  CONFIRMADA: "Confirmada",
  CANCELADA: "Cancelada",
});

export const FINANCIAL_STATUS = labels({
  SEM_COBRANCA: "Sem cobrança",
  PENDENTE: "A receber",
  PARCIAL: "Parcial",
  QUITADO: "Quitado",
  ATRASADO: "Em atraso",
  CANCELADO: "Cancelado",
});

export const EVENT_STATUS = labels({
  PENDENTE: "Pendente",
  ENTREGUE: "Entregue",
  SEM_DESTINO: "Sem destino configurado",
  FALHOU: "Falhou",
  IGNORADO: "Ignorado",
});

/** Categorias de repasse: movimentam caixa, mas não entram no resultado (DRE). */
export const PASS_THROUGH_CATEGORIES = new Set(["REEMBOLSO_CLIENTE", "REEMBOLSO_FORNECEDOR", "FATURA_CARTAO"]);

export const PERSON_TYPES = labels({ PF: "Pessoa física", PJ: "Pessoa jurídica" });

export const TRIP_STATUS = labels({
  SEM_DATAS: "Sem datas",
  A_INICIAR: "A iniciar",
  EM_VIAGEM: "Em viagem",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
});

export const EXCURSION_STATUS = labels({
  PLANEJADA: "Planejada",
  VENDAS_ABERTAS: "Vendas abertas",
  ENCERRADA: "Vendas encerradas",
  REALIZADA: "Realizada",
  CANCELADA: "Cancelada",
});

export const INVOICE_STATUS = labels({
  ABERTA: "Em conferência",
  CONFERIDA: "Conferida",
  PAGA: "Paga",
  CANCELADA: "Cancelada",
});

export const CLIENT_DOC_KINDS = labels({
  RG: "RG",
  CPF_DOC: "CPF",
  CNH: "CNH",
  PASSAPORTE: "Passaporte",
  VISTO: "Visto",
  CERTIDAO: "Certidão de nascimento",
  COMPROVANTE_RESIDENCIA: "Comprovante de residência",
  OUTRO_DOC: "Outro documento",
});

export const ATTACHMENT_KINDS = labels({
  VOUCHER: "Voucher",
  DOCUMENTO: "Documento de viagem",
  COMPROVANTE: "Comprovante",
  FATURA: "Fatura",
  OUTRO: "Outro",
  ...Object.fromEntries(CLIENT_DOC_KINDS.values.map((v) => [v, CLIENT_DOC_KINDS.label(v)])),
} as Record<string, string>);

export const REFUND_KINDS = labels({
  REEMBOLSO_CLIENTE: "Reembolso ao cliente",
  REEMBOLSO_FORNECEDOR: "Reembolso do fornecedor",
  MULTA_FORNECEDOR: "Multa paga ao fornecedor",
  MULTA_CLIENTE: "Multa cobrada do cliente",
});

export const TASK_STATUS = labels({ PENDENTE: "Pendente", EM_ANDAMENTO: "Em andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" });
export const TASK_PRIORITY = labels({ URGENTE: "Urgente", ALTA: "Alta", MEDIA: "Média", BAIXA: "Baixa" });
export const TASK_TYPES = labels({
  FOLLOW_UP: "Follow-up com cliente",
  DOCUMENTOS: "Documentos de viagem",
  PAGAMENTO: "Cobrança / pagamento",
  POS_VENDA: "Pós-venda",
  INTERNA: "Tarefa interna",
  OUTRO: "Outro",
});
export const CREDIT_STATUS = labels({ ABERTO: "Em aberto", CONSUMIDO: "Consumido", CANCELADO: "Cancelado" });
export const EDIT_REQUEST_STATUS = labels({ PENDENTE: "Pendente", APROVADA: "Aprovada", REJEITADA: "Rejeitada", UTILIZADA: "Utilizada" });
export const BILLING_CYCLES = labels({ AVULSO: "Avulso (por venda)", DECENDIAL: "Decendial (fatura a cada 10 dias)", QUINZENAL: "Quinzenal", MENSAL: "Mensal" });
export const CARD_MODALITIES = labels({ CREDITO: "Crédito", DEBITO: "Débito" });
export const TRANSFER_DIRECTIONS = labels({ A_REPASSAR: "A repassar (pagar)", A_RECEBER: "A receber" });
export const GOAL_METRICS = labels({ FATURAMENTO: "Faturamento", RECEITA: "Receita da agência" });

/** Catálogo padrão de categorias de despesa, por grupo (editável em Configurações). system = usada pelas regras automáticas. */
export const DEFAULT_EXPENSE_CATEGORIES: { group: string; items: { code: string; name: string; system?: boolean; inDre?: boolean }[] }[] = [
  { group: "Ocupação", items: [{ code: "ALUGUEL", name: "Aluguel" }, { code: "CONDOMINIO", name: "Condomínio" }, { code: "IPTU", name: "IPTU" }, { code: "ENERGIA", name: "Energia elétrica" }, { code: "AGUA", name: "Água" }, { code: "INTERNET", name: "Internet e telefone" }] },
  {
    group: "Pessoal",
    items: [
      { code: "SALARIOS", name: "Salários" },
      { code: "COMISSOES", name: "Comissões de vendedores e parceiros", system: true },
      { code: "VALE_REFEICAO", name: "Vale alimentação / refeição" },
      { code: "VALE_TRANSPORTE", name: "Vale transporte" },
      { code: "PLANO_SAUDE", name: "Plano de saúde" },
      { code: "ENCARGOS", name: "FGTS / INSS / encargos" },
      { code: "FERIAS_13", name: "Férias / 13º salário" },
      { code: "RESCISOES", name: "Rescisões" },
    ],
  },
  { group: "Marketing", items: [{ code: "MARKETING", name: "Marketing digital" }, { code: "TRAFEGO_PAGO", name: "Tráfego pago" }, { code: "AGENCIA_MARKETING", name: "Agência de marketing" }, { code: "DISPARO_WHATSAPP", name: "Disparo de WhatsApp" }, { code: "BRINDES", name: "Brindes e presentes" }, { code: "MATERIAL_GRAFICO", name: "Material gráfico" }, { code: "EVENTOS", name: "Eventos e feiras" }] },
  {
    group: "Operacional",
    items: [
      { code: "ADMINISTRATIVAS", name: "Despesas administrativas" },
      { code: "SISTEMAS", name: "Sistemas e software" },
      { code: "CONTABILIDADE", name: "Contabilidade" },
      { code: "MATERIAL_ESCRITORIO", name: "Material de escritório" },
      { code: "MANUTENCAO", name: "Manutenção e reparos" },
      { code: "SEGURO_EMPRESARIAL", name: "Seguro empresarial" },
      { code: "TARIFAS_BANCARIAS", name: "Despesas bancárias / tarifas" },
      { code: "CORREIOS", name: "Frete e correios" },
    ],
  },
  { group: "Impostos e tributos", items: [{ code: "IMPOSTOS", name: "Impostos e tributos" }, { code: "DAS", name: "DAS / Simples Nacional" }, { code: "ISS", name: "ISS" }, { code: "OUTROS_IMPOSTOS", name: "Outros impostos" }] },
  {
    group: "Custos da operação",
    items: [
      { code: "FORNECEDORES", name: "Fornecedores turísticos", system: true },
      { code: "OPERACAO_PROPRIA", name: "Custos de excursões", system: true },
      { code: "MULTA_FORNECEDOR", name: "Multas de fornecedores", system: true },
    ],
  },
  {
    group: "Custos extras",
    items: [
      { code: "TREINAMENTO", name: "Treinamentos" },
      { code: "VIAGENS_CORPORATIVAS", name: "Viagens corporativas" },
      { code: "MULTAS_JUROS", name: "Multas e juros" },
      { code: "JURIDICO", name: "Despesas jurídicas" },
      { code: "PREJUIZO_OPERACIONAL", name: "Prejuízo operacional / erros" },
      { code: "REEMBOLSO_CLIENTE", name: "Reembolsos a clientes", system: true, inDre: false },
    ],
  },
  { group: "Deduções", items: [{ code: "TAXA_CARTAO", name: "Taxas de cartão (maquininha)", system: true }, { code: "DEVOLUCOES", name: "Devoluções e estornos" }] },
  { group: "Outros", items: [{ code: "OUTROS", name: "Outras despesas" }, { code: "FATURA_CARTAO", name: "Fatura do cartão da agência", system: true, inDre: false }] },
];

/** Feriados nacionais (fixos e móveis) — usados nos calendários. */
export function nationalHolidays(year: number): Record<string, string> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fixed: Record<string, string> = {
    [`${year}-01-01`]: "Confraternização Universal",
    [`${year}-04-21`]: "Tiradentes",
    [`${year}-05-01`]: "Dia do Trabalho",
    [`${year}-09-07`]: "Independência",
    [`${year}-10-12`]: "Nossa Senhora Aparecida",
    [`${year}-11-02`]: "Finados",
    [`${year}-11-15`]: "Proclamação da República",
    [`${year}-11-20`]: "Consciência Negra",
    [`${year}-12-25`]: "Natal",
  };
  // Páscoa (algoritmo de Meeus/Butcher)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(year, month - 1, day);
  const rel = (days: number) => { const dt = new Date(easter + days * 86400000); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; };
  return { ...fixed, [rel(-47)]: "Carnaval", [rel(-2)]: "Sexta-feira Santa", [rel(60)]: "Corpus Christi" };
}

/** Texto legível para as ações registradas na auditoria ("venda.alterada" → "Venda alterada"). */
const AUDIT_ENTITIES: Record<string, string> = {
  venda: "Venda", receber: "Conta a receber", pagar: "Conta a pagar", baixa: "Baixa", cliente: "Cliente", fornecedor: "Fornecedor",
  contrato: "Contrato", modelo: "Modelo de contrato", usuario: "Usuário", agencia: "Agência", conta: "Conta", fatura: "Fatura de fornecedor",
  viagem: "Viagem", excursao: "Excursão", credito: "Crédito", meta: "Meta", tarefa: "Tarefa", repasse: "Repasse", categoria: "Categoria",
  taxa_cartao: "Taxa de cartão", centro_custo: "Centro de custo", regra_comissao: "Regra de comissão", anexo: "Anexo", api: "API",
  orcamento: "Orçamento", transferencia: "Transferência", automacao: "Automação", permissao: "Permissão", conciliacao: "Conciliação",
};
export function auditActionLabel(action: string): string {
  const [entity, ...rest] = action.split(".");
  const what = rest.join(" ").replace(/_/g, " ");
  return `${AUDIT_ENTITIES[entity] ?? entity.replace(/_/g, " ")}${what ? ` · ${what}` : ""}`;
}
