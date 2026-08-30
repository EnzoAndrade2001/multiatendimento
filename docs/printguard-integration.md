# Integração PrintGuard

## Responsabilidades

- O PrintGuard coleta e conserva a telemetria original.
- O Multiatendimento recebe os eventos, faz a triagem e controla a aprovação humana.
- O iLux continua sendo a fonte oficial da O.S. e confirma seu número pelo agente local.

## Pareamento e segurança

O administrador gera no PrintGuard um código de uso único, válido por 15 minutos, e o informa em **Ajustes > PrintGuard** no Multiatendimento. A troca cria um token de acesso e um segredo de webhook exclusivos da empresa. Ambos são armazenados criptografados e nunca retornam para a interface.

O webhook usa os cabeçalhos `X-PrintGuard-Connection`, `X-PrintGuard-Timestamp` e `X-PrintGuard-Signature`. A assinatura HMAC-SHA256 cobre exatamente os bytes `${timestamp}.${body}` e expira em cinco minutos. Configure `PRINTGUARD_ENCRYPTION_KEY` com 32 bytes em hexadecimal ou Base64 antes de iniciar o backend.

## Correspondência e operação

- `customer.customerCode` corresponde ao `externalId` do cliente sincronizado do iLux.
- `equipment.serialNumber` corresponde ao número de série do equipamento no CRM.
- `equipment.meter` expõe a leitura atual do equipamento: `pageCounter`, `usageCounters` e `readAt`. Os aliases `page_counter` e `usage_counters` permanecem disponíveis para clientes legados.
- Eventos sem correspondência única ficam em erro para revisão; nunca abrem O.S. automaticamente.
- A aprovação exige a seleção explícita do tipo de O.S. e cria uma solicitação idempotente `printguard:<evento>` no fluxo normal do agente Firebird.

O PrintGuard usa uma fila persistente para entregar webhooks fora do ciclo de coleta. Falhas recebem novas tentativas com espera progressiva; o cursor somente avança após confirmações contíguas, evitando perda de eventos.

## Contadores e sincronização

O endpoint autenticado `/integrations/v1/multiatendimento/equipment` retorna o retrato atual de cada equipamento, incluindo `meter.pageCounter`, `meter.usageCounters` e `meter.readAt`. Quando o PrintGuard gera um alerta, a mesma fotografia é enviada no webhook, tanto em `meter` quanto dentro de `measurement.meter`.

O botão **Sincronizar** do Multiatendimento consulta esse endpoint e grava o último retrato nos equipamentos CRM vinculados por série/cliente. Leituras antigas não substituem uma leitura mais nova. O histórico bruto continua preservado no evento e no PrintGuard; o CRM usa o retrato atual para ficha do cliente, telemetria e futuras projeções de consumo.

## Implantação segura

1. Aplique as migrações/banco dos dois sistemas.
2. Configure `PRINTGUARD_ENCRYPTION_KEY`, a URL pública HTTPS do Multiatendimento e a URL HTTPS do PrintGuard.
3. Implante primeiro o PrintGuard e depois o Multiatendimento.
4. Faça o pareamento e execute **Testar conexão**.
5. Valide um evento de teste até a fila, sem aprovar a O.S.
6. Aprove o evento escolhendo um tipo de O.S. e confirme o número retornado pelo iLux.
