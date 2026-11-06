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

No ar em https://painelgestaofredy.vercel.app (GitHub teixeirzkj/painelgestaofredy, banco Neon em São Paulo).

1. [x] **(você)** Liberar o GitHub. Em *teteateteproject/paineldegestao → Settings → Collaborators*, adicione `teixeirzkj` com escrita. **(eu)** faço o `git push` em seguida.
   - Sem GitHub também dá: `npx vercel login` e `npx vercel --prod` direto desta máquina.
2. [x] **(você)** Criar a conta e o projeto na Vercel, que pode ser o plano Hobby para começar: *Add New → Project → Import* do repositório `paineldegestao`.
3. [x] **(você)** Ainda no projeto, em *Storage → Create Database → Neon (Postgres)*:
   - Escolha a região **São Paulo (sa-east-1)**.
   - A integração cria sozinha `DATABASE_URL` e `DATABASE_URL_UNPOOLED`.
4. [x] **(você)** Em *Settings → Environment Variables* (Production), criar:
   - `AUTH_SECRET`: 64 caracteres aleatórios. **(eu)** gero para você.
   - `CRON_SECRET`: 32 ou mais caracteres aleatórios.
   - `PLATFORM_BOOTSTRAP_EMAIL` e `PLATFORM_BOOTSTRAP_PASSWORD`: o seu acesso ao painel da plataforma.
5. [x] **(você)** Fazer o deploy. O build roda as migrações e cria as tabelas.
6. [x] **(você/eu)** Primeiro acesso:
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

- [x] **(eu)** Conector Frédy por agência, em *Configurações → Integrações*:
  - a agência cola o token da API (`pn_...`), que é validado no Frédy e guardado criptografado;
  - escolhe o painel de vendas, as etapas (orçamento, ganho, perdido) e os campos do card (destino, ida, volta, passageiros);
  - ao salvar, o sistema registra sozinho o webhook no Frédy.
- [x] **(eu)** **Card ganho → venda**: card do painel de vendas marcado como ganho (ou movido para a etapa de ganho) cria a venda em rascunho, com o cliente vinculado ao contato do Frédy, o valor e os dados do card. Nunca duplica. Card ganho sem valor recebe uma nota pedindo o valor e a venda é criada quando ele for preenchido.
- [x] **(eu)** **Contatos**: contato atualizado no Frédy atualiza nome, e-mail e WhatsApp do cliente vinculado.
- [x] **(eu)** **Gestão → Frédy**: venda confirmada marca o card como ganho, com o valor final e uma nota com o código e o link da venda; pagamento recebido vira nota no card.
- [x] **(você)** Gerar o token em *Frédy → Ajustes → Integrações → Integração via API → Novo* e colar em *Configurações → Integrações* da agência.
- [ ] **(você/eu)** Teste ponta a ponta com um card real de teste.
- [ ] **(você)** Aprovar no WhatsApp os modelos de mensagem. **(eu)** escrevo os textos e faço o disparo pelo Frédy respeitando o consentimento (LGPD): pagamento recebido, lembrete de parcela, contrato para assinatura, pré-viagem, pós-viagem.

## Fase 3 — Venda por print com IA

- [x] **(eu)** "Preencher pelo print da reserva" na nova venda e nos rascunhos: envio, arrastar ou colar (Ctrl+V) imagem ou PDF.
- [x] **(eu)** A IA extrai cliente, passageiros, produtos, fornecedor, localizador, datas e valores e **pré-preenche** o formulário. Nada é gravado sem revisão; o cliente e o fornecedor são vinculados quando já existem no cadastro.
- [ ] **(você)** Criar a chave da API da Anthropic (Claude) em console.anthropic.com e colocá-la na Vercel como `ANTHROPIC_API_KEY`. Sem ela a tela avisa que a leitura não está ativada.
- [ ] **(eu)** O mesmo leitor para o PDF da fatura das consolidadoras (conferência por decêndio).

## Fase 4 — Contrato com assinatura online (ZapSign)

- [x] **(eu)** Botão "Enviar para assinatura" no contrato emitido: o cliente recebe o link por e-mail (e, se marcado, por WhatsApp da ZapSign); a agência também assina quando o responsável e o e-mail estão em Configurações. Há "Copiar link de assinatura" e "Consultar status".
- [x] **(eu)** O contrato só vira "Assinado" quando a ZapSign confirma: o webhook avisa e o sistema consulta o documento na API antes de marcar. O PDF assinado é anexado à venda. Recusa do cliente cancela o contrato.
- [x] **(eu)** Cada envio lança R$ 1,00 em contas a pagar da agência (categoria Sistemas, entra no DRE) e aparece no painel da plataforma em "Assinaturas no mês", para a cobrança.
- [ ] **(você)** Contratar a ZapSign, gerar o token da API (*Configurações → Integrações → API ZapSign*) e colocá-lo na Vercel como `ZAPSIGN_API_TOKEN`. O webhook é registrado sozinho no primeiro envio.
- [ ] **(você)** Revisão jurídica dos modelos de contrato. Os modelos atuais são rascunhos.

## Pedidos da cliente (novembro/2026)

- [x] **(eu)** Documentos do cliente com imagem: fotos de RG, CPF, CNH, passaporte, visto e outros, com número e validade, na ficha do cliente. Dá para enviar, arrastar, colar ou tirar a foto pelo celular. O número do RG e do passaporte completa o cadastro.
- [x] **(eu)** Importar clientes por planilha (CSV, com modelo para baixar). Não duplica: completa só os campos vazios.
- [x] **(eu)** Importar clientes do Monde pela API oficial, com login e senha de um usuário com acesso total no Monde. A API do Monde **não entrega vendas nem as imagens** dos documentos.
- [ ] **(você)** Exportar do Monde a planilha de vendas e me mandar um arquivo de exemplo. **(eu)** faço a importação das vendas antigas a partir das colunas reais.
- [x] **(eu)** Venda rápida (popup do vendedor) em `/balcao`: cliente com documentos, venda e contrato numa tela só.
  - Com `?card=ID` (id do card do Frédy), já vem com o contato, o valor e os campos do card, e a venda fica ligada ao card.
  - O link está em Configurações → Integrações.
- [x] **(eu)** Vouchers e documentos da venda com miniatura das imagens, vários arquivos de uma vez, arrastar e colar.
- [x] **(eu)** Eventos para mensagens automáticas pelo n8n:
  - aniversário (`cliente.aniversario`);
  - lembrete de check-in na véspera (`viagem.checkin`);
  - pedido de feedback após o retorno (`viagem.concluida`);
  - parcela vencendo e pagamento recebido.

  Cada evento traz nome, WhatsApp com 55, e-mail e o consentimento (`messagingAllowed`). O webhook tem o botão "Enviar evento de teste".
- [ ] **(você)** No n8n, criar o fluxo que recebe o webhook e envia as mensagens pelo WhatsApp com modelos aprovados, e ligar cada automação em Automações.
- [x] **(eu)** Cartão de crédito da agência: fornecedor que só aceita cartão é pago com o cartão, à vista ou parcelado.
  - A conta do fornecedor fica quitada e o valor entra na fatura do mês certo, que vira conta a pagar no vencimento do cartão.
  - A compra fica fora do caixa até a fatura ser paga, e fora do DRE.

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
