# Mensagens automáticas pelo n8n (Frédy Gestão → WhatsApp/WTS)

O Frédy Gestão avisa o n8n quando acontece cada evento. O n8n confere se o aviso veio mesmo da gestão (assinatura), se o
cliente autorizou mensagens e manda o **modelo de WhatsApp aprovado** pelo WTS/Frédy.

| Aviso do sistema | Quando | Automação para ligar (Configurações › Automações) |
|---|---|---|
| `cliente.aniversario` | no dia do aniversário (1x por ano) | Aniversário do cliente |
| `viagem.checkin` | na véspera do embarque | Lembrete de check-in |
| `viagem.concluida` | no dia seguinte ao retorno (pedido de feedback) | Viagem concluída |
| `pagamento.vencendo` | parcela perto do vencimento | Pagamento vencendo |
| `pagamento.identificado` | parcela recebida (baixa no financeiro) | Pagamento identificado |

## 1. Criar os modelos no WTS/Frédy (precisam de aprovação do WhatsApp)
Em **Ajustes › Modelos**, crie um modelo para cada aviso que quiser usar. Use **exatamente** estes nomes de variáveis
(o fluxo manda os valores com esses nomes). Textos sugeridos — ajuste à vontade, mantendo as variáveis:

**Aniversário** (categoria Marketing)
> Oi, {{nome}}! 🎉 Toda a equipe da {{agencia}} deseja um feliz aniversário! Que o seu novo ano seja cheio de viagens incríveis. ✈️

**Lembrete de check-in** (categoria Utilidade)
> Oi, {{nome}}! Sua viagem para {{destino}} é amanhã ({{data}}). Lembre de fazer o check-in e separar os documentos. Localizador: {{localizador}}. Qualquer dúvida, a {{agencia}} está aqui. Boa viagem! ✈️

**Pedido de feedback** (categoria Utilidade)
> Oi, {{nome}}! Bem-vindo(a) de volta de {{destino}}! Como foi a viagem? Sua opinião ajuda muito a {{agencia}} a melhorar. 😊

**Parcela vencendo** (categoria Utilidade)
> Oi, {{nome}}! Passando para lembrar que a parcela de {{valor}} da sua viagem ({{venda}}) vence em {{vencimento}}. Se já pagou, desconsidere. — {{agencia}}

**Pagamento recebido** (categoria Utilidade)
> Oi, {{nome}}! Recebemos seu pagamento de {{valor}} referente à viagem {{venda}}. Obrigado! — {{agencia}}

Depois de aprovados, anote o **ID** de cada modelo.

## 2. Importar o fluxo no n8n
1. n8n › **Workflows › Import from file** › escolha `mensagens-automaticas.json` (esta pasta).
2. Nó **Calcular assinatura**: em *Secret*, cole o **segredo do webhook** (o mesmo do passo 3).
3. Nó **Conferir e montar mensagem**: no topo do código, preencha
   - `CANAL`: número do WhatsApp da agência no WTS (só números, com 55);
   - `MODELOS`: o ID de cada modelo aprovado (deixe `""` nos avisos que não for usar);
   - `TESTE_PARA` (opcional): o seu WhatsApp, para testar com o botão de teste do sistema.
4. Nó **Enviar modelo pelo WhatsApp (WTS)**: troque `COLE_AQUI_O_TOKEN_DO_WTS_pn_` pelo token da API do WTS
   (Ajustes › Integrações › Integração via API). Melhor ainda: crie uma credencial *Header Auth* e use-a no nó.
5. Abra o nó **Aviso do Frédy Gestão** e copie a **Production URL**. Ative o fluxo (*Active*).

## 3. Ligar no Frédy Gestão
1. **Configurações › Integrações/Webhook**: cole a Production URL do n8n e defina um **segredo** (o mesmo do passo 2.2). Salve.
2. Clique em **Enviar evento de teste**. No n8n, em *Executions*, deve aparecer a execução (com `TESTE_PARA` preenchido, chega a mensagem de aniversário de teste no seu WhatsApp).
3. Em **Configurações › Automações**, ligue cada aviso desejado.

## Regras importantes
- Só recebe mensagem quem tem **"Cliente autorizou comunicações automáticas"** marcado no cadastro (LGPD).
- Cliente sem WhatsApp no cadastro é ignorado.
- Fora da janela de 24 h do WhatsApp só é possível mandar **modelo aprovado** — por isso o fluxo usa modelos.
- O formato do número (`to`) usado é `55` + DDD + número. Se o primeiro teste falhar por formato, ajuste no código (ex.: `"+" + c.whatsapp`).
- Aviso adulterado ou de outra origem (assinatura errada) é descartado.
