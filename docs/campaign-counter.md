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
