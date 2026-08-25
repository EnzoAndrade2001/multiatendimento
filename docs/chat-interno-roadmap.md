# Chat interno — implementação e roadmap

**Revisão:** 24/08/2026  
**Escopo:** shell global, notificações e chat interno. O fluxo de atendimento WhatsApp não foi alterado.

## Estado dos oito itens

| # | Melhoria | Estado | Entrega verificável |
|---|---|---|---|
| 1 | Centro “Minhas conversas” | Implementado | Lista unificada de conversas diretas e de equipe, busca, últimas mensagens e início de nova conversa. Backend limita o acesso às equipes das quais o usuário participa ou que pode administrar. |
| 2 | Não lidas e contador global | Implementado | `InternalConversationState` persiste leitura e quantidade por usuário/conversa. O Layout exibe badge global no botão **Equipe** e no título da aba do navegador. Abrir a conversa marca como lida. |
| 3 | Menções | Implementado | Menções de usuários/equipes são validadas no tenant, persistidas na mensagem, notificadas em room individual e expostas no filtro **Menções**. `@todos`, `@equipe` e `@all` funcionam em conversa de equipe. |
| 4 | Conversas fixadas | Implementado | Fixação persistente por usuário, filtro **Fixadas** e ordenação das fixadas no topo. |
| 5 | Socket.IO sem duplicação | Implementado | O Layout mantém a conexão global compartilhada com o Drawer. IDs de mensagem e menção possuem deduplicação limitada a 500 eventos. A entrega privada usa rooms `user:*`; o antigo broadcast arbitrário `send_internal` foi removido. |
| 6 | Presença e atendimento simultâneo | Implementado com limite conhecido | O shell divulga usuários online e o Drawer mostra “Online agora”. Em conversas diretas, o evento `internal_viewing` informa quando o outro usuário também está visualizando a mesma conversa. |
| 7 | Produtividade no chat | Implementado | Conversas diretas/equipes, mensagem/nota interna, respostas e threads, reações, busca, Enter para enviar e Shift+Enter para quebra de linha. Há fallback compatível para backend antigo em conversa direta. |
| 8 | Acessibilidade e responsividade | Implementado e revisado estaticamente | Drawer limitado à viewport (`min(440px, 100vw)`), safe-area no compositor, scroll interno, textos longos com quebra, botões com `type`/`aria-label`, dialog modal, filtros como tabs, foco inicial e Escape em camadas. |

## Fluxo de eventos

```text
HTTP autenticado cria/atualiza mensagem
        ↓
backend valida tenant, destinatário/equipe e menções
        ↓
Socket.IO publica nas rooms user:<id>
        ↓
Layout (socket único)
  ├─ atualiza badge e título da aba
  ├─ deduplica mensagem/menção
  ├─ apresenta toast/notificação do sistema
  └─ entrega o mesmo evento ao InternalChatDrawer
```

Ao clicar no toast ou na notificação do sistema, o Drawer abre diretamente na conversa correspondente. Sons e notificações visuais são suprimidos quando o chat interno já está aberto, reduzindo interrupção e duplicidade.

## Segurança e isolamento preservados

- Todas as rotas do chat exigem `internal_chat.view`.
- Conversas diretas são validadas por `tenantId` e participação dos dois usuários.
- Conversas de equipe exigem associação à equipe, salvo permissão administrativa explícita.
- Menções são validadas contra usuários/equipes do mesmo tenant.
- Eventos privados são publicados para rooms individuais calculadas a partir dos destinatários atuais.
- Nenhuma rota, evento ou estado do WhatsApp foi modificado por esta entrega.

## Pendências recomendadas

1. **Presença distribuída:** o registro online/visualizando está em memória do processo Node. Para mais de uma réplica do backend, usar adapter Socket.IO/Redis e presença compartilhada.
2. **Notificação offline:** hoje há toast e Web Notification enquanto a aplicação está aberta. Push offline exigiria service worker, assinatura e política de consentimento.
3. **Paginação visual:** o backend aceita cursor e limite, mas a interface ainda deve oferecer “Carregar anteriores” para históricos extensos.
4. **Preferências de notificação:** permitir silenciar conversa, equipe ou horário, separando som, toast e notificação do sistema.
5. **Acessibilidade manual:** executar teste com NVDA/VoiceOver, zoom 200%, contraste e navegação exclusivamente por teclado. A revisão atual foi estática/build.
6. **Observabilidade:** medir conexão/reconexão, latência de entrega, eventos descartados por deduplicação e falhas de marcação de leitura sem registrar conteúdo da mensagem.
7. **Retenção:** definir prazo para mensagens, notas e eventos de leitura/reação conforme a política LGPD.
8. **Teste em dois usuários reais:** validar presença, visualização simultânea, menção, leitura e deep-link em navegadores/estações diferentes antes do deploy.

## Validação executada

- `npm run build` em `frontend`: concluído sem erro.
- Rotas antigas `GET/POST /api/internal-messages` permanecem disponíveis como compatibilidade.
- O Drawer usa as rotas v2 e possui fallback direto para o envio legado quando o backend ainda não foi atualizado.
- Não foi realizado commit, push ou deploy nesta frente.

