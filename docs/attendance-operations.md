# SLA e distribuição automática

As duas automações começam desativadas para cada empresa. Supervisores com a permissão `settings.attendance.manage` configuram as regras em **SLA e distribuição de atendimentos**.

## SLA

- O prazo começa no início da sessão da conversa e termina na primeira resposta enviada pelo atendente pelo painel, incluindo mídia e encaminhamento. Respostas automáticas não encerram o prazo.
- A regra de equipe prevalece sobre a regra geral; uma prioridade específica prevalece dentro da mesma equipe. Regras sem equipe/prioridade funcionam como padrão.
- Regras de horário comercial reutilizam o calendário e o fuso usados pelo sistema. Configure ao menos um dia aberto antes de ativá-las; dias sem expediente não consomem o prazo.
- Mudanças em equipe, prioridade, calendário ou regra recalculam o prazo da sessão atual. Não reiniciam o relógio. O histórico de avisos e violações fica em `TicketEvent`; responder ou editar a regra não apaga a marca de violação da sessão.
- A tabela de escalações mostra até 100 conversas com aviso ou prazo vencido e oferece acesso direto à conversa para o supervisor agir. O ciclo de verificação é de 30 segundos.
- Uma nova sessão reinicia a primeira resposta e as marcas de SLA. Conversas resolvidas e em bot não entram na verificação.

## Distribuição

- Cada atendente marca **Disponível para distribuição** no painel. A aplicação mantém uma confirmação de presença a cada 45 segundos. Após dois minutos sem confirmação, o usuário deixa de receber novas atribuições.
- A seleção exige usuário ativo, permissão de assumir atendimento, equipe compatível e carga abaixo do limite configurado. Entre candidatos, recebe quem tem menos conversas abertas/pendentes; empates seguem ordem estável.
- A redistribuição é uma opção separada. Uma indisponibilidade manual é imediata; a desconexão usa o prazo configurado. Sem candidato elegível, a conversa conserva o responsável e aguarda capacidade.
- As decisões são registradas em `TicketEvent`. Um bloqueio no PostgreSQL serializa os alocadores de uma empresa entre réplicas; atualizações condicionais evitam substituir uma atribuição manual ou resposta que chegue durante a verificação.

## Operação

Aplicar a migração `20260912130000_attendance_operations` antes de iniciar a versão nova. O processo inicia o serviço com `attendanceOperationsService.start(io)`. Falhas do ciclo aparecem com o prefixo `[attendance-operations]` nos logs. Políticas persistem em `AttendancePolicy`; disponibilidade e presença persistem no usuário, evitando dependência do processo que atende sua conexão.
