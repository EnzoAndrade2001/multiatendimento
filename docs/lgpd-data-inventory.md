# Inventário de dados pessoais e mapa de transferências — LGPD

**Data da revisão:** 24/08/2026
**Escopo:** schema Prisma, backend Node.js, frontend e agente local iLux/Firebird.
**Natureza:** auditoria estática do repositório. Não comprova volume real, localização física da infraestrutura, contratos com fornecedores, bases legais ou prazos efetivamente praticados.

## 1. Resultado executivo

O sistema trata dados pessoais em cinco fluxos principais: autenticação de usuários, atendimento por WhatsApp, CRM/iLux, ordens de serviço e cobrança. Há segregação por `tenantId`, senha armazenada como hash e opt-in específico para cobrança por WhatsApp. Entretanto, o repositório não contém uma política completa de retenção, exclusão/anomização ou transferência internacional.

Os maiores candidatos a excesso são:

1. duplicação de cadastro entre `Contact`, `CrmCustomer`, `CrmEquipment` e JSONs integrais em `raw`/`ExternalSyncRecord.payload`;
2. conservação indefinida de mensagens, transcrições, mídias e arquivos financeiros;
3. envio de conversas e mídias ao Gemini sem uma camada de minimização/redação identificada;
4. logs de conhecimento, eventos, erros e cobrança com texto livre ou identificadores;
5. coleta de leads de fonte pública antes de haver relacionamento com o titular;
6. campos reservados para sessão/token Meta, embora o conector Meta não esteja ativo no runtime auditado.

“Candidato a excesso” não significa tratamento ilegal. Significa que finalidade, necessidade e prazo precisam ser demonstrados pelo controlador.

## 2. Legenda

| Código | Categoria |
|---|---|
| ID | Identificador direto: nome, telefone, e-mail, CPF/CNPJ de empresário individual |
| LOC | Endereço/localização |
| COM | Comunicação e conteúdo livre |
| TEC | Identificador técnico: JID, ID externo, IP/log, token de sessão |
| FIN | Dado financeiro/fiscal e documento de cobrança |
| TRAB | Dado profissional de usuário, atendente ou técnico |
| INF | Inferência/avaliação: nota, auditoria, prioridade, perfil |
| SEG | Credencial ou segredo; não é necessariamente dado pessoal, mas exige proteção reforçada |

## 3. Inventário verificável por fonte e consumidor

### 3.1 Identidade, acesso e configuração

| Armazenamento/campos | Categorias | Fonte | Consumidores/finalidade observada | Candidato a excesso / decisão |
|---|---|---|---|---|
| `User`: `name`, `email`, `phone`, `firebirdSupportName`, `role`, `accessProfile`, `permissions`, `homePage`, `active` | ID, TRAB, INF | administrador/usuário | autenticação, autorização, atribuição de tickets e O.S. | definir retenção após desligamento e trilha de alterações de permissão |
| `User.password` | SEG | usuário/admin | autenticação; armazenada como hash | manter política de senha e confirmar algoritmo/custo em operação |
| `Team`, `TeamMember` | TRAB | administrador | roteamento e acesso por equipe | reter somente enquanto necessário para operação/auditoria |
| `WaInstance`: nome, telefone, QR code, status | ID, TEC, SEG | Evolution/administrador | conexão WhatsApp e roteamento | QR code não deve permanecer além do pareamento necessário |
| `TenantSettings`: telefones de notificação/gestor e cadastro da empresa | ID, TRAB | administrador | alertas, cópia de O.S. e documentos | registrar proprietário/finalidade dos números e prazo após substituição |
| `TenantSettings`: chaves Evolution, Gemini, SerpAPI e Firebird | SEG | administrador/ambiente | integração com terceiros e agente | confirmar criptografia em repouso, mascaramento e rotação; nunca registrar valor integral |
| `MetaInstance.accessToken`, `metaBrowserSession` | SEG, TEC | não confirmada | estrutura futura; runtime ativo não confirmado | **alto candidato a remoção/desativação até existir finalidade e controles** |

**Evidências:** `backend/prisma/schema.prisma`, `backend/src/auth/settingsAccess.js`, `backend/src/controllers/authController.js`, `backend/src/controllers/userController.js`.

### 3.2 Cadastro, CRM, equipamentos e ordens de serviço

