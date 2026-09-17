# Plano de migração — CRM LCD integrado ao ILUX_WEB

## Objetivo

Criar uma cópia completa do Sistema Multiatendimento em uma nova VPS exclusiva da LCD Digital e reservar a VPS atual para a operação Softilux/ILUX Flow.

Na instalação da LCD, o CRM não utilizará o agente Firebird. Os dados operacionais serão obtidos diretamente do PostgreSQL do projeto `D:\Projetos\ILUX_WEB`, hospedado na mesma VPS e em rede Docker privada.

## Arquitetura aprovada

```text
Firebird/iLux Desktop
        ↓ sincronização do ILUX_WEB
PostgreSQL do ILUX_WEB
        ↓ leitura direta por usuário restrito/views
CRM exclusivo da LCD Digital
```

O CRM continuará com banco próprio para conversas, tickets, usuários, equipes, tarefas, campanhas, configurações, IA e auditoria.

## Decisões técnicas

- Manter bancos separados para `ILUX_WEB` e CRM.
- Colocar os backends na mesma rede Docker privada.
- Não publicar a porta PostgreSQL na internet.
- Criar usuário PostgreSQL exclusivo e restrito para o CRM.
- Preferir views estáveis para leitura dos dados do `ILUX_WEB`.
- Usar API interna ou função SQL controlada para gravações com regras de negócio, especialmente abertura/alteração de O.S.
- Buscar documentos, boletos e NFS-e pelo mecanismo controlado do `ILUX_WEB`.
- Desativar completamente o agente Firebird na instalação da LCD.
- Manter o agente somente no ambiente Softilux.

## Dados que o CRM LCD deverá consumir

- Clientes.
- Contratos.
- Equipamentos e medidores.
- Ordens de serviço.
- Contas a receber.
- Contas a pagar.
- Faturas.
- Boletos, demonstrativos e notas fiscais.

## Views sugeridas

```text
crm_clientes
crm_contratos
crm_equipamentos
crm_medidores
crm_ordens_servico
crm_contas_receber
crm_contas_pagar
crm_faturas
crm_documentos
```

## Regras importantes

- Dados financeiros e operacionais têm o `ILUX_WEB` como fonte oficial.
- Conversas, atendimento, tarefas e campanhas têm o CRM como fonte oficial.
- Toda sincronização deve ser idempotente e utilizar identificadores externos estáveis.
- Uma O.S. criada pelo CRM deve receber e armazenar o identificador definitivo retornado pelo `ILUX_WEB`.
- Evitar ciclos de sincronização e eventos duplicados entre os sistemas.
- Credenciais, domínios, WhatsApp, webhooks, bancos, uploads e backups dos ambientes LCD e Softilux devem permanecer totalmente isolados.

## Checklist para o fim de semana

1. Inventariar serviços, bancos, volumes, uploads, domínios e variáveis da VPS atual.
2. Criar e preparar a nova VPS LCD.
3. Copiar o CRM, banco e volumes que pertencem à LCD.
4. Subir inicialmente com campanhas, cobranças, webhooks e agendadores desativados.
5. Colocar CRM e `ILUX_WEB` na mesma rede privada.
6. Criar usuário de banco restrito e as views de integração.
7. Implementar o conector PostgreSQL no CRM LCD.
8. Adaptar leitura de clientes, contratos, equipamentos, financeiro, medidores e O.S.
9. Definir o fluxo controlado de criação/alteração de O.S.
10. Adaptar a obtenção de documentos financeiros.
11. Remover da interface LCD as configurações, status e download do agente.
12. Validar contagens e amostras entre `ILUX_WEB` e CRM.
13. Testar criação de O.S., documentos e cobrança em modo seguro.
14. Ativar integrações e automações individualmente.
15. Confirmar backups e plano de restauração dos dois ambientes.

## Fora de escopo nesta etapa

- Alterar o agente utilizado pela Softilux.
- Compartilhar bancos ou dados entre LCD e Softilux.
- Expor PostgreSQL publicamente.
- Transformar o CRM LCD em produto multiempresa.

