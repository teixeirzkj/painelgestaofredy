// Domínios (enums) e rótulos em português.

function labels<T extends string>(map: Record<T, string>) {
  return { values: Object.keys(map) as [T, ...T[]], label: (v: string | null | undefined) => (v ? (map as Record<string, string>)[v] ?? v : "—"), map };
}

export const ROLES = labels({
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  VENDEDOR: "Vendedor",
  FINANCEIRO: "Financeiro",
});
export type Role = (typeof ROLES.values)[number];

export const PRODUCT_TYPES = labels({
  AEREO: "Passagem aérea",
  HOTEL: "Hotel",
  PACOTE: "Pacote turístico",
  CRUZEIRO: "Cruzeiro",
  SEGURO: "Seguro viagem",
  PASSEIO: "Passeios",
  TRANSFER: "Transfer",
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
  ALUGUEL: "Aluguel",
  MARKETING: "Marketing",
  SISTEMAS: "Sistemas",
  IMPOSTOS: "Impostos",
  ADMINISTRATIVAS: "Despesas administrativas",
  OUTROS: "Outros",
});

export const RECEIVABLE_CATEGORIES = labels({
  VENDAS: "Vendas",
  COMISSAO_FORNECEDOR: "Comissões de fornecedores",
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
  OUTROS: "Outros",
});

export const ACCOUNT_TYPES = labels({
  BANCO: "Conta bancária",
  CAIXA: "Caixa físico",
  RECEBIVEIS: "Conta de recebíveis",
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
