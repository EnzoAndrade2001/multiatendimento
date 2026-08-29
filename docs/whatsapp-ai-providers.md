# WhatsApp oficial e provedores de IA

## Canais do WhatsApp

- `evolution_qr`: conexão atual pela Evolution API usando `WHATSAPP-BAILEYS`. É o padrão e continua compatível com todas as instâncias existentes.
- `evolution_official`: WhatsApp Cloud API da Meta integrado pela Evolution API usando `WHATSAPP-BUSINESS`.
- A conexão oficial exige número com país/DDD, `Phone Number ID` e token permanente da Meta. O `Business Account ID` é opcional.
- O token oficial é encaminhado uma única vez à Evolution durante a criação e não é persistido pelo CRM.
- Conversas iniciadas pela empresa fora da janela de atendimento da Meta exigem template previamente aprovado.

## Provedores de IA

Cada tenant pode selecionar no painel:

- Google Gemini (padrão e compatibilidade atual);
- OpenAI / GPT;
- Anthropic / Claude.

O botão **Testar provedor de IA** valida chave, modelo e comunicação antes de salvar. A escolha principal é usada em respostas, resumos, classificação e rascunhos de O.S.

Embeddings, manuais já indexados, transcrição de áudio e análise de imagem continuam usando Gemini. Essa separação preserva os vetores existentes e permite trocar a LLM de conversa sem reindexar a base.
