# Firebird Client

Cliente de integração para rodar no servidor da empresa, ler o Firebird localmente e enviar os dados para o CRM por HTTPS.

## O que ele faz

- Lê clientes de `ICLIENTES`
- Lê equipamentos de `IXLEQUIPAMENTO`
- Lê contratos de `IXLCONTRATOS`
- Sincroniza uma janela recente de contas a receber de `IRECEITAS`
- Sincroniza contadores atuais e anteriores de `IXLEQUIPAMENTOMED`
- Sincroniza novas O.S. e atendimentos de forma incremental, em lotes pequenos, sem reler todo o histórico
- Envia os lotes para o endpoint `/api/integrations/firebird/push`
- Mantém um cursor local em `state.json`
- Registra logs em `logs/client.log` com rotação automática
- Mantém um listener HTTPS para abrir O.S. imediatamente e devolver o `SEQOS`
- Guarda resultados em `command-results.json` para impedir duplicação após falha de callback
- Consulta somente os cinco chamados anteriores e os atendimentos da nova O.S. para montar o PDF completo
- No pacote atualizado, roda como `FirebirdCRMClient.exe` e não depende de Python instalado
- Monitora, sem alterar os arquivos, uma ou mais pastas de PDFs oficiais exportados em **Documentos em Lote**
- Associa Nota/Fatura, Demonstrativo e boleto pelo conteúdo (CNPJ, número, datas e valor), sem depender do nome do arquivo

Os dados financeiros, contratos e contadores são atualizados em lotes. A primeira execução carrega a janela inicial; depois, novos registros seguem por cursor. A cada 15 minutos o agente confere os títulos em aberto, os registros recentes e as alterações de contratos, equipamentos e medidores. O refresh de contratos usa `ATUALIZADO` com uma pequena sobreposição e upsert idempotente, para que alterações de franquia, excedente, vigência ou vínculos não fiquem desatualizadas no CRM.

O incremental de O.S. vem ativo por padrão. Para desativá-lo deliberadamente, configure `SYNC_SERVICE_ORDERS_INCREMENTAL=false`.

## Instalação

Use o pacote atualizado que inclui `FirebirdCRMClient.exe`.
Depois de descompactar:

1. Execute `install.bat` ou `install.ps1`
2. Edite o arquivo `.env`
3. Rode `FirebirdCRMClient.exe` para validar

O instalador cria o arquivo `.env` automaticamente se ele não existir.

Depois preencha o arquivo `.env` com:

- caminho do banco Firebird
- usuário e senha
- URL do CRM na VPS (o pacote oficial já traz o endereço padrão)
- slug do tenant (opcional; o CRM identifica a empresa automaticamente pelo token)
- token de sincronização

O agente também informa sua identificação em cada heartbeat enviado ao CRM:

- `AGENT_VERSION`: versão do executável instalado (release atual: `1.1.5`)
- `AGENT_PROTOCOL_VERSION`: versão do contrato de comunicação com o backend
- `AGENT_INSTALL_ID`: identificador persistente da instalação (gerado
  automaticamente quando vazio, usado apenas para diagnóstico)

Além do `tenantSlug` usado pelas versões atuais do backend, o heartbeat inclui
versão, protocolo, identificador da instalação, capacidades suportadas e saúde
básica do processo. Os campos são adicionais e mantêm compatibilidade com
backends que ainda leem somente o `tenantSlug`. Atualize `AGENT_VERSION` junto
com a publicação de um novo EXE;
altere `AGENT_PROTOCOL_VERSION` apenas quando houver mudança de compatibilidade.

As pastas financeiras podem ser escolhidas diretamente na aba **Documentos financeiros** da interface. Use caminhos UNC (`\\servidor\pasta`) para compartilhamentos de rede. A primeira indexação lê todos os PDFs em segundo plano; as seguintes processam somente arquivos novos ou alterados.

## Execução

Inspecionar tabelas e campos antes de sincronizar:

```bash
inspect-schema.cmd
```

Esse comando gera `schema-report.json`. Envie esse arquivo para definirmos exatamente quais tabelas e campos do Firebird entram no CRM.

Rodar uma vez:

```bash
FirebirdCRMClient.exe --once
```

Rodar em loop contínuo:

```bash
FirebirdCRMClient.exe
```

Forçar ressincronização completa:

```bash
FirebirdCRMClient.exe --once --full
```

## Iniciar sozinho mesmo sem login após reiniciar o servidor

A opção **"Iniciar o agente com o Windows"** (dentro da aba Sincronização) usa a pasta
"Inicializar" do Windows — ela só dispara quando alguém efetivamente faz login naquela
conta. Se o servidor exige login manual após reiniciar, o agente fica parado até
alguém entrar, mesmo com essa opção marcada.

Para o agente subir sozinho **mesmo sem ninguém logar**, use o Agendador de Tarefas do
Windows em vez da pasta Inicializar:

```powershell
# Como Administrador, dentro da pasta do agente:
.\install-scheduled-task.ps1
```

O script pede o usuário/senha do Windows que o agente já usa hoje (precisa ser o
mesmo, para manter o acesso à rede/pasta do Firebird e às pastas financeiras), cria
uma tarefa que dispara na inicialização do sistema — "executando estando o usuário
conectado ou não" — e remove o atalho antigo da pasta Inicializar, se existir (os
dois juntos fariam o agente abrir duas vezes ao mesmo tempo).

Detalhes importantes:
- Nesse modo o ícone da bandeja não aparece, mesmo que alguém faça login depois — o
  processo roda numa sessão separada, de propósito. Para conferir se está rodando,
  olhe `logs/client.log` ou procure `FirebirdCRMClient.exe` no Gerenciador de Tarefas.
- Não abra o agente manualmente (duplo clique) enquanto essa tarefa estiver ativa —
  os dois processos disputariam o mesmo `state.json` e o mesmo log. Pare a tarefa
  antes (`Stop-ScheduledTask -TaskName "AgenteCRM iLux"`) se precisar mexer na tela.
- Para testar sem esperar reiniciar o servidor: `Start-ScheduledTask -TaskName "AgenteCRM iLux"`.
- Para remover: `.\uninstall-scheduled-task.ps1` (também como Administrador).

## Notas de segurança

- O client só faz conexão de saída para a VPS
- O token enviado em `CRM_SYNC_TOKEN` precisa ser igual ao configurado no CRM
- A senha usada pelo Agendador de Tarefas fica protegida pelo próprio Windows, não em
  texto puro — mais seguro que configurar login automático do Windows para esse fim
- Os arquivos antigos de log ficam em `logs/client.log.1`, `logs/client.log.2` e assim por diante, até o limite configurado

## Dados usados no CRM 360

- `IRECEITAS`: títulos, vencimentos, pagamentos e valores em aberto
- `IXLEQUIPAMENTOMED`: contador atual, anterior e datas de leitura
- `IXLOS`: última manutenção e menções técnicas de peças/suprimentos
