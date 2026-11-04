# Frédy Gestão

Módulo de gestão comercial e financeira para agências de turismo. O vendedor lança a venda uma única vez e o sistema prepara automaticamente parcelas a receber, contas a pagar aos fornecedores, comissão do vendedor, reservas, prévia de contrato e eventos para integrações.

> Primeira agência: Azul Viagens Guarapuava. A arquitetura é multiempresa (multi-tenant) desde o início.

Módulos: dashboard, vendas, **viagens**, **excursões e grupos**, clientes (PF/PJ), financeiro (receber, pagar, **faturas de fornecedores**, fluxo de caixa, contas, conciliação), fornecedores com **regras de comissão/over**, contratos, relatórios (incluindo **DRE gerencial**), automações e configurações. A comparação com o Monde está em [MONDE_GAP_ANALYSIS.md](MONDE_GAP_ANALYSIS.md).

## Como executar

Requisitos: Node.js 20+ (testado com Node 24).

```bash
npm install          # instala dependências (aprove os scripts do Prisma/esbuild se o npm pedir: npm approve-scripts)
npm run db:push      # cria o banco de desenvolvimento (SQLite em prisma/dev.db)
npm run db:seed      # dados de DEMONSTRAÇÃO (fictícios)
npm run dev          # http://localhost:3000
```

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | testes das regras financeiras, integração venda→financeiro, permissões e isolamento entre empresas (banco descartável `prisma/test.db`) |
| `npm run build && npm start` | build e execução de produção |
| `npm run lint` | checagem de tipos (TypeScript estrito) |
| `npm run db:reset` | **apaga** o banco de desenvolvimento e recria com a demonstração |

### Usuários de demonstração (senha `demo1234`)

| E-mail | Perfil |
|---|---|
| admin@azulviagens.demo | Administrador |
| gestora@azulviagens.demo | Gestor |
| ana@azulviagens.demo / carlos@azulviagens.demo | Vendedor |
| financeiro@azulviagens.demo | Financeiro |
| admin@agenciab.demo | Administrador de outra agência (para verificar isolamento) |

Todos os dados da demonstração são fictícios e as empresas estão marcadas como demonstração (selo "Demonstração" no topo). Além das vendas, a demonstração inclui: a viagem **Férias em Lisboa** (aéreo com RAV/DU e taxa CC, hotel via operadora com over, intermediário e parcelas pagas por uma empresa), a excursão **Beto Carrero World** com rooming list e custos, uma **fatura de operadora com divergência de R$ 35** para conferir, e um reembolso com multa em venda cancelada. A venda com localizador **EXEMPLO8000** (cliente "Mariana Exemplo da Silva"; busque por EXEMPLO8000) é o cenário obrigatório do briefing: pacote de R$ 8.000, custo R$ 6.500, comissão R$ 200, 4 × R$ 2.000.

## Stack e decisões

| Decisão | Motivo |
|---|---|
| Next.js 16 (App Router, Server Actions) + TypeScript + Tailwind 4 | O diretório estava vazio; segue a stack preferencial do briefing. |
| Prisma 6 | Estável, sem a exigência de driver adapters do Prisma 7. |
| SQLite no desenvolvimento, PostgreSQL em produção | Não há PostgreSQL/Docker na máquina de desenvolvimento. O schema foi escrito para ser portável (sem enums nativos, sem tipos específicos). |
| Valores em **centavos inteiros** (`...Cents`) | Nunca usar ponto flutuante em dinheiro. |
| Datas de calendário como texto `YYYY-MM-DD` | Vencimentos e datas de viagem não sofrem deslocamento de fuso; o "hoje" é calculado no fuso configurado da agência. |
| Componentes de UI próprios (estilo shadcn/ui) + Lucide + Recharts | Sem dependência de CLI externa; visual consistente com a identidade azul do Frédy. |
| Autenticação própria (JWT HS256 em cookie httpOnly + bcrypt) | O projeto não tinha auth; o usuário é recarregado do banco a cada requisição (desativação tem efeito imediato). Substituível por SSO do Frédy. |

### Estrutura

```
prisma/schema.prisma        modelo de dados (20 entidades, todas com companyId)
prisma/seed.ts              demonstração, criada pelos próprios serviços
src/lib/finance.ts          regras financeiras puras (cálculo da venda, status, baixas)
src/lib/permissions.ts      matriz de perfis e permissões configuráveis
src/server/services/*       regras de negócio (vendas, financeiro, cadastros, contratos, automações, relatórios)
src/server/context.ts       contexto (empresa + usuário + permissões) exigido por todo serviço
src/app/actions.ts          server actions (camada fina: autentica → serviço → mensagem)
src/app/(app)/*             páginas
src/app/api/*               anexos, CSV, cron, webhook de assinatura, API de eventos
tests/*                     testes (Vitest)
```

## Regras financeiras

Cada produto da venda tem um **modelo comercial**:

| Modelo | Quem recebe do cliente | Conta a pagar | Receita própria da agência |
|---|---|---|---|
| Intermediação | agência | custo ao fornecedor (ou à operadora) | valor − custo + RAV + DU + over |
| Revenda | agência | custo ao fornecedor | valor cheio + RAV + DU + over (custo = CPV) |
| Comissão | fornecedor (direto) | nenhuma | comissão + over + RAV + DU − taxa CC (conta a receber do fornecedor) |

