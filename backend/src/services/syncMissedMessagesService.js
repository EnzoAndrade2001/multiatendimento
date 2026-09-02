const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');
const axios = require('axios');

async function syncMissedMessages(instanceName) {
  try {
    const waInstance = await prisma.waInstance.findFirst({
      where: { instanceName },
      include: { tenant: { include: { settings: true } } }
    });

    if (!waInstance || !waInstance.tenant || !waInstance.tenant.settings) return;
    const settings = waInstance.tenant.settings;
    if (!settings.evolutionUrl || !settings.evolutionKey) return;

    console.log(`[syncMissedMessages] Iniciando sincronização automática para instância: ${instanceName}`);
    
    // Contatos ativos nos últimos 7 dias (período menor para focar em conexões recentes)
    const recentAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const recentContacts = await prisma.contact.findMany({
      where: { 
        instanceId: waInstance.id,
        tickets: { some: { updatedAt: { gt: recentAgo } } }
      },
      select: { phone: true }
    });

    if (recentContacts.length === 0) {
      console.log(`[syncMissedMessages] Nenhum contato recente para verificar em ${instanceName}`);
      return;
    }

    let totalSynced = 0;
    const backendUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3002}`;

    for (const contact of recentContacts) {
      let jid = contact.phone;
      if (!jid) continue;
      if (!jid.includes('@')) jid += '@s.whatsapp.net';

      let messages = [];
      try {
        const messagesResponse = await evolutionService.findMessages(settings.evolutionUrl, settings.evolutionKey, instanceName, jid, 10);
        
        if (Array.isArray(messagesResponse)) messages = messagesResponse;
        else if (Array.isArray(messagesResponse?.data)) messages = messagesResponse.data;
        else if (Array.isArray(messagesResponse?.messages)) messages = messagesResponse.messages;
        else if (Array.isArray(messagesResponse?.data?.messages)) messages = messagesResponse.data.messages;
        else if (Array.isArray(messagesResponse?.records)) messages = messagesResponse.records;
        else if (Array.isArray(messagesResponse?.messages?.records)) messages = messagesResponse.messages.records;
        else if (messagesResponse?.message && Array.isArray(messagesResponse.message)) messages = messagesResponse.message;
      } catch (e) {
        continue;
      }
      
      if (!Array.isArray(messages)) messages = [];

      for (const msg of messages) {
        const externalId = msg.key?.id || msg.id;
        if (!externalId) continue;
        
        const msgTimestamp = msg.messageTimestamp || msg.timestamp || (msg.key?.messageTimestamp);
        const timeSec = msgTimestamp ? parseInt(msgTimestamp) : 0;
        if (timeSec === 0) continue;
        
        // Foca em mensagens das últimas 24 horas para evitar excesso de dados em reconexões rápidas
        const ageHours = (Date.now() - (timeSec * 1000)) / (1000 * 60 * 60);
        if (ageHours > 24) continue;

        const exists = await prisma.message.findFirst({
          where: { externalId, ticket: { tenantId: waInstance.tenantId } },
        });
        
        if (!exists) {
          console.log(`[syncMissedMessages] Mensagem recuperada via sync automático: ${externalId} (${require('../utils/privacy').maskPhone(contact.phone)})`);
          try {
            const webhookHeaders = process.env.WEBHOOK_SECRET
              ? { 'x-webhook-secret': process.env.WEBHOOK_SECRET }
              : undefined;
            await axios.post(`${backendUrl}/api/webhook`, {
              event: 'messages.upsert',
              instance: instanceName,
              data: { messages: [msg] }
            }, webhookHeaders ? { headers: webhookHeaders } : undefined);
            totalSynced++;
            // Pequeno delay para evitar gargalos na API
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (err) {
            console.error(`[syncMissedMessages] Erro ao disparar webhook local: ${err.message}`);
          }
        }
      }
    }
    
    console.log(`[syncMissedMessages] Concluído para ${instanceName}. ${totalSynced} mensagens recuperadas.`);
  } catch (err) {
    console.error(`[syncMissedMessages] Erro geral ao sincronizar ${instanceName}: ${err.message}`);
  }
}

module.exports = { syncMissedMessages };