| Armazenamento/campos | Categorias | Fonte | Consumidores/finalidade observada | Candidato a excesso / decisão |
|---|---|---|---|---|
| `Contact`: telefone, WhatsApp/JID, nome, avatar, CPF/CNPJ, e-mail, endereço, cidade/UF/CEP, notas e tags | ID, LOC, COM, TEC | WhatsApp, usuário e sincronização iLux | inbox, identificação, CRM 360, O.S., cobrança | há duplicação com `CrmCustomer`; notas/tags livres precisam de orientação de conteúdo |
| `Contact.enableWhatsAppBilling` | INF | usuário, após relacionamento | autorizar automação de cobrança | hoje é booleano; falta evidência completa de consentimento/autorização: data, origem, texto, usuário e revogação |
| `CrmCustomer`: nome/fantasia, CPF/CNPJ, e-mail, telefone, endereço, contato, notas | ID, LOC, COM | Firebird/iLux | CRM 360, contratos, financeiro e O.S. | revisar necessidade de todos os campos em cada tela/perfil |
| `CrmCustomer.raw` | ID, LOC, COM, potencialmente outros | Firebird/iLux | fallback/compatibilidade de integração | **alto candidato a excesso:** JSON pode conservar colunas além das normalizadas |
| `Equipment` e `CrmEquipment`: modelo, fabricante, série, patrimônio, setor, local de instalação, endereço, telefone e contrato | TEC, LOC, ID | Firebird/iLux ou usuário | seleção de equipamento, contrato e O.S. | endereço/telefone duplicados; limitar a campos necessários para localizar o ativo |
| `CrmEquipment.raw` | ID, LOC, TEC, potencialmente outros | Firebird/iLux | fallback/compatibilidade | **alto candidato a excesso:** inventariar chaves reais e permitir lista de campos |
| `ServiceOrder`: técnico, defeito, notas técnicas, medidores, atendente/fechador, erros de envio | COM, TRAB, INF | conversa, usuário e Firebird | abertura, impressão, histórico, cópia ao gestor | defeito/notas podem conter dados sensíveis inseridos livremente; limitar contexto/histórico e prazo |
| `ExternalSyncRecord.payload` | variável: ID, LOC, FIN, COM, TEC | agente Firebird | cache de clientes, contratos, O.S., financeiro, comandos e documentos | **principal candidato a excesso:** JSON genérico replica payload integral e não tem prazo por entidade |

**Evidências:** `backend/prisma/schema.prisma`, `backend/src/controllers/crmController.js`, `backend/src/controllers/firebirdSyncController.js`, `backend/src/controllers/osController.js`, `firebird-client/main.py`.

### 3.3 Atendimento, mensagens e IA

| Armazenamento/campos | Categorias | Fonte | Consumidores/finalidade observada | Candidato a excesso / decisão |
|---|---|---|---|---|
| `Ticket`: assunto, agente/equipe, prioridade, SLA, avaliação, feedback e resultado de auditoria | COM, TRAB, INF | cliente, usuário e rotinas de IA | atendimento, gestão e qualidade | auditoria/feedback podem conter inferências sobre pessoas; restringir perfil e prazo |
| `TicketEvent.payload` | COM, TRAB, TEC | ações do usuário/sistema | trilha de mudanças | texto/JSON livre pode duplicar nomes e conteúdo; definir esquema mínimo por tipo |
| `Message`: corpo, transcrição, mídia/URL, nome do arquivo, citado, IDs externos, autor | COM, ID, TEC | WhatsApp, usuário e Gemini | histórico do atendimento, busca, IA e envio | alto volume e conteúdo imprevisível; soft delete conserva o registro |
| arquivos em `uploads/media` | COM, ID, FIN, potencialmente sensível | WhatsApp, agente e usuários | visualização, reenvio, transcrição e impressão | a rota `/uploads` é estática e não foi encontrada limpeza ativa; definir ACL/URL assinada e retenção |
| `ScheduledMessage.body` | COM | usuário | envio futuro | excluir ou anonimizar após envio + prazo de auditoria definido |
| `InternalMessage.body` | COM, TRAB | usuários | comunicação interna | orientar contra dados sensíveis desnecessários e definir prazo |
| `Knowledge`: pergunta/resposta/tags/embedding | COM | administrador/usuário e Gemini | respostas automáticas e busca semântica | base deve ser genérica; impedir inclusão de dados de clientes |
| `KnowledgeLog`: consulta, conteúdo retornado, similaridade | COM, INF | conversa/busca | diagnóstico de busca | **candidato a excesso:** query pode copiar mensagem pessoal; preferir métricas pseudonimizadas |
| prompts enviados ao Gemini | COM, ID, LOC, potencialmente sensível | histórico, notas, equipamentos e mídia | chat, resumo, tags, transcrição, imagem, memória, rascunho de O.S. | aplicar minimização/redação e definir quando IA pode receber mídia/conversa |

