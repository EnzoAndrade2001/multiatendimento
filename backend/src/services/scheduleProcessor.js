const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');
const whatsappComplianceService = require('./whatsappComplianceService');
const billingDocuments = require('./billingDocumentService');

async function processScheduledMessages() {
  const now = new Date();
  
  try {
    const messages = await prisma.scheduledMessage.findMany({
      where: {
        processed: false,
        sendAt: { lte: now }
      },
      include: {
        tenant: { include: { settings: true, instances: true } },
        contact: true
      }
    });

    if (messages.length === 0) return;

    console.log(`[schedule] processando ${messages.length} mensagens agendadas...`);

    for (const msg of messages) {
      try {
        const settings = msg.tenant.settings;
        const instance = msg.tenant.instances[0]; // Pega a primeira instância ativa

        if (settings && instance && settings.evolutionUrl && settings.evolutionKey) {
          const gate = await whatsappComplianceService.canAutomatedSend({
            tenantId: msg.tenant.id,
            contactId: msg.contactId,
            instance,
          });
          if (!gate.allowed) {
            console.warn(`[schedule] mensagem ${msg.id} não enviada (${gate.code}).`);
            await prisma.scheduledMessage.update({ where: { id: msg.id }, data: { processed: true } });
            continue;
          }
          await evolutionService.sendText(
            settings.evolutionUrl,
            settings.evolutionKey,
            instance.instanceName,
            msg.contact.phone,
            msg.body
          );

          // Cria a mensagem no histórico do ticket
          const ticket = await prisma.ticket.findFirst({
            where: { contactId: msg.contactId, status: { in: ['pending', 'open', 'bot'] } }
          });

          if (ticket) {
            await prisma.message.create({
              data: {
                ticketId: ticket.id,
                body: msg.body,
                fromMe: true,
                fromBot: false
              }
            });
          }

          await prisma.scheduledMessage.update({
            where: { id: msg.id },
            data: { processed: true }
          });
        }
      } catch (err) {
        console.error(`[schedule] erro ao processar mensagem ${msg.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[schedule] erro geral:', err.message);
  }
}

// Limpeza de Mídias (Fotos, Vídeos, Áudios) - DESATIVADA por solicitação do usuário
async function nightlyCleanup() {
  console.log('[cleanup] Limpeza noturna (03:00): A exclusão automática de mídias foi desativada para manter o histórico completo.');
}

// Retry de mídias que falharam ou ainda estão pendentes
async function retryPendingMedia() {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // 1. Marca como 'failed' mensagens com mídia pendente há mais de 15 min (token expirado)
    const mediaPendingWhere = {
      mediaType: { not: 'text' },
      NOT: { mediaType: null },
      mediaUrl: null,
      mediaStatus: 'pending'
    };

    const expired = await prisma.message.updateMany({
      where: {
        ...mediaPendingWhere,
        createdAt: { lt: fifteenMinutesAgo }
      },
      data: { mediaStatus: 'failed' }
    });
    if (expired.count > 0) {
      console.log(`[media-retry] ${expired.count} mídias marcadas como falha definitiva (token expirado).`);
    }

    // 2. Tenta rebaixar mídias recentes (menos de 15 min) ainda pendentes
    const pending = await prisma.message.findMany({
      where: {
        ...mediaPendingWhere,
        createdAt: { gte: fifteenMinutesAgo }
      },
      include: {
        ticket: {
          include: {
            instance: true,
            tenant: { include: { settings: true } }
          }
        }
      },
      take: 20
    });

    if (pending.length === 0) return;
    console.log(`[media-retry] Tentando rebaixar ${pending.length} mídias pendentes...`);

    for (const msg of pending) {
      try {
        const settings = msg.ticket.tenant.settings;
        const instance = msg.ticket.instance;
        if (!settings?.evolutionUrl || !settings?.evolutionKey || !instance) continue;

        const result = await evolutionService.getMediaBase64(
          settings.evolutionUrl,
          settings.evolutionKey,
          instance.instanceName,
          { id: msg.externalId }
        );

        const base64 = result?.base64 || result?.data?.base64;
        const mimetype = result?.mimetype || result?.data?.mimetype || result?.data?.data?.mimetype;

        if (base64) {
          const mediaUrl = await evolutionService.saveMediaFile(base64, mimetype, msg.id);
          await prisma.message.update({
            where: { id: msg.id },
            data: { mediaUrl, mediaStatus: 'ok' }
          });
          console.log(`[media-retry] ✅ Mídia recuperada para msg ${msg.id}`);
        }
      } catch (err) {
        console.warn(`[media-retry] Falha ao rebaixar msg ${msg.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[media-retry] Erro geral:', err.message);
  }
}

// Roda o processador de mensagens a cada 1 minuto e a limpeza às 03:00
function start() {
  // Processador de Agendamentos
  setInterval(processScheduledMessages, 60000);
  console.log('[schedule] processador de mensagens iniciado (1 min)');

  // Retry de mídias pendentes a cada 5 minutos
  setInterval(retryPendingMedia, 5 * 60 * 1000);
  // Roda imediatamente na inicialização para pegar mídias que falharam antes do restart
  setTimeout(retryPendingMedia, 10000);
  console.log('[media-retry] retry de mídias pendentes iniciado (5 min)');

  // Limpeza Noturna (03:00 AM)
  cron.schedule('0 3 * * *', () => {
    nightlyCleanup();
  });
  console.log('[cleanup] Cron de limpeza noturna agendado (03:00)');

  // Retry automático de documentos financeiros (NF/Demonstrativo/Boleto) que
  // falharam no agente iLux - sem isso, um pedido que falhou uma vez ficava
  // parado para sempre, mesmo que o agente já tivesse indexado o arquivo
  // horas depois; o usuário tinha que reabrir/clicar de novo manualmente.
  setInterval(() => {
    billingDocuments.retryFailedDocumentRequests().catch((err) => {
      console.error('[billing-documents] erro ao reenfileirar documentos com falha:', err.message);
    });
  }, 15 * 60 * 1000);
  console.log('[billing-documents] retry automático de documentos financeiros com falha iniciado (15 min)');
}

module.exports = { start };
