# QA — Fila de decisão do Saúde do Parque

Este documento define os critérios mínimos para liberar os itens gerenciais 1–9 da fila de telemetria. A fila deve orientar uma decisão auditável; não pode ser apenas uma lista de sinais técnicos.

## Matriz de aceite

| Área | Cenário | Resultado esperado | Criticidade |
|---|---|---|---|
| Prioridade | Falha crítica de hardware, sem O.S. aberta | Classificação P1, justificativa visível e recomendação para abrir O.S. | Bloqueante |
| Prioridade | Toner com previsão de até 1 dia | P1 ou P2 conforme demais sinais; prazo e consumo usados na justificativa | Bloqueante |
| Prioridade | Evento sem vínculo inequívoco | A recomendação é corrigir vínculo; abertura de O.S. permanece bloqueada | Bloqueante |
| Prioridade | Equipamento com O.S. aberta | O card identifica a O.S. e recomenda abri-la, sem permitir duplicação silenciosa | Bloqueante |
| Recomendação | Dados insuficientes para abrir O.S. | Recomenda monitorar com prazo e informa confiança baixa/média | Alta |
| Monitoramento | Usuário informa prazo futuro, responsável e condição | Evento vira `MONITORING` e os dados persistem após recarregar | Bloqueante |
| Monitoramento | Prazo expira sem resolução | Evento reaparece na fila de decisão, fica atrasado e recebe prioridade maior | Bloqueante |
| Monitoramento | Prazo inválido ou no passado | API responde 400 e nenhuma alteração parcial é gravada | Alta |
| Ignorar | Usuário tenta ignorar sem motivo | Ação é recusada; a interface solicita motivo estruturado | Bloqueante |
| Ignorar | Motivo válido e observação opcional | Estado `IGNORED`, motivo, ator e instante ficam persistidos e auditáveis | Bloqueante |
| Vínculo | Evento ambíguo exibe candidatos | Candidatos mostram cliente, equipamento, série, patrimônio/setor/endereço e confiança | Alta |
| Vínculo | Usuário confirma candidato | Binding vira `MATCHED`, registra origem manual/ator e futuros eventos da mesma identidade reutilizam o vínculo | Bloqueante |
| Vínculo | Candidato pertence a outro tenant | API nega a operação sem revelar dados do outro tenant | Bloqueante |
| O.S. | Dois cliques concorrentes no mesmo evento | No máximo uma O.S. é criada; a segunda tentativa retorna a O.S. existente/409 | Bloqueante |
| O.S. | O equipamento já tem O.S. compatível em aberto | Card mostra “Ver O.S. existente”; abertura duplicada exige fluxo excepcional explícito | Bloqueante |
| O.S. | Criação no iLux falha | Evento não fica como resolvido; erro e possibilidade de reprocessar são preservados | Bloqueante |
| Workflow | Atribuir responsável e vencimento | Responsável, prazo, status e próximo passo aparecem no card e persistem | Alta |
| Workflow | Usuário sem acesso tenta atribuir/decidir | API retorna 403; esconder botão no frontend não é considerado proteção suficiente | Bloqueante |
| Ações rápidas | Abrir cliente, histórico, WhatsApp, O.S. e vínculo | Cada ação abre o contexto correto sem empilhar modais nem bloquear scroll da página | Alta |
| Consolidação | Vários alertas do mesmo cliente | Gera uma única O.S. com todos os itens, mantendo rastreabilidade evento → O.S. | Bloqueante |
| Consolidação | Alertas de clientes diferentes ou vínculo pendente | Consolidação é recusada no backend | Bloqueante |
| Reposição | Cliente com três alertas de insumo | Painel consolida equipamentos/cores/urgência/endereço e oferece gerar uma O.S. | Alta |
| Auditoria | Monitorar, ignorar, vincular, atribuir ou abrir O.S. | Registra tenant, ator, ação, recurso, resultado e metadados sem segredos | Bloqueante |
| Auditoria | Operação falha ou é negada | Registro indica `DENIED_OR_FAILED`, sem marcar sucesso | Alta |
| Responsividade | 1366×768 e 1024×768 | Sem corte de ações; painel lateral não encobre a fila; rolagem permanece funcional | Alta |
| Tema | Claro e escuro | Estados P1–P4 e sucesso/alerta/erro continuam legíveis sem depender somente de cor | Alta |
| Acessibilidade | Teclado e leitor de tela | Modal prende foco, fecha com Esc, restaura foco e botões têm rótulos; tabela/cards mantêm ordem lógica | Média |

