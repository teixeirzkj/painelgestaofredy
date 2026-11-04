# Frédy Gestão × Monde — matriz de funcionalidades

Referência funcional: páginas públicas do Monde (`monde.com.br/recursos`, `/operacao-propria`, `/viagens-corporativas`) e a central de ajuda (`ajuda.monde.com.br`), lidas em 04/11/2026. O Monde foi usado só como referência de **regras de negócio**. Não copiamos interface, código, textos nem identidade visual. Quando um item cita uma regra do Monde, ela veio de um artigo lido. O que não foi confirmado nas páginas está marcado como **não confirmado**.

**Legenda:**

| Situação | Significado |
|---|---|
| ✅ Implementado | Funciona de ponta a ponta, com regra no servidor e teste automatizado (quando há cálculo). |
| 🟡 Parcial | Existe e opera, com limitações descritas. |
| ⏳ Pendente | Ainda não existe. |
| 🔌 Depende de integração externa | Precisa de API, credenciais ou homologação de terceiros. |

## 1. Vendas

| Recurso (referência Monde) | Frédy Gestão | Observações |
|---|---|---|
| Venda com vários produtos, cada um com fornecedor | ✅ | 10 tipos de produto, incluindo aéreo, hospedagem, pacote, cruzeiro, seguro, transfer, passeio, locação, excursão e outros. |
| Operadora/consolidadora diferente do fornecedor | ✅ | Campo "operadora" no produto. A conta a pagar, o over e a fatura vão para quem fatura. |
| Taxas RAV e DU | ✅ | São cobradas do cliente e contam como receita da agência. |
| Taxa CC RAV/DU (taxa de cartão retida pelo fornecedor) | ✅ | Regra do Monde: só no modelo "cliente paga ao fornecedor" e nunca maior que RAV+DU. A validação é feita no servidor. |
| Over / incentivo | ✅ | É receita da agência e gera conta a receber do fornecedor. |
| Comissão do fornecedor | ✅ | No modelo comissão, o repasse do fornecedor = comissão + over + RAV/DU − taxa CC. |
| Comissão e over fixos por fornecedor/produto, preenchidos na venda | ✅ | Regras de comissão em Configurações e na ficha do fornecedor. A mais específica vence e o valor é ajustável em cada venda. |
| Comissão do vendedor (valor ou %) | ✅ | O percentual incide sobre o lucro antes da comissão do vendedor. |
| Intermediário (freelancer/parceiro) com comissão | ✅ | Gera uma conta a pagar ao parceiro, deduzida do lucro. |
| Over do intermediário | ⏳ | Só existe a comissão do intermediário. |
| Pagante diferente do cliente / múltiplos pagantes | ✅ | Pagante por parcela. A conta a receber fica no nome do pagante. |
| Passageiros separados do cliente e do pagante | ✅ | O passageiro pode ser vinculado a um cadastro e aparece no histórico da pessoa. |
| Cancelamento da venda preservando o que foi pago | ✅ | Já existia. |
| Cancelamento por produto ou por passageiro | 🟡 | A edição da venda remove ou altera produtos e sincroniza o financeiro. Não há "cancelamento parcial" com data própria. |
| Reembolso ao cliente / do fornecedor | ✅ | É repasse: entra no caixa, mas não no DRE. A operação é idempotente. |
| Multa do fornecedor / multa retida do cliente | ✅ | A multa do fornecedor é despesa; a retida do cliente é receita. |
| Remarcação com histórico | 🟡 | A edição da venda registra auditoria com antes/depois. Não existe um tipo "remarcação" dedicado. |
| Produtos especiais (milhas, câmbio, permuta, bloqueio aéreo, moeda estrangeira) | ⏳ | — |
| Importação de vendas de portais de fornecedores | 🔌 | Depende de API de cada fornecedor. |