- **RAV/DU**: cobradas do cliente, receita da agência. **Taxa CC**: só no modelo comissão e nunca maior que RAV+DU.
- **Over**: incentivo do fornecedor; gera conta a receber. **Intermediário**: comissão vira conta a pagar ao parceiro e reduz o lucro.
- **Pagantes**: cada parcela pode ter um pagante diferente do cliente; cliente, pagante e passageiro são cadastros independentes.
- **Faturas de fornecedores** consolidam contas a pagar existentes (não criam despesa nova); a quitação baixa todos os itens numa transação e itens de fatura não podem ser baixados avulsos.
- **Reembolsos** (cliente/fornecedor) são repasses e ficam fora do DRE; **multas** entram no resultado.

- **Faturamento** = Σ valores + taxas − descontos (competência: data da venda).
- **Lucro bruto** = Σ(valor − custo) + comissões de fornecedor + taxas − descontos − comissão do vendedor.
- **Margem** = lucro bruto ÷ faturamento.
- **Caixa** = baixas efetivas (data do pagamento). Transferências entre contas não são receita nem despesa.
- A comissão do vendedor gera **um** registro de comissão e **uma** conta a pagar (categoria Comissões); o lucro é calculado pela venda, não pela soma das despesas, então não há dupla contagem.

Faturamento inclui RAV/DU cobradas do cliente. Exemplo obrigatório: faturamento R$ 8.000 · receita própria R$ 1.500 · lucro bruto R$ 1.300 · margem 16,25%.

### Integridade

- Todo lançamento gerado automaticamente tem chave `sourceKey` única por empresa → re-sincronizar uma venda nunca duplica.
- Alterar uma venda confirmada recalcula e **sincroniza** parcelas, contas a pagar e comissão: cria o que falta, atualiza o que mudou, cancela o que saiu. Nunca reduz abaixo do já baixado e nunca remove parcela com baixa (a operação é recusada e a transação revertida).
- Cancelar venda: pendentes são cancelados; parciais têm o saldo restante encerrado; valores pagos são mantidos (devoluções são lançadas no financeiro).
- Baixas não são apagadas: estornos marcam a baixa e reabrem o saldo, mantendo o histórico.
- Venda, financeiro, comissão, reservas, contrato e eventos são gravados na **mesma transação**.
- Toda alteração relevante gera registro de **auditoria**.

## Segurança e LGPD

- Isolamento por empresa em todas as consultas (os serviços recebem o contexto e filtram por `companyId`); testado.
- Autorização no servidor em todos os serviços; menus apenas refletem as permissões.
- Vendedor vê somente as próprias vendas e clientes, sem custos/margens globais (ajustável por agência).
- Gestor tem acesso financeiro configurável.
- Documentos sensíveis (passaporte, CPF de passageiros) são opcionais e exibidos mascarados; consentimento para comunicações automáticas registrado por cliente.
- Upload de comprovantes valida o tipo real do arquivo (assinatura binária) e tamanho; download exige sessão e mesma empresa.
- Login com limite de tentativas; cookie httpOnly/SameSite.

## Implantação em produção

1. PostgreSQL: em `prisma/schema.prisma` troque `provider = "sqlite"` por `"postgresql"` e defina `DATABASE_URL`. Rode `npx prisma migrate dev --name init` para gerar as migrações versionadas.
2. Variáveis: `AUTH_SECRET` (≥ 32 caracteres aleatórios), `CRON_SECRET`, `SIGNATURE_WEBHOOK_SECRET` (quando houver provedor).
3. Armazenamento de comprovantes: `src/server/storage.ts` grava em disco local; troque por bucket privado (S3/R2/GCS).
4. Agendamento: chame `POST /api/cron/automacoes` (cabeçalho `Authorization: Bearer $CRON_SECRET`) a cada hora.
5. Para muitas instâncias, mova o limite de tentativas de login para um armazenamento compartilhado (Redis).

## Pendências de integração (estrutura pronta, nada simulado)

| Item | Situação |
|---|---|
| Orçamentos externos | `POST /api/v1/orcamentos` (chave de API da agência): orçamento entra como rascunho, cliente vinculado por `fredyContactId`, CPF/CNPJ ou e-mail; `externalRef` idempotente. API própria — não depende de endpoints do Frédy. |
| CRM Frédy | Eventos estruturados e idempotentes já são gravados. Entrega por webhook genérico assinado (HMAC) ou consulta em `GET /api/v1/eventos` com chave de API. O adaptador nativo `FredyCrmAdapter` está **desativado** até a equipe Frédy definir endpoint, autenticação e contrato. Campo `fredyContactId` no cliente reservado para o vínculo. |
| Assinatura eletrônica | Estados completos e webhook `/api/webhooks/assinatura` com validação HMAC. **Nenhum provedor contratado**: o sistema nunca marca contrato como enviado/assinado sem confirmação externa. Botão "Enviar para assinatura" fica desabilitado. |
| Bancos | Conciliação manual com importação CSV e detecção de duplicidade. Integração automática depende de credenciais/homologação. |
| Envio de mensagens | Eventos indicam `messagingAllowed` conforme consentimento; o disparo depende de canal autorizado no Frédy. |
| Modelos de contrato | Os modelos da demonstração são rascunhos e **precisam de revisão jurídica**. PDF via "Imprimir / salvar PDF" do navegador. |

## Próxima etapa (planejada)

Integração nativa com o CRM Frédy, provedor de assinatura eletrônica, orçamento por IA, importação assistida do Monde, conciliação bancária automática, cotação direta com fornecedores e indicadores avançados.
