# ADR-0003: Múltiplos bancos Firebird vinculados às instâncias WhatsApp

- Status: Decisão aprovada para implementação futura
- Data: 2026-09-03

## Contexto

Uma mesma empresa pode operar mais de uma base Firebird, por exemplo uma base
por filial, contrato ou operação. Ela também pode possuir mais de um número de
WhatsApp no CRM. A sincronização precisa manter essas origens isoladas para
evitar colisões de códigos como `CDCLIENTE`, `CDEQUIPAMENTO` e `SEQOS`.

Além disso, clientes com muitos equipamentos precisam de uma seleção filtrada
no atendimento, em vez de receber uma lista enorme de máquinas no WhatsApp.

## Decisão

Adotar um único agente local por computador, capaz de gerenciar vários perfis
de conexão Firebird. Cada perfil será vinculado a uma instância/número de
WhatsApp:

```text
Banco Firebird A -> Perfil A -> Instância WhatsApp A
Banco Firebird B -> Perfil B -> Instância WhatsApp B
```

O agente deverá manter, por perfil:

- host, porta, caminho, usuário e senha do Firebird;
- instância WhatsApp associada;
- token/identificador seguro da conexão;
- cursor e estado de sincronização próprios;
- teste de conexão e status de saúde individual.

No backend, os dados sincronizados deverão carregar a origem da conexão. As
chaves de sincronização devem considerar tenant, conexão, entidade e
identificador externo, impedindo que dois bancos com o mesmo código sobrescrevam
um ao outro. Comandos de criação/atualização de O.S. também deverão retornar ao
agente correto.

Mensagens recebidas serão resolvidas pela instância WhatsApp do ticket. O bot
consultará somente clientes e equipamentos pertencentes à conexão vinculada
àquela instância.

## Equipamentos em grande quantidade

O bot não deverá listar centenas de máquinas individualmente. Para clientes com
muitos equipamentos, o fluxo futuro deverá:

1. agrupar modelos e informar quantidades;
2. solicitar setor, localização, patrimônio ou número de série;
3. pesquisar e apresentar somente os candidatos compatíveis;
4. confirmar a seleção e persistir o `equipmentId` na O.S.

O modelo sozinho não é suficiente para selecionar uma máquina quando existem
várias unidades iguais.

## Consequências

Positivas:

- isolamento entre bancos e números de WhatsApp;
- um único executável para administrar todas as conexões do computador;
- falha de uma base não interrompe as demais;
- atendimento mais claro para clientes com muitos equipamentos;
- suporte a um painel consolidado por empresa.

Negativas:

- exige evolução do modelo de dados, API de sincronização e interface do agente;
- requer migração cuidadosa das chaves e dos registros já sincronizados;
- adiciona configuração e monitoramento por conexão.

## Situação atual

O agente atual ainda aceita uma base por execução e o backend associa os dados
sincronizados ao tenant. Não executar múltiplos bancos no mesmo tenant até que
esta ADR seja implementada; como alternativa temporária, usar tenants separados
por banco/instância.
