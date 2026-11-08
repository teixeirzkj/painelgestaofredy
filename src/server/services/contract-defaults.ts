/**
 * Modelos de contrato sugeridos para uma agência nova. São rascunhos: o texto deixa claro
 * que precisa passar pela revisão jurídica da agência antes do uso.
 */
export const SUGGESTED_TEMPLATE_BODY = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE INTERMEDIAÇÃO TURÍSTICA
[MODELO SUGERIDO: submeta à revisão jurídica da agência antes do uso e apague esta linha]

CONTRATADA: {{agencia.nome}}, CNPJ {{agencia.documento}}.
CONTRATANTE: {{cliente.nome}}, {{cliente.identificacao}}, residente em {{cliente.endereco}}, telefone {{cliente.telefone}}, e-mail {{cliente.email}}.

1. OBJETO
A CONTRATADA intermedeia, em nome do CONTRATANTE, a aquisição dos serviços turísticos abaixo, referentes à venda {{venda.codigo}} de {{venda.data}}:
{{venda.produtos}}

Destino: {{venda.destino}} · Período: {{venda.inicio}} a {{venda.retorno}} · Passageiros: {{venda.passageiros}} · Localizador: {{venda.localizador}}
{{venda.lista_passageiros}}

2. PREÇO E PAGAMENTO
Valor total: {{venda.valor_total}}, pago da seguinte forma:
{{venda.pagamento}}

3. CONDIÇÕES ESPECÍFICAS
{{clausulas}}

4. DISPOSIÇÕES GERAIS
4.1. Os serviços são prestados pelos fornecedores indicados, cabendo à CONTRATADA a intermediação e o suporte ao CONTRATANTE.
4.2. Documentação de viagem (documento de identidade, passaporte, vistos e vacinas) é de responsabilidade do CONTRATANTE.
4.3. Fica eleito o foro do domicílio do CONTRATANTE.

{{venda.data}}.

_______________________________          _______________________________
{{agencia.nome}}                          {{cliente.nome}}
Consultor(a): {{vendedor.nome}}`;

export const SUGGESTED_TEMPLATES = [
  { name: "Pacote turístico", productType: "PACOTE", clauses: "3.1. Cancelamentos estão sujeitos às regras da operadora, com multas que podem variar conforme a antecedência.\n3.2. Alterações de datas dependem de disponibilidade e podem gerar diferença tarifária.\n3.3. Reembolsos seguem os prazos e condições do fornecedor." },
  { name: "Passagem aérea", productType: "AEREO", clauses: "3.1. Tarifas aéreas seguem as regras da companhia (franquia de bagagem, remarcação e reembolso).\n3.2. Alterações de nome não são permitidas na maioria das tarifas.\n3.3. Não comparecimento (no-show) pode implicar perda integral do valor." },
  { name: "Hospedagem", productType: "HOTEL", clauses: "3.1. Cancelamento conforme política do hotel informada no momento da reserva.\n3.2. Horários de check-in e check-out definidos pelo meio de hospedagem." },
  { name: "Cruzeiro", productType: "CRUZEIRO", clauses: "3.1. O pagamento é realizado diretamente à companhia marítima, conforme suas condições.\n3.2. Cancelamentos seguem a tabela de penalidades da companhia marítima." },
  { name: "Outros serviços", productType: "OUTROS", clauses: "3.1. Cancelamentos e alterações seguem as condições do fornecedor do serviço." },
];