**Evidências:** `backend/prisma/schema.prisma`, `backend/src/services/geminiService.js`, `backend/src/controllers/ticketController.js`, `backend/src/controllers/webhookController.js`, `backend/src/controllers/knowledgeController.js`, `backend/src/app.js`, `backend/src/utils/uploads.js`.

O código do Gemini confirma envio de histórico de mensagens, mensagem atual, áudio em base64, imagem em base64, notas atuais e lista de equipamentos, conforme a função chamada.

### 3.4 Financeiro e documentos

| Armazenamento/campos | Categorias | Fonte | Consumidores/finalidade observada | Candidato a excesso / decisão |
|---|---|---|---|---|
| recebíveis e contratos dentro de `ExternalSyncRecord.payload` | FIN, ID | Firebird/iLux | CRM financeiro, cobertura e geração/recuperação documental | separar campos mínimos de visualização dos payloads integrais |
| `BillingLog`: CPF/CNPJ, cliente, arquivo, status, erro e data | FIN, ID, TEC | automação de cobrança/backend | deduplicação, auditoria, relatório de cobertura | definir prazo contábil/operacional; erros não devem incluir corpo/segredo desnecessário |
| PDFs: nota, demonstrativo e boleto em uploads | FIN, ID, LOC | agente/iLux | visualizar, baixar e reenviar por WhatsApp | alto impacto; acesso autenticado, prazo e eliminação precisam ser definidos |
| índice local `financial-documents-index.json` | FIN, ID, TEC | varredura de pastas pelo agente | vincular documento ao título/cliente | revisar campos do índice e expurgo quando o arquivo de origem sair do escopo |
| ledger local `billing-auto-send-ledger.json` | FIN, ID, TEC | agente | impedir duplicidade de envio | preservar chave/hash e status, evitando cópia de conteúdo/arquivo |
| logs locais rotativos do agente | ID, FIN, TEC, COM | agente/Firebird/backend | suporte e diagnóstico | já há rotação por tamanho/quantidade; validar conteúdo, acesso e prazo efetivo |

**Evidências:** `backend/prisma/schema.prisma`, `backend/src/controllers/billingController.js`, `backend/src/services/billingDocumentService.js`, `firebird-client/main.py`, `firebird-client/financial_document_index.py`.

### 3.5 Prospecção

| Armazenamento/campos | Categorias | Fonte | Consumidores/finalidade observada | Candidato a excesso / decisão |
|---|---|---|---|---|
| `Lead`: nome, telefone, endereço, cidade/UF, site, categoria, consulta, Place ID, rating e histórico de envio | ID, LOC, TEC, INF | SerpAPI/Google Maps ou importação manual | prospecção e envio WhatsApp | pode incluir profissional autônomo/pessoa natural; definir base legal, transparência, oposição e prazo para não convertidos |

**Evidências:** `backend/prisma/schema.prisma`, `backend/src/controllers/leadController.js`, `backend/src/services/scraperService.js`.

## 4. Mapa de serviços externos e transferências

Não foi encontrada no repositório comprovação contratual de país/região de armazenamento ou processamento para nenhum fornecedor remoto. Por isso, nenhum país foi presumido.

