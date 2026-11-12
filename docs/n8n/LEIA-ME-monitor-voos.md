# Monitor de voos (n8n + AeroDataBox → WhatsApp dos admins)

Automação separada do painel. Todo dia às 6h (horário de Brasília) ela:

1. pega na gestão os voos dos clientes de **hoje e amanhã** (vendas confirmadas);
2. consulta **uma vez** cada voo no AeroDataBox;
3. se achar algo, manda um resumo no WhatsApp dos admins:
   - ❌ cancelado pela companhia (ou ⚠️ possível cancelamento);
   - ⏰ atrasado (a partir de 30 min);
   - 🕑 horário mudou na companhia (diferente do que está na venda);
   - ↪️ desviado;
   - 🚪 terminal e portão, quando o aeroporto informa;
   - no fim, os voos que o AeroDataBox não encontrou (para saber a cobertura).

Sem alerta no dia, não manda nada (dá para mudar em `AVISAR_SEM_ALERTA`).

## Consumo (plano grátis do AeroDataBox)
- Cada consulta gasta 2 unidades. O plano grátis tem 400 por mês, ou seja, 200 consultas.
- Cada voo é consultado 2 vezes (na véspera e no dia), então cabem **cerca de 100 voos por mês**.
- O plano grátis é **só para teste** (não permite uso comercial). Para usar de verdade: Pro US$ 7,50 (cerca de 1.250 voos/mês) ou Pro 2 US$ 15 (cerca de 3.700 voos/mês).
- O consumo aparece no painel da conta do AeroDataBox (API.market ou RapidAPI).

## Como configurar
1. **Chave do AeroDataBox:** crie a conta grátis em https://apimarket.aerodatabox.com (ou https://rapid.aerodatabox.com) e copie a chave da API.
2. **Chave da API da gestão:** na gestão, em **Configurações › Agência**, no quadro **API de eventos (consulta)**, clique em gerar chave (ela só aparece uma vez). Se a agência já tem uma chave em uso em outra integração, use a mesma: gerar outra invalida a anterior.
3. **n8n:** **Workflows › Import from file** › `monitor-voos.json`.
4. Nó **Voos de hoje e amanhã (gestão)**: troque `COLE_AQUI_A_CHAVE_DA_API_DA_GESTAO` pela chave do passo 2.
5. Nó **Conferir no AeroDataBox**, no topo do código:
   - `AERODATABOX_KEY`: a chave do passo 1;
   - `MARKETPLACE`: `"apimarket"` ou `"rapidapi"`, conforme onde criou a conta;
   - `CANAL`: número do WhatsApp da agência no WTS/Frédy (só números, com 55);
   - `ADMINS`: os números que recebem os alertas, por exemplo `["5542999990000", "5542988880000"]`.
6. Nó **Avisar os admins no WhatsApp (WTS)**: troque `COLE_AQUI_O_TOKEN_DO_WTS_pn_` pelo token da API do WTS (Ajustes › Integrações › Integração via API).
7. Para testar, clique em **Execute workflow**. Depois ative o fluxo (**Active**).

## Atenção
- **Janela de 24 h do WhatsApp:** mensagem de texto só chega se o número do admin tiver conversado com o WhatsApp da agência nas últimas 24 h. Para garantir sempre, crie no WTS um modelo de mensagem aprovado e troque o envio de texto pelo envio de modelo (`/v1/send/template`).
- Os voos vêm do que está cadastrado na venda (quadro **Voos**) ou importado do Monde. Voo sem cadastro não é conferido.
- A cobertura ao vivo do AeroDataBox no Brasil é parcial (o próprio provedor informa 35% dos aeroportos). Os voos sem informação aparecem no fim da mensagem: use o período de teste para avaliar.
