# Eventos em tempo real: LCD Digital Web -> CRM

Endpoint do CRM:

```text
POST /api/webhook/lcd-web/events
```

Cabeçalhos obrigatórios:

- `X-Lcd-Web-Tenant`: slug do tenant;
- `X-Lcd-Web-Timestamp`: Unix timestamp em segundos;
- `X-Lcd-Web-Signature`: `sha256=` seguido do HMAC-SHA256;
- `X-Lcd-Web-Event-Id`: identificador único do evento.

A assinatura é calculada sobre:

```text
HMAC_SHA256(LCD_WEB_EVENTS_SECRET, "<timestamp>.<corpo-json-exato>")
```

O corpo mínimo é:

```json
{
  "eventId": "uuid-do-evento",
  "eventType": "customer.updated",
  "entity": "customers",
  "entityId": "codigo-do-cliente",
  "customerExternalId": "codigo-do-cliente",
  "occurredAt": "2026-10-01T19:00:00.000Z",
  "data": {}
}
```

O CRM grava o evento de forma idempotente, atualiza o espelho necessário e
emite `lcd_web_update` via Socket.IO para o tenant. A tela do CRM refaz a
consulta oficial; por isso o evento pode carregar apenas identificadores.

Eventos recomendados: `customer.created`, `customer.updated`,
`equipment.updated`, `contract.updated`, `receivable.updated`,
`billing.document.ready` e `service_order.updated`.