| Serviço/interface | Finalidade | Dados enviados | Dados recebidos | País/região confirmado | Classificação de transferência |
|---|---|---|---|---|---|
| Evolution API (endpoint configurável por tenant) | conectar e operar WhatsApp | telefone/JID, texto, mídia/base64 ou arquivo, nome/MIME, legenda, IDs de citação, nome da instância | mensagens, contato/nome/avatar, IDs externos, mídia/metadados, estado da conexão | **desconhecido** | potencial, pois URL e hospedagem são configuráveis |
| WhatsApp/Meta, indiretamente via Evolution | entrega e recebimento de mensagens | conteúdo do atendimento e metadados necessários à entrega | mensagens, comprovantes/IDs e perfil | **desconhecido** | potencial; cadeia contratual/suboperadores precisa ser confirmada |
| Google Gemini (`@google/generative-ai`) | chat, resumo, tags, transcrição, análise de imagem, embeddings, memória e rascunho de O.S. | prompts, histórico, notas, equipamentos, áudio/imagem em base64 | texto, JSON, transcrição, embedding e inferências | **desconhecido** | potencial; região e termos da conta/chave não constam no repositório |
| SerpAPI/Google Maps search | localizar leads | consulta de busca/localidade e chave da API | nome, telefone, endereço, site, categoria, rating e Place ID | **desconhecido** | potencial |
| Google Maps aberto no navegador | mostrar endereço no mapa | endereço inserido na URL de busca pelo navegador do usuário | página/mapa | **desconhecido** | potencial; ocorre do navegador do usuário |
| CRM/backend + PostgreSQL em EasyPanel | hospedar aplicação e banco | todo o conjunto operacional sincronizado/processado | dados persistidos e respostas da aplicação | provedor e país **desconhecidos** | potencial; confirmar host, datacenter, backups e suboperadores |
| agente iLux/Firebird → CRM | sincronizar cadastro, equipamentos, contratos, O.S., recebíveis e documentos | payloads cadastrais/financeiros, PDFs, comandos e estado do agente | comandos, confirmações e configuração operacional | origem local conhecida; destino do CRM **desconhecido** | fluxo entre ambientes; transferência internacional depende do host do CRM |
| GitHub Raw (fallback de download do agente) | distribuir executável do agente | requisição técnica/IP; nenhum payload de cliente por desenho | executável | **desconhecido** | potencial apenas para metadados de acesso; não é fluxo de dados de negócio identificado |

### Serviços não confirmados como ativos

- `MetaInstance` e `metaBrowserSession` existem no schema, mas a documentação e os controllers auditados não confirmam um conector Facebook/Instagram ativo. Não devem ser tratados como transferência ativa sem evidência operacional.
- Socket.IO é componente interno do próprio backend, não um fornecedor externo identificado.

## 5. Fluxos de alto nível

```text
Cliente WhatsApp
  ↕ WhatsApp/Meta ↔ Evolution API
  ↕
Backend CRM ↔ PostgreSQL / uploads
  ↕                 ↘ Google Gemini (quando função de IA é usada)
Agente local ↔ Firebird/iLux
  ↘ pastas financeiras, índice e ledger locais

Usuário do CRM → Google Maps (abertura de endereço no navegador)
CRM → SerpAPI/Google Maps search (prospecção)
```

## 6. Retenção e exclusão observadas

| Achado | Evidência | Impacto/decisão |
|---|---|---|
| limpeza noturna de mídia está desativada para “manter histórico completo” | `backend/src/services/scheduleProcessor.js` | definir prazo por tipo de mídia e fundamento; histórico completo indefinido aumenta risco |
| exclusão de mensagem é soft delete (`isDeleted`) e substitui o corpo visível | `backend/src/controllers/ticketController.js`, `backend/src/controllers/webhookController.js` | decidir se conteúdo original continua em banco/backups e como atender eliminação do titular |
| há hard delete para contatos, leads, usuários e cadastros pontuais | respectivos controllers | validar cascatas, registros de auditoria, arquivos, JSON raw, backups e fornecedores externos |
| não foi encontrada política por entidade para `ExternalSyncRecord`, `BillingLog`, `KnowledgeLog` ou uploads | busca estática no backend | criar matriz de retenção e job verificável por tenant/tipo |
| agente usa log rotativo, mas índices/ledgers não apresentam expurgo de negócio evidente | `firebird-client/main.py` | preservar deduplicação mínima e remover metadados sem utilidade após prazo |

## 7. Consultas de verificação sem expor conteúdo

Executar em ambiente autorizado. As consultas retornam apenas contagens/chaves, não valores pessoais.

