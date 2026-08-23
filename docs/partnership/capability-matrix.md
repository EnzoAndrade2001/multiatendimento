# Matriz de capacidades atuais

Legenda de maturidade:

- **Operacional:** usado no tenant LCD DIGITAL.
- **Disponível:** implementado e pronto para validação no piloto.
- **Condicionado:** depende de configuração, provedor ou dado local.
- **Evolução:** não apresentar como capacidade homologada.

| Domínio | Capacidade | Maturidade | Fonte ou dependência | Evidência esperada na demo |
|---|---|---:|---|---|
| Atendimento | Receber e enviar mensagens pelo WhatsApp | Operacional | Evolution API | Mensagem aparece em tempo real e resposta chega ao telefone controlado |
| Atendimento | Filas, responsável, prioridade, estados e não lidos | Operacional | PostgreSQL + Socket.IO | Ticket muda de estado sem perder o histórico |
| Atendimento | Transferir, encerrar e reabrir | Operacional | Permissões e eventos do ticket | Ação respeita o perfil e fica refletida na conversa |
| Atendimento | Notas internas, mídias e respostas rápidas | Operacional | Banco local da aplicação | Conteúdo privado não é enviado ao cliente |
| IA | Resumo, transcrição e apoio ao atendimento | Condicionado | Google Gemini | Resultado aparece somente quando a credencial e o serviço estão disponíveis |
| CRM | Vincular contato WhatsApp ao cliente iLux | Operacional | Cadastro sincronizado | Cliente correto abre na Visão 360 |
| CRM 360 | Identificação, unidades e contatos | Operacional | iLux + contatos vinculados | Dados coincidem com o cadastro demonstrado |
| CRM 360 | Equipamentos, localização e filtros operacionais | Operacional | IXLEQUIPAMENTO sincronizada | Filtros de ativos/em contrato retornam itens coerentes |
| CRM 360 | Contratos e valores mensais | Operacional | Registros de contrato sincronizados | Vigência, situação e valor são exibidos para perfil autorizado |
| CRM 360 | Histórico de O.S., SLA e reincidência | Operacional | IXLOS/local + regras configuradas | Histórico pertence ao cliente e equipamento selecionados |
| O.S. | Gerar rascunho do defeito com apoio de IA | Condicionado | Gemini + histórico da conversa | Usuário pode revisar antes de confirmar |
| O.S. | Abrir O.S. no Firebird e devolver SEQOS | Operacional | Agente Local + Firebird | Número confirmado coincide com o iLux e não duplica |
| O.S. | PDF com dados e histórico no padrão acordado | Operacional | Dados retornados pelo agente | Documento contém cliente, equipamento, técnico e histórico |
| O.S. | Mensagem ao cliente e cópia ao gestor | Operacional | Instância e telefone configurados | Entrega chega aos telefones controlados e é registrada |
| Financeiro | Exibir títulos, valores, vencimentos e situação | Operacional | IRECEITAS sincronizada | Título selecionado coincide com o iLux |
| Financeiro | Localizar Nota, Demonstrativo e Boleto oficiais | Condicionado | PDFs gerados pelo iLux e pasta monitorada | Arquivos pertencem ao cliente e título corretos |
| Financeiro | Reenviar documentos pelo WhatsApp | Operacional | Documento disponível + permissão | Envio é registrado na conversa |
| Cobrança | Automação com opt-in e data de corte | Operacional | Configuração por tenant | Somente contatos autorizados entram no processamento |
| Cobrança | Proteção contra reenvio de pacote concluído | Operacional | Ledger local + logs do backend | Reprocessamento ignora os que já receberam |
| Cobrança | Cobertura: deveriam receber × receberam | Operacional | Opt-in CRM + BillingLog | Relatório separa recebidos, falhas, sem telefone e pendências |
| Gestão | Dashboard de mensagens, TMA, CSAT e agentes | Disponível | Histórico operacional | Período e base das métricas ficam explícitos |
| Gestão | iLux Sentinela e indicadores de risco | Disponível | CRM, contratos, O.S. e snapshots | Indicador permite abrir sua origem ou detalhamento |
| Segurança | Perfis Administrador, Supervisor, Atendente, Financeiro, Técnico e Personalizado | Disponível | Permissões frontend e backend | Acesso direto e ações são bloqueados quando não autorizados |
| Integração | Sincronização pelo Agente Local | Operacional | Executável Windows | Tela mostra último sinal, versão e status |
| Integração | Firebird sem porta pública para o CRM | Operacional | Comunicação HTTPS de saída | Arquitetura é explicada sem expor credenciais |
| Plataforma | Multiempresa e identidade por tenant | Disponível | Isolamento por tenantId | Usuário vê somente dados e marca do seu tenant |
| Plataforma | Meta/Facebook/Instagram | Evolução | Não há runtime homologado | Não demonstrar como funcionalidade atual |

## Limites que devem ser explicitados

- O WhatsApp depende da disponibilidade da instância e do provedor configurado.
- IA não é fonte da verdade; resultados são apoio e devem ser revisados.
- Documentos financeiros oficiais precisam ter sido gerados pelo fluxo iLux e estar na pasta monitorada.
- A sincronização histórica de O.S. pode ser desativada por desempenho; a abertura imediata usa um canal de comandos independente.
- A GUI do Agente Local e os caminhos de documentos são configurados por empresa.
- A primeira homologação deve validar as tabelas e códigos específicos da versão do iLux utilizada.