## 2. Viagens (agrupamento de vendas)

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Viagem reunindo várias vendas do mesmo cliente | ✅ | Pode criar, vincular e desvincular vendas, ou lançar uma venda já dentro da viagem. |
| Situação derivada das datas (A iniciar / Em viagem / Finalizada) | ✅ | As datas vêm das vendas vinculadas. |
| Passageiros, reservas, localizadores, fornecedores e valores da viagem | ✅ | Os passageiros aparecem sem repetição. |
| Documentos e vouchers da viagem e das vendas (com origem) | ✅ | Upload validado pelo conteúdo do arquivo (assinatura binária). |
| Tornar obrigatório vincular toda venda a uma viagem | ⏳ | O Monde permite; aqui o vínculo é opcional. |

## 3. Financeiro

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Contas a receber e a pagar, parcelamento, baixa parcial ou total, estorno | ✅ | Já existia. As baixas nunca são apagadas. |
| Despesas recorrentes | ✅ | Já existia. |
| Fluxo de caixa previsto × realizado | ✅ | Já existia. |
| Transferências entre contas | ✅ | Já existia. |
| Conciliação bancária | 🟡 | Importação CSV com detecção de duplicidade. OFX e conciliação automática: ⏳. Integração bancária: 🔌. |
| Centros de custo | ✅ | Cadastro próprio, campo nos lançamentos, filtro e relatório. |
| Rateio entre empresas/centros de custo | ⏳ | — |
| DRE gerencial (competência) | ✅ | Receitas da agência separadas por natureza: intermediação, revenda, comissões, over, RAV/DU e taxas. Também mostra deduções, CPV, comissões, despesas por categoria, multas e resultado. Os repasses não entram. |
| Data de competência separada do vencimento nas despesas | ⏳ | O DRE usa o vencimento das despesas avulsas (está documentado na tela). |
| Faturas de operadoras/consolidadoras | ✅ | Ver seção 4. |
| Fatura do cliente (corporativo) e regras de faturamento por período | ⏳ | — |
| Boletos e Pix com baixa automática, NFS-e | 🔌 | Exigem banco ou emissor homologado. |
| Taxa de cartão da agência (maquininha) | ⏳ | — |

## 4. Faturas de fornecedores

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Receber fatura (número, emissão, vencimento, valor) | ✅ | Número único por fornecedor. |
| Agrupar lançamentos (custos das vendas, despesas manuais) | ✅ | A fatura **consolida** contas a pagar já existentes e não cria uma despesa paralela, por isso não há duplicidade. |
| Conferir valores e destacar divergência | ✅ | Não deixa marcar como conferida com diferença. |
| Registrar diferença (ex.: taxa administrativa) | ✅ | A diferença a maior vira um ajuste dentro da fatura. A diferença a menor orienta revisar o custo da venda. |
| Quitar a fatura em uma operação | ✅ | Baixa todos os itens na mesma transação. Bloqueia baixa individual de item de fatura. O estorno reabre a fatura. |
| Anexar documentos (PDF da fatura, comprovante) | ✅ | — |
| Vencimento dos itens passa a ser o da fatura | ✅ | Editar a venda depois não sobrescreve esse vencimento. |
| Pagamento parcial da fatura | ⏳ | Hoje o pagamento é integral. |
| Regras automáticas (decendial, IATA, quinzenal…) e conferência por arquivo | ⏳ / 🔌 | A conferência automática depende do formato de arquivo de cada consolidadora (não confirmado). |

## 5. Comissões

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Comissão da agência (fornecedor), vendedor, intermediário, over, RAV, DU, taxa de serviço | ✅ | Um registro por tipo, sem dupla contagem: o lucro é calculado pela venda, e os lançamentos gerados por ela não são somados de novo no DRE. |
| Regras por fornecedor e produto | ✅ | — |
| Plano de comissão com metas e fechamento mensal | ⏳ | — |
| Relatórios de comissões (vendedor e intermediário) | ✅ | — |