## Regras que devem existir também no backend

1. Todo filtro e mutação deve aplicar `tenantId`.
2. O backend deve verificar permissões por tipo de ação. `telemetry.view` não deve, sozinho, autorizar decisões mutáveis.
3. Monitoramento exige prazo futuro e deve ter mecanismo periódico ou leitura da fila que reabra prazos expirados.
4. Ignorar exige código de motivo conhecido; texto livre é complemento, não substituto.
5. Vínculo manual só aceita cliente e equipamento consistentes entre si e pertencentes ao mesmo tenant.
6. A criação individual e consolidada de O.S. precisa de chave idempotente e verificação de O.S. aberta.
7. Transições válidas precisam ser explícitas. Exemplo: `RECEIVED → MONITORING/IGNORED/APPROVED`; `MONITORING → RECEIVED/IGNORED/APPROVED`; uma O.S. confirmada não volta silenciosamente para recebido.
8. Auditoria deve ser produzida pela rota mutável, inclusive para falhas, e não depender do frontend.

## Riscos de migração e regressão

- Os novos campos de `PrintGuardTelemetryEvent` devem permanecer opcionais ou com default para permitir `prisma db push` sobre registros existentes.
- Índices novos são aditivos, mas podem bloquear brevemente uma tabela grande no PostgreSQL durante o deploy. Implantar fora do pico e observar o tempo do `db push`.
- Guardar IDs de usuário sem relação Prisma evita falha imediata por registros antigos, mas não garante integridade referencial. A API precisa validar o usuário e definir o comportamento quando ele for desativado/excluído.
- A reentrada de monitoramento não pode depender apenas de um componente aberto no navegador. Deve ocorrer no backend (job) ou ser calculada de modo determinístico em toda consulta da fila.
- A detecção de O.S. existente deve usar status normalizados do iLux. Uma lista incompleta de status fechados pode bloquear alertas para sempre ou criar duplicatas.
- `serviceOrderId` em telemetria não basta para detectar uma O.S. aberta criada fora do PrintGuard; consultar também as O.S. atuais do equipamento.
- A consolidação atual escolhe um equipamento para a O.S. agregada. O texto e a auditoria precisam preservar os demais equipamentos e o frontend deve deixar isso explícito.
- A ação “WhatsApp” deve respeitar seleção de instância e regras da API oficial já existentes no Inbox.

## Roteiro de fumaça antes do deploy

1. Abrir um evento P1 vinculado e criar O.S.; atualizar a página e confirmar a mesma O.S.
2. Repetir a chamada de criação e confirmar que não surge outra O.S.
3. Monitorar um evento por poucos minutos; confirmar reentrada após o prazo.
4. Ignorar com cada motivo e verificar auditoria; tentar sem motivo e confirmar 400.
5. Corrigir um vínculo ambíguo e confirmar que um novo evento com a mesma série nasce vinculado.
6. Consolidar dois toners do mesmo cliente; tentar consolidar clientes distintos e confirmar bloqueio.
7. Testar com perfil somente `telemetry.view` e com perfil autorizado a criar O.S.
8. Abrir/fechar todos os modais em sequência e confirmar que o scroll da página não permanece bloqueado.
9. Validar claro/escuro em 1920×1080, 1366×768 e 1024×768.
10. Conferir no log de auditoria ator, ação, recurso, resultado e ausência de credenciais/tokens.
