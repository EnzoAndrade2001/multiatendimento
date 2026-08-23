# Proposta de parceria — iLux / Diego Cabral

## Visão

Esta proposta apresenta uma camada conversacional e operacional integrada ao iLux para aproximar o ERP do atendimento realizado pelo WhatsApp.

O iLux permanece como fonte oficial dos cadastros e processos administrativos. A solução complementar organiza o atendimento, consulta o contexto do cliente e executa fluxos autorizados no iLux por meio do Agente Local.

**Responsável pela proposta:** Diego Cabral  
**Ambiente demonstrado:** tenant LCD DIGITAL, em operação real e conectado ao iLux  
**Público da apresentação:** direção, produto e responsáveis técnicos do iLux

## Proposta de valor

- Transformar conversas de WhatsApp em atendimentos rastreáveis.
- Exibir dados comerciais, técnicos e financeiros do iLux durante a conversa.
- Abrir uma O.S. no iLux sem tirar o atendente do WhatsApp.
- Confirmar o número real da O.S. antes de informar sucesso ao usuário.
- Reutilizar os documentos oficiais já conhecidos pelos clientes.
- Automatizar cobranças com opt-in, proteção contra duplicidade e relatório de cobertura.
- Aplicar permissões por função, preservando dados financeiros e administrativos.
- Implantar em outras empresas sem expor o Firebird à internet.

## Princípio de integração

> A solução amplia o alcance do iLux; ela não substitui o iLux Desktop.

O Agente Local é instalado no ambiente da empresa e realiza somente conexões de saída por HTTPS. Ele consulta o Firebird local, sincroniza os dados autorizados e consome comandos pendentes. O banco Firebird não precisa aceitar conexões externas.

## Fluxos de maior valor

1. Cliente chama pelo WhatsApp.
2. Atendimento identifica ou vincula o cliente do iLux.
3. Visão 360 reúne cadastro, unidades, contatos, equipamentos, contratos, O.S. e financeiro.
4. Atendente seleciona o equipamento e solicita uma nova O.S.
5. Agente Local grava a O.S. no Firebird e devolve o número confirmado.
6. Sistema disponibiliza o documento da O.S. e comunica cliente e gestor.
7. Financeiro localiza Nota, Demonstrativo e Boleto oficiais e permite reenvio pelo WhatsApp.
8. Relatórios mostram cobertura, falhas e pendências sem reenviar para quem já recebeu.

## Escopo sugerido para o piloto

- Uma empresa participante.
- Uma base iLux e um Agente Local.
- Uma ou duas instâncias de WhatsApp.
- Entre três e dez usuários operacionais.
- Atendimento, CRM 360, abertura de O.S. e reenvio financeiro.
- Duração inicial de 30 dias, com revisão semanal dos indicadores.

## Frentes possíveis de parceria

As modalidades abaixo são alternativas para discussão, não compromissos já firmados:

- **Homologação técnica:** validação dos fluxos e mapeamentos pelo time iLux.
- **Piloto conjunto:** acompanhamento de uma empresa usuária em ambiente controlado.
- **Oferta complementar:** apresentação da solução a clientes com operação relevante no WhatsApp.
- **White-label ou integração oficial:** avaliação posterior, condicionada ao resultado do piloto.

## Decisões esperadas após a apresentação

- Indicar o responsável técnico e o responsável de negócio pelo lado iLux.
- Aprovar ou ajustar o escopo do piloto.
- Definir critérios de homologação dos fluxos de O.S. e documentos financeiros.
- Escolher uma empresa e uma janela para o piloto.
- Agendar revisão de resultados após os primeiros 30 dias.

## Documentos deste pacote

- [Roteiro da demonstração](./demo-script.md)
- [Matriz de capacidades](./capability-matrix.md)
- [Scorecard do piloto](./pilot-scorecard.md)
- [Runbook da apresentação](./presentation-runbook.md)

