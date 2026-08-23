# Runbook curto da apresentação

## Responsáveis

- **Apresentador e responsável pela proposta:** Diego Cabral
- **Marca e produto de referência:** iLux
- **Ambiente demonstrado:** tenant LCD DIGITAL
- **Apoio técnico:** definir antes da reunião

## 24 horas antes

- Congelar mudanças no frontend, backend e Agente Local.
- Confirmar que o commit e as versões da demonstração estão registrados.
- Verificar backup recente do PostgreSQL e política de recuperação.
- Não executar migração ou `db push` apenas para preparar a apresentação.
- Validar WhatsApp, Evolution API, Gemini quando utilizado e Firebird.
- Conferir último sync do Agente Local, versão e SHA-256.
- Confirmar o cliente-cenário, equipamento, técnico, título e telefones controlados.
- Gerar cópia de contingência do PDF de O.S. e do pacote financeiro.
- Gravar um vídeo curto do fluxo completo.

## 60 minutos antes

- Abrir o tenant LCD DIGITAL com o usuário correto.
- Confirmar logo, nome do usuário, tema e resolução da tela.
- Fechar dados, abas e notificações que não pertencem à apresentação.
- Validar permissões do perfil usado.
- Conferir que a instância de WhatsApp está conectada.
- Verificar que o Agente Local está online e sem comando travado.
- Realizar uma consulta CRM sem alterar dados.
- Confirmar espaço em disco dos volumes e pasta monitorada.
- Não fazer uma O.S. real de ensaio no mesmo cliente sem registrar o número.

## 10 minutos antes

- Desativar notificações pessoais e aplicativos sobrepostos.
- Abrir somente as páginas necessárias.
- Deixar telefone de teste disponível.
- Confirmar quem controla o compartilhamento de tela.
- Relembrar a mensagem inicial e a decisão pedida ao final.

## Durante

- Informar que LCD DIGITAL é o ambiente demonstrado, não a marca principal da proposta.
- Não exibir credenciais, tokens, caminhos internos ou dados pessoais desnecessários.
- Esperar a confirmação da O.S.; não repetir o clique durante o processamento.
- Antes de enviar documentos, conferir telefone, cliente, título e arquivos.
- Explicar dependências e limites sem improvisar capacidades futuras.
- Se ocorrer erro, registrar horário e ação; não tentar corrigir produção ao vivo.

## Smoke test da apresentação

| Verificação | Aceite |
|---|---|
| Login | usuário entra e abre a página inicial permitida |
| Navegação | Atendimento, CRM e relatórios abrem sem fallback de erro |
| WhatsApp | instância conectada e mensagem controlada trafega nos dois sentidos |
| CRM | cliente e equipamento corretos são localizados |
| Agente | último sinal recente e status saudável |
| O.S. | uma solicitação retorna um único SEQOS |
| PDF | abre e contém cliente, equipamento, técnico e histórico |
| Financeiro | título e três documentos pertencem ao mesmo cliente/período |
| Envio | telefone controlado recebe e a conversa registra o documento |
| Permissões | perfil sem autorização não vê nem executa ação restrita |

## Em caso de falha

### WhatsApp indisponível

- Não trocar credenciais durante a reunião.
- Usar o vídeo de contingência.
- Mostrar ticket e histórico já persistidos.

### Agente Local indisponível

- Não abrir repetidamente a mesma O.S.
- Mostrar a Central do Agente e explicar a comunicação de saída.
- Usar O.S. e PDF previamente confirmados.

### Documento financeiro não localizado

- Não substituir pelo modelo gerado pelo CRM.
- Mostrar outro título previamente validado.
- Registrar o arquivo como pendência de indexação.

### Tela do frontend falhar

- Fazer uma única atualização controlada.
- Se persistir, usar a gravação e não implantar correção ao vivo.

## Depois da apresentação

- Registrar participantes, perguntas e decisões.
- Guardar números de O.S. e envios realizados na demonstração.
- Classificar incidentes sem apagar logs.
- Enviar este pacote e os próximos passos aprovados.
- Se houver piloto, marcar baseline, responsáveis e revisão semanal.

## Critério de prontidão

A apresentação está pronta quando:

- o fluxo completo passa três vezes consecutivas em ambiente controlado;
- não há alteração pendente em produção;
- contingências estão acessíveis;
- todas as ações utilizam telefones autorizados;
- os números apresentados no scorecard têm fonte e período identificados;
- a proposta termina com uma decisão clara sobre homologação ou piloto.

