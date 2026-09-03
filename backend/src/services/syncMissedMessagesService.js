const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');
const lastAutomaticSync = new Map();
const AUTOMATIC_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.data,
    payload?.messages,
    payload?.records,
    payload?.chats,
    payload?.data?.messages,
    payload?.data?.records,
    payload?.messages?.records,
    payload?.data?.messages?.records,
  ];
  return candidates.find(Array.isArray) || [];
}

function chatJid(chat) {
  const value = typeof chat === 'string' ? chat : chat?.id || chat?.jid || chat?.remoteJid;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function messageTimestamp(message) {
  const raw = message?.messageTimestamp || message?.timestamp || message?.key?.messageTimestamp;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = new Date(raw || '');
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizeOptions(options = {}) {
  const requestedHours = Number(options.hours);
  const requestedLimit = Number(options.limitPerChat);
  const requestedMaxChats = Number(options.maxChats);
  return {
    hours: Number.isFinite(requestedHours) ? Math.min(Math.max(requestedHours, 1), 168) : 24,
    limitPerChat: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 10), 100) : 100,
    maxChats: Number.isFinite(requestedMaxChats) ? Math.min(Math.max(requestedMaxChats, 1), 500) : 250,
  };
}

/**
 * Recompõe mensagens mantidas pela Evolution depois de uma queda/reconexão.
 * A rotina é idempotente: processSingleMessage ignora externalId já gravado.
 */
async function syncMissedMessages(instanceName, options = {}) {
  const normalized = normalizeOptions(options);
  const startedAt = Date.now();
  const result = {
    instanceName,
    hours: normalized.hours,
    maxChats: normalized.maxChats,
    chats: 0,
    scanned: 0,
    synced: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    const force = options.force === true;
    const previousAutomaticSync = lastAutomaticSync.get(instanceName) || 0;
    if (!force && Date.now() - previousAutomaticSync < AUTOMATIC_SYNC_COOLDOWN_MS) {
      return { ...result, skipped: 1, reason: 'cooldown' };
    }
    if (!force) lastAutomaticSync.set(instanceName, Date.now());

    const waInstance = await prisma.waInstance.findFirst({
      where: { instanceName },
      include: { tenant: { include: { settings: true } } },
    });
    const settings = waInstance?.tenant?.settings;
    if (!waInstance || !waInstance.tenant || !settings) return result;
    if (!settings.evolutionUrl || !settings.evolutionKey) return result;

    const jids = new Set();
    try {
      const chats = asArray(await evolutionService.findChats(settings.evolutionUrl, settings.evolutionKey, instanceName));
      chats.forEach((chat) => {
        const jid = chatJid(chat);
        if (jid) jids.add(jid);
      });
    } catch (error) {
      console.warn(`[syncMissedMessages] Não foi possível listar chats de ${instanceName}: ${error.message}`);
    }

    // Fallback para instalações da Evolution que não expõem findChats.
    if (jids.size === 0) {
      const recentAgo = new Date(Date.now() - normalized.hours * 60 * 60 * 1000);
      const recentContacts = await prisma.contact.findMany({
        where: { instanceId: waInstance.id, tickets: { some: { updatedAt: { gt: recentAgo } } } },
        select: { phone: true },
      });
      recentContacts.forEach(({ phone }) => {
        if (phone) jids.add(String(phone).includes('@') ? String(phone) : `${phone}@s.whatsapp.net`);
      });
    }

    const selectedJids = [...jids].slice(0, normalized.maxChats);
    result.chats = selectedJids.length;
    const cutoff = Date.now() - normalized.hours * 60 * 60 * 1000;
    const { processSingleMessage } = require('../controllers/webhookController');

    for (const jid of selectedJids) {
      let messages;
      try {
        messages = asArray(await evolutionService.findMessages(
          settings.evolutionUrl,
          settings.evolutionKey,
          instanceName,
          jid,
          normalized.limitPerChat,
        ));
      } catch (error) {
        result.errors += 1;
        console.warn(`[syncMissedMessages] Falha ao consultar ${jid} em ${instanceName}: ${error.message}`);
        continue;
      }

      for (const message of messages) {
        result.scanned += 1;
        const occurredAt = messageTimestamp(message);
        const externalId = message?.key?.id || message?.id;
        if (!externalId || (occurredAt && occurredAt < cutoff)) {
          result.skipped += 1;
          continue;
        }

        try {
          const before = await prisma.message.findFirst({
            where: { externalId, ticket: { tenantId: waInstance.tenantId } },
            select: { id: true },
          });
          if (before) {
            result.skipped += 1;
            continue;
          }
          await processSingleMessage(message, instanceName, waInstance, waInstance.tenant, true);
          result.synced += 1;
        } catch (error) {
          result.errors += 1;
          console.warn(`[syncMissedMessages] Falha ao importar ${externalId} em ${instanceName}: ${error.message}`);
        }
      }
    }

    await prisma.waInstance.update({
      where: { id: waInstance.id },
      data: { lastWebhookAt: new Date(), lastHealthError: null },
    }).catch(() => {});
    console.log(`[syncMissedMessages] ${instanceName}: ${result.synced} recuperadas, ${result.scanned} analisadas em ${Date.now() - startedAt}ms.`);
    return result;
  } catch (error) {
    result.errors += 1;
    console.error(`[syncMissedMessages] Erro geral ao sincronizar ${instanceName}: ${error.message}`);
    return result;
  }
}

module.exports = { syncMissedMessages, __testing: { asArray, chatJid, messageTimestamp, normalizeOptions } };
