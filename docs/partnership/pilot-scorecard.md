# Scorecard do piloto

## Regras de medição

- Definir a data e hora exatas de início e fim do piloto.
- Registrar a versão do backend, frontend e Agente Local.
- Comparar os indicadores com uma linha de base anterior equivalente.
- Separar falha do produto, indisponibilidade externa e dado inválido.
- Nunca excluir tentativas malsucedidas do denominador sem justificar a exclusão.
- Apresentar volume da amostra junto com qualquer percentual.

## Indicadores essenciais

| Indicador | Fórmula | Fonte atual | Meta inicial | Periodicidade |
|---|---|---|---:|---|
| Sucesso de abertura de O.S. | O.S. confirmadas com SEQOS / solicitações válidas | ServiceOrder + comandos Firebird | ≥ 99% | Diário/semanal |
| Duplicidade de O.S. | solicitações que criaram mais de uma O.S. | requestKey + SEQOS + auditoria iLux | 0 | Imediato |
| Tempo de confirmação da O.S. | callback confirmado − solicitação | Requer consolidar timestamps de comandos | mediana ≤ 10 s | Semanal |
| Correção do documento de O.S. | PDFs aprovados / PDFs amostrados | Checklist comparativo com iLux | 100% | Semanal |
| Cobertura de cobrança | clientes opt-in que receberam / clientes opt-in esperados | BillingLog + relatório de cobertura | ≥ 95%* | Por lote |
| Duplicidade de cobrança | pacotes repetidos após sucesso | Ledger + BillingLog + conversa | 0 | Por lote |
| Falha por contato inválido | contatos inválidos / esperados | BillingLog | acompanhar tendência | Por lote |
| TMA | média entre criação e resolução | Dashboard | melhorar vs. baseline | Semanal |
| Primeira resposta/SLA | tickets dentro do SLA / tickets elegíveis | Ticket | ≥ meta da empresa | Semanal |
| CSAT | média e distribuição das avaliações | Ticket.rating | manter ou melhorar baseline | Semanal |
| Adoção dos usuários | usuários ativos / usuários treinados | Requer telemetria de login/uso | ≥ 80% | Semanal |
| Disponibilidade do Agente | tempo online / janela operacional | Requer histórico de heartbeat | ≥ 99% | Semanal |
| Atualidade da sincronização | tempo desde último sync saudável | TenantSettings | dentro do intervalo configurado | Diário |

\* Excluir somente números comprovadamente sem WhatsApp ou casos retirados formalmente do escopo; manter a quantidade excluída no relatório.

## Linha de base

Antes de iniciar, registrar ao menos sete dias do processo atual:

- quantidade de chamados recebidos pelo WhatsApp;
- tempo até localizar cliente e equipamento;
- tempo médio para abrir e comunicar uma O.S.;
- quantidade de O.S. com cadastro corrigido posteriormente;
- quantidade de pedidos de segunda via financeira;
- tempo gasto para localizar e reenviar documentos;
- clientes que deveriam receber a cobrança e não receberam;
- incidentes de envio duplicado.

## Indicadores já disponíveis

- Mensagens humanas e de IA.
- Tickets ativos, pendentes e resolvidos.
- TMA, CSAT e desempenho por atendente.
- Clientes novos e totais.
- Clientes, equipamentos, equipamentos ativos e em contrato.
- Contratos ativos, mensalidade e O.S. abertas.
- Cobertura de cobrança, sucessos, falhas, sem telefone e sem opt-in.
- Última sincronização e estado atual do Agente Local.
- SLA, reincidência e indicadores do iLux Sentinela.

## Instrumentação a complementar

Os itens abaixo não devem ser apresentados como métricas históricas prontas até receberem armazenamento próprio:

- login e usuário ativo por dia;
- uso de cada módulo e ação;
- histórico de uptime/heartbeat do Agente Local;
- latência agregada do comando de abertura da O.S.;
- funil completo solicitação → comando → gravação → mensagem → impressão;
- economia real de tempo medida por tarefa.

## Modelo de revisão semanal

1. Volume processado.
2. Resultado de cada indicador e comparação com baseline.
3. Falhas classificadas por causa.
4. Evidências de duplicidade ou integridade.
5. Feedback de atendentes e gestores.
6. Correções de baixo risco para a semana seguinte.
7. Decisão de manter, ampliar, ajustar ou interromper o piloto.

## Critérios de conclusão positiva

- Nenhuma duplicidade de O.S. ou cobrança.
- Integridade dos dados e documentos aprovada pelo responsável iLux.
- Metas essenciais atingidas por duas semanas consecutivas.
- Usuários confirmam redução de troca entre sistemas.
- Empresa participante aprova a continuidade do fluxo.
- Incidentes críticos possuem causa e correção documentadas.