```sql
-- Volume por área e tenant
SELECT "tenantId", COUNT(*) FROM "Contact" GROUP BY "tenantId";
SELECT "tenantId", COUNT(*) FROM "Message" GROUP BY "tenantId";
SELECT "tenantId", entity, COUNT(*)
FROM "ExternalSyncRecord"
GROUP BY "tenantId", entity
ORDER BY "tenantId", COUNT(*) DESC;

-- Idade máxima/mínima para evidenciar retenção real
SELECT "tenantId", MIN("createdAt"), MAX("createdAt"), COUNT(*)
FROM "Message" GROUP BY "tenantId";
SELECT "tenantId", MIN("sentAt"), MAX("sentAt"), COUNT(*)
FROM "BillingLog" GROUP BY "tenantId";
SELECT "tenantId", MIN("receivedAt"), MAX("receivedAt"), COUNT(*)
FROM "ExternalSyncRecord" GROUP BY "tenantId";

-- Chaves presentes em JSON raw/payload; revisar o resultado antes de autorizar cada chave
SELECT DISTINCT jsonb_object_keys(raw) AS chave
FROM "CrmCustomer" WHERE raw IS NOT NULL;
SELECT entity, jsonb_object_keys(payload) AS chave, COUNT(*)
FROM "ExternalSyncRecord"
WHERE jsonb_typeof(payload) = 'object'
GROUP BY entity, chave
ORDER BY entity, chave;

-- Opt-in sem evidência temporal própria (quantifica o gap atual)
SELECT "tenantId",
       COUNT(*) FILTER (WHERE "enableWhatsAppBilling" = true) AS opt_in_ativo,
       COUNT(*) AS contatos
FROM "Contact" GROUP BY "tenantId";
```

Verificações operacionais complementares:

- medir quantidade e idade de arquivos em `UPLOADS_PATH/media`, sem abrir os arquivos;
- inventariar chaves de `financial-documents-index.json` e `billing-auto-send-ledger.json`, sem copiar os valores para tickets/logs;
- obter do EasyPanel/host: provedor, país do datacenter, réplicas, backups, prazo e subprocessadores;
- obter de cada contrato/conta de Evolution, Gemini e SerpAPI: entidade contratada, região, retenção, uso para treinamento e subprocessadores.

## 8. Decisões necessárias

| Prioridade | Decisão | Dono sugerido | Evidência de conclusão |
|---|---|---|---|
| P0 | identificar controlador, operador e subprocessadores por tenant/contrato | jurídico + direção | ROPA/registro de operações aprovado |
| P0 | confirmar país/região de CRM, PostgreSQL, backups, Evolution, Gemini e SerpAPI | infraestrutura + jurídico | contratos/DPA e diagrama de regiões anexados |
| P0 | estabelecer matriz de retenção por entidade, mídia, log, documento e backup | jurídico + produto + infraestrutura | prazo/fundamento/job/teste de eliminação |
| P0 | proteger downloads de mídia/documentos com autorização e URLs não públicas | engenharia | teste automatizado entre tenants/perfis e expiração de URL |
| P1 | substituir JSON raw integral por lista de campos necessária ou expurgo curto | produto + integração | inventário real de chaves e allowlist aprovada |
| P1 | criar evidência de opt-in/revogação para cobrança (data, origem, texto, usuário) | produto + jurídico | trilha consultável e teste de revogação |
| P1 | definir regra de minimização antes do Gemini e restrições para dados sensíveis | produto + jurídico + engenharia | política por função de IA e testes de redação |
| P1 | definir processo de direitos do titular, incluindo Firebird, arquivos, backups e fornecedores | DPO/jurídico + suporte | runbook testado com protocolo e prazo |
| P1 | definir base legal, transparência e oposição para leads não convertidos | comercial + jurídico | aviso, origem registrada, opt-out e expurgo |
| P2 | minimizar `KnowledgeLog`, `TicketEvent.payload`, erros e logs locais | engenharia + suporte | schema de eventos, redaction e amostra auditada |
| P2 | decidir remoção/desativação de `MetaInstance` até o conector existir | arquitetura + segurança | ADR e migração futura controlada, se aprovada |
| P2 | classificar dados sensíveis incidentais em conversas/O.S. e treinar usuários | DPO + operações | política e treinamento registrados |
| P2 | definir resposta a incidente e cadeia de notificação | segurança + direção | playbook e exercício de mesa |

## 9. Limites desta auditoria

- Não houve acesso ao banco PostgreSQL de produção, arquivos de clientes, contas de fornecedores ou contratos.
- Nenhum valor pessoal foi coletado ou reproduzido neste documento.
- País, região e mecanismos de transferência foram marcados como desconhecidos sempre que não havia comprovação no repositório.
- Este inventário é técnico e não substitui parecer jurídico, RIPD/DPIA ou registro formal das operações de tratamento.
