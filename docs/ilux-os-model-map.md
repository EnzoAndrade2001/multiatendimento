# Mapa de modelos de O.S. do iLux

Consulta realizada em `IXLOSTP` do banco Firebird do iLux, em modo somente
leitura. O código `CDOSTP` é o tipo escolhido na abertura da O.S.; o campo
`FORMULARIO` é o modelo de impressão que o desktop utiliza para esse tipo.

| CDOSTP | Tipo de O.S. | FORMULARIO | Arquivo de relatório | Relatório interno |
| --- | --- | --- | --- | --- |
| `01` | ATENDIMENTO CONTRATOS | `MODELO-001` | `IPR_OS_M064.rel` | `Rel_Modelo001` |
| `02` | ATENDIMENTO AVULSO | `MODELO-011` | `IPR_OS_M064.rel` | `Rel_Modelo011` |
| `03` | INSTALAÇÃO EQUIPAMENTO | `MODELO-051` | `IPR_OS_M064.rel` | `Rel_Modelo051` |
| `04` | RETIRADA EQUIPAMENTO | `MODELO-047` | `IPR_OS_M064.rel` | `Rel_Modelo047` |
| `05` | INSTALAÇÃO DE SOFTWARE | `MODELO-047` | `IPR_OS_M064.rel` | `Rel_Modelo047` |
| `WEB` | CHAMADO WEB | `MODELO-047` | `IPR_OS_M064.rel` | `Rel_Modelo047` |

## Como o vínculo funciona

- O agente lê `CDOSTP`, `NMOSTP` e `FORMULARIO` diretamente de `IXLOSTP`.
- O CRM sincroniza esses dados e apresenta o formulário junto ao tipo no
  seletor de abertura de O.S.
- Ao gravar a O.S., o CRM continua enviando somente o `CDOSTP` ao agente. O
  iLux resolve o `FORMULARIO` no próprio banco, exatamente como no desktop.
- `IPR_OS_M064.rel` é um bundle Rave que contém os relatórios internos
  `Rel_Modelo001` até `Rel_Modelo062`, incluindo os quatro modelos usados pela
  configuração atual.

Assim, a seleção do tipo no web e no iLux fica alinhada sem duplicar o cadastro
de modelos no CRM. A renderização visual idêntica no navegador é uma etapa
separada: o arquivo `.rel` é um relatório binário do Rave e não pode ser
executado diretamente pelo Node.js; ele precisa ser portado para o template
web ou convertido pelo agente/desktop.
