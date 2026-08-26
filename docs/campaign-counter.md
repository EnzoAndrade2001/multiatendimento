# Campanha de solicitação de contadores

Campanhas do tipo `COUNTER_REQUEST` devem ser preparadas por contato. Um
cliente pode ter várias impressoras em setores diferentes; por isso a prévia e
o envio usam a lista de equipamentos ativos vinculados ao contato/cliente, com
modelo, série e localização.

## Variáveis

- `[nome]` (e o alias legado `[name]`): nome do contato;
- `[equipamento]`, `[modelo]`, `[serie]` e `[local]`: dados do primeiro
  equipamento ativo;
- `[equipamentos]`: lista numerada de todos os equipamentos ativos, uma linha
  por equipamento.

## Modelos de mensagem

`Respostas rápidas` continuam sendo os modelos curtos usados durante um
atendimento (`/quick-responses`). `Modelos de campanha` ficam em
`/campaigns/templates` e guardam nome, categoria e corpo para uso em lotes.
Ao criar uma campanha, os dois catálogos podem aparecer no seletor: o modelo
de campanha é a cópia editável e o de atendimento é identificado como
`Resposta rápida` (somente leitura). Salvar a mensagem como modelo sempre cria
um registro no catálogo de campanhas, sem alterar ou excluir a resposta rápida
original. Duplicatas com o mesmo corpo devem ser exibidas uma única vez,
priorizando o modelo de campanha.

Os marcadores de nome usados no atendimento (`[nome]`) são compatíveis com as
campanhas. Também são aceitos `[name]`, `[cliente]`, `[telefone]`, `[cpf]`,
`[cnpj]`, `[cidade]` e, nas campanhas de contadores, os marcadores de
equipamento descritos acima. Marcadores desconhecidos permanecem visíveis na
prévia para que o operador possa corrigir o texto antes de enviar.

Exemplo:

```text
Olá [nome], por favor envie os contadores destes equipamentos:
[equipamentos]
```

## Regras de segurança

O contato só entra na prévia/envio quando possui telefone internacional válido,
`enableWhatsAppCounters=true` e ao menos um equipamento ativo. Telefones
duplicados são enviados uma única vez. A API deve persistir `equipmentIds`,
`variables` e a mensagem renderizada no destinatário da campanha para permitir
auditoria, reprocessamento idempotente e conferência posterior dos contadores.

O aceite de contadores é separado do aceite de cobrança: marcar uma opção de
cobrança não autoriza automaticamente uma solicitação operacional de leitura.
