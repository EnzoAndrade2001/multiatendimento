# Campanhas de comunicação

O módulo **Operação > Campanhas** usa uma fila persistida no PostgreSQL. Cada campanha registra a instância de saída, público, mensagem renderizada e o resultado de cada destinatário. O worker retoma campanhas `QUEUED`/`RUNNING` após reinício e nunca reenvia destinatários que já estão em `SENT` ou `DELIVERED`.

## Fluxo recomendado

1. Selecione uma instância conectada e o tipo da comunicação (promoção, alerta,
   contadores ou cobrança).
2. Escolha uma tag ou contatos individuais. A prévia mostra elegíveis,
   duplicados, telefone inválido, falta de aceite, equipamento ausente e
   opt-out.
3. Revise a mensagem, variáveis e anexo; envie um teste quando necessário.
4. Inicie agora ou agende. O horário silencioso é respeitado por padrão e pode
   ser desativado conscientemente.
5. Acompanhe, pause, retome, cancele ou reprocesse somente falhas no histórico.
   O CSV contém o resultado por destinatário.

## Consentimento

Os aceites são separados no contato por finalidade: cobrança, marketing,
alertas e solicitação de contadores. `whatsappOptOutAt` sempre bloqueia novos
disparos, independentemente do aceite anterior.

## Solicitação de contadores

A categoria `COUNTER` considera apenas equipamentos ativos, consolida todos os
equipamentos do cliente em uma mensagem e inclui modelo, série e localização.
Consulte [campaign-counter.md](./campaign-counter.md) para as variáveis aceitas.

## Operação do worker

O processador inicia com o backend e revisa campanhas vencidas a cada 30
segundos. Se a instância ficar desconectada, a campanha permanece enfileirada.
Reservas `SENDING` abandonadas por mais de 15 minutos voltam para `PENDING`,
permitindo recuperação sem duplicar mensagens já confirmadas.
