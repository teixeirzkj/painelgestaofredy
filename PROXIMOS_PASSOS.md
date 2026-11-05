# Frédy Gestão — passos para o sistema ficar completo

Cada fase depende da anterior, então a ordem importa.

Marcadores:

- [ ] a fazer
- [x] concluído
- **(você)** precisa de ação/decisão de vocês
- **(eu)** desenvolvimento

---

## Fase 0 — Código pronto para produção (concluída)

- [x] Banco **PostgreSQL** em produção. O build da Vercel converte o schema e aplica as migrações (`prisma/migrations`); o desenvolvimento local segue em SQLite.
- [x] Anexos, vouchers e logos gravados no banco na Vercel, porque o disco de lá não é persistente.
- [x] Automações diárias pelo **Vercel Cron** (`vercel.json`): todo dia às 07h de Brasília.
- [x] Primeiro acesso ao painel da plataforma pelas variáveis `PLATFORM_BOOTSTRAP_EMAIL` e `PLATFORM_BOOTSTRAP_PASSWORD`.
- [x] Região das funções: São Paulo (`gru1`).

## Fase 1 — Publicar na Vercel

1. [ ] **(você)** Liberar o GitHub. Em *teteateteproject/paineldegestao → Settings → Collaborators*, adicione `teixeirzkj` com escrita. **(eu)** faço o `git push` em seguida.
   - Sem GitHub também dá: `npx vercel login` e `npx vercel --prod` direto desta máquina.
2. [ ] **(você)** Criar a conta e o projeto na Vercel, que pode ser o plano Hobby para começar: *Add New → Project → Import* do repositório `paineldegestao`.
3. [ ] **(você)** Ainda no projeto, em *Storage → Create Database → Neon (Postgres)*:
   - Escolha a região **São Paulo (sa-east-1)**.
   - A integração cria sozinha `DATABASE_URL` e `DATABASE_URL_UNPOOLED`.
4. [ ] **(você)** Em *Settings → Environment Variables* (Production), criar:
   - `AUTH_SECRET`: 64 caracteres aleatórios. **(eu)** gero para você.
   - `CRON_SECRET`: 32 ou mais caracteres aleatórios.
   - `PLATFORM_BOOTSTRAP_EMAIL` e `PLATFORM_BOOTSTRAP_PASSWORD`: o seu acesso ao painel da plataforma.
5. [ ] **(você)** Fazer o deploy. O build roda as migrações e cria as tabelas.
6. [ ] **(você/eu)** Primeiro acesso:
   - Entre em `https://<projeto>.vercel.app/plataforma/login` com o e-mail e a senha do passo 4.
   - Crie a agência da cliente com o login do administrador dela.
   - Remova as variáveis `PLATFORM_BOOTSTRAP_*`.
7. [ ] **(você)** Domínio próprio (opcional), por exemplo `gestao.fredy.com.br`: *Settings → Domains*. Depois, apontar o DNS.
8. [ ] **(eu)** Testes no ar:
   - login e permissões;
   - venda completa com financeiro e contrato;
   - envio de comprovante e logo;
   - automação disparada pelo agendador.

> **Plano Hobby x Pro:** no Hobby o agendador roda 1 vez por dia, o que basta para lembretes, pré-viagem e pós-venda. No Pro dá para rodar de hora em hora, com mais tempo de execução e equipe no projeto. Para uso comercial com clientes, a Vercel exige o plano **Pro**.

## Fase 2 — Integração com o CRM Frédy (WTS)

Pré-requisito: a Fase 1 concluída, porque o Frédy precisa de um endereço público para avisar o sistema.

1. [ ] **(você)** Gerar o token da API em *Frédy → Ajustes → Integrações → Integração via API* (começa com `pn_`). Ele vai nas variáveis da Vercel, não no chat.
2. [ ] **(você)** Informar:
   - qual painel do CRM é o de vendas;
   - quais etapas significam *orçamento*, *ganho* e *perdido*;
   - quais campos personalizados os cards têm (destino, datas, valor, passageiros, forma de pagamento).
3. [ ] **(eu)** Conector Frédy no sistema, com as configurações por agência (token e mapeamento de etapas) em Configurações → Integrações.
4. [ ] **(eu)** **Card ganho → venda**: o webhook `PANEL_CARD_STEP_CHANGE` / status `WON` cria a venda com cliente, valor, destino e datas, prepara o contrato e mostra tudo no painel.
   - Se o card trouxer forma de pagamento e parcelas, a venda entra confirmada. Se não trouxer, entra como rascunho e o vendedor confirma com um clique.
5. [ ] **(eu)** **Contatos**: o cliente fica vinculado ao contato do Frédy (`fredyContactId`), e criar ou atualizar de um lado reflete do outro.
6. [ ] **(eu)** **Gestão → Frédy**:
   - venda confirmada move o card, marca como ganho, lança o valor e deixa uma nota com o link da venda;
   - pagamento recebido vira nota e etiqueta no card.