## 6. Clientes, passageiros e documentos

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Pessoa física e jurídica | ✅ | CPF ou CNPJ validado conforme o tipo. Razão social e nome fantasia. |
| Documentos de viagem (RG, passaporte e validade, necessidades especiais) | ✅ | Mascarados na exibição. Alerta de passaporte vencendo antes da viagem. |
| Histórico de compras, de viagens e como passageiro; pendências financeiras; contratos | ✅ | — |
| Unificação de cadastros, importação por planilha, campos personalizados | ⏳ | — |

## 7. Contratos

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Modelos por produto, preenchimento automático, cláusulas, versões, PDF, vínculo com a venda | ✅ | Já existia. O PDF é gerado pela impressão do navegador. |
| Assinatura eletrônica | 🔌 | Estados e webhook prontos. Não simulamos assinatura: o contrato só vira "assinado" com confirmação real do provedor. |

## 8. Excursões e grupos (operação própria)

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Cadastro da excursão (datas, destino, vagas, preço) | ✅ | — |
| Reservas como vendas vinculadas, com controle de vagas | ✅ | Bloqueia reservas acima da capacidade. |
| Custos da operação (vários fornecedores) | ✅ | Viram contas a pagar da categoria "Custos de excursões". |
| Resultado, resultado por passageiro, previsto × realizado | ✅ | — |
| Lista de passageiros e rooming list (quarto e poltrona) | ✅ | Exportação CSV registrada na auditoria (LGPD); documento completo só para quem gerencia a operação. |
| Vouchers personalizados e mapa de ônibus | ⏳ | — |

## 9. Relatórios

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Vendas por período, vendedor, produto, destino | ✅ | Com comparação entre períodos. |
| Faturamento, receita da agência, rentabilidade | ✅ | — |
| Comissões, fluxo de caixa, DRE, contas vencidas | ✅ | — |
| Resultado por fornecedor, por viagem, por excursão, por centro de custo | ✅ | — |
| Reembolsos e multas | ✅ | — |
| Exportação | ✅ | CSV compatível com Excel pt-BR. XLSX/PDF: ⏳. |
| Ranking de clientes, conversão de orçamentos, trechos aéreos | ⏳ | — |

## 10. Integrações e o diferencial Frédy

| Recurso | Frédy Gestão | Observações |
|---|---|---|
| Fluxo atendimento → orçamento → venda | ✅ (lado Frédy Gestão) | `POST /api/v1/orcamentos` é a API **própria** do sistema. Cria o rascunho, vincula o cliente pelo `fredyContactId`, CPF/CNPJ ou e-mail, e a mesma `externalRef` nunca gera dois orçamentos. |
| Eventos para automações (venda, pagamento, contrato, pré-viagem, pós-venda) | ✅ | `GET /api/v1/eventos` (pull) ou webhook assinado com HMAC. |
| Jornada da venda visível (orçamento → venda → financeiro → contrato → pré-viagem → pós-venda) | ✅ | Linha do tempo no detalhe da venda, com as etapas que ainda pedem informação. |
| Adaptador nativo para o CRM Frédy | 🔌 | Interface pronta (`FredyCrmAdapter`) e **desativada**: endpoint, autenticação e contrato dependem da equipe Frédy. Nada é presumido. |
| Integrações com fornecedores (Wooba, Infotravel etc.) | 🔌 | — |
| Envio de mensagens (WhatsApp) | 🔌 | Os eventos indicam `messagingAllowed` conforme o consentimento; o disparo depende do canal autorizado no Frédy. |

## Próximas prioridades sugeridas

1. Pagamento parcial de fatura e regras automáticas de vencimento (decendial, quinzenal, IATA).
2. Fatura do cliente corporativo e centros de custo do passageiro.
3. Data de competência nas despesas e rateio.
4. Plano de comissão com metas e fechamento mensal.
5. Conciliação por OFX.
6. Ativar o adaptador do CRM Frédy assim que endpoint e autenticação forem definidos.