7. [ ] **(você)** Aprovar no WhatsApp os modelos de mensagem. **(eu)** escrevo os textos:
   - pagamento recebido;
   - lembrete de parcela;
   - contrato para assinatura;
   - pré-viagem (check-in e documentos);
   - boas-vindas na volta e pesquisa de satisfação.
8. [ ] **(eu)** Disparo dos modelos pelo Frédy, respeitando o consentimento do cliente (LGPD), sem duplicar e com registro em Automações.
9. [ ] **(eu)** Testes ponta a ponta com um card real de teste.

## Fase 3 — Venda por print com IA (fluxo pedido pela cliente)

1. [ ] **(você)** Criar a chave da **API da Anthropic (Claude)** e colocá-la nas variáveis da Vercel (`ANTHROPIC_API_KEY`).
2. [ ] **(eu)** "Nova venda por print": o vendedor envia a imagem ou PDF da reserva, ou a tela do fornecedor.
3. [ ] **(eu)** A IA extrai cliente, passageiros, produtos, fornecedor, localizador, datas e valores. Os dados vêm **pré-preenchidos** no formulário, nunca gravados sem revisão.
4. [ ] **(eu)** O vendedor ajusta a forma de pagamento e o valor, confirma, e o financeiro e o contrato são gerados automaticamente.
5. [ ] **(eu)** O mesmo leitor usado na **importação do PDF da fatura** da Azul Viagens e de outras consolidadoras, preenchendo e conferindo a fatura automaticamente na conciliação por decêndio.

## Fase 4 — Contrato com assinatura online (ZapSign)

1. [ ] **(você)** Contratar a ZapSign (cerca de R$ 1,00 por contrato) e gerar o token da API.
2. [ ] **(eu)** Botão "Enviar para assinatura":
   - gera o PDF e envia aos signatários (WhatsApp ou e-mail);
   - o status volta pelo webhook e o contrato só vira "Assinado" com a confirmação da ZapSign;
   - o documento assinado é arquivado na venda.
3. [ ] **(eu)** Lançamento automático de R$ 1,00 por envio em contas a pagar, categoria Sistemas, que aparece no DRE.
4. [ ] **(você)** Revisão jurídica dos modelos de contrato. Os modelos atuais são rascunhos.

## Fase 5 — Pagamentos e bancos

1. [ ] **(você)** Escolher o gateway (Asaas, Efí ou Banco Inter) e gerar as credenciais.
2. [ ] **(eu)** Emissão de **Pix e boleto** para as parcelas. A baixa é **automática** pelo webhook do gateway e dispara a mensagem de pagamento recebido.
3. [ ] **(eu)** Conciliação bancária por **OFX**, além do CSV, com sugestão automática por valor e data.
4. [ ] **(você/eu)** **NFS-e** pelo gateway ou por um emissor (Focus NFe ou eNotas): exige o certificado e o cadastro na prefeitura.

## Fase 6 — Funcionalidades ainda pendentes (sem dependência externa)

- [ ] Pagamento parcial de fatura de fornecedor e regras automáticas de vencimento (decendial, quinzenal, IATA).
- [ ] Fatura para cliente corporativo e centro de custo do passageiro.
- [ ] Data de competência separada do vencimento nas despesas e rateio entre centros de custo.
- [ ] Plano de comissão com metas, faixas e fechamento mensal.
- [ ] Exportação Excel/CSV nas telas novas (embarques, créditos, metas, ranking, tarefas, calendário).
- [ ] Foto de perfil do usuário.
- [ ] Ponto e solicitações de correção de ponto (existem na referência; confirmar se a cliente usa).
- [ ] Produtos especiais: milhas, câmbio, bloqueio aéreo, moeda estrangeira.
- [ ] Unificação de cadastros duplicados e importação de clientes por planilha.

## Fase 7 — Robustez para muitas agências

- [ ] Limite de tentativas de login em armazenamento compartilhado (Upstash Redis), porque o atual fica na memória de cada servidor.
- [ ] Arquivos em bucket privado (Cloudflare R2 ou S3) quando o volume crescer.
- [ ] Monitoramento de erros (Sentry) e alertas de falha do agendador e das integrações.
- [ ] Backups do Neon (*point-in-time restore*) e um teste de restauração.
- [ ] Testes ponta a ponta automatizados no navegador (Playwright) rodando a cada deploy.
- [ ] Termos de uso, política de privacidade e contrato de tratamento de dados (LGPD) entre o Frédy e as agências.
- [ ] Cobrança das agências pelo plano (manual no painel da plataforma ou integrada a um gateway).

---

### Ordem recomendada

1. Fase 1 (publicar)
2. Fase 2 (CRM Frédy)
3. Fase 3 (IA no print)
4. Fase 4 (ZapSign)
5. Fase 5 (pagamentos)
6. Fases 6 e 7 em paralelo, conforme a prioridade da cliente.
