const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');

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
  // "id" no registro de /chat/findChats é o id interno do banco da
  // Evolution (cuid), não o jid do WhatsApp -- o jid real vem em
  // "remoteJid". Mesmo bug que existiu na importação de contatos.
  const value = typeof chat === 'string' ? chat : chat?.remoteJid || chat?.jid || chat?.id;
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
  const requestedDays = Number(options.days);
  const requestedLimit = Number(options.limitPerChat);
  const requestedMaxChats = Number(options.maxChats);
  return {
    // Importação manual e sob demanda -- pode ir bem mais longe no tempo do
    // que a recuperação de mensagens perdidas (syncMissedMessagesService),
    // mas ainda com um teto pra não travar o processo numa conta com anos de
    // conversa.
    days: Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), 180) : 30,
    limitPerChat: Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 10), 500) : 200,
    maxChats: Number.isFinite(requestedMaxChats) ? Math.min(Math.max(requestedMaxChats, 1), 1000) : 500,
  };
}

/**
 * Importa o histórico de conversas que a Evolution ainda guarda da instância
 * (sincronizado do celular pareado por QR). É uma ação manual (o cliente
 * decide se quer rodar), diferente da importação de contatos: aqui cada
 * conversa nova entra como ticket "resolvido" (forceResolvedOnCreate), pra
 * não inundar a fila de atendimento com centenas de conversas antigas.
 * Idempotente: processSingleMessage ignora externalId já gravado.
 */
async function importChatHistory(waInstance, { evolutionUrl, evolutionKey }, options = {}) {
  const normalized = normalizeOptions(options);
  const startedAt = Date.now();
  const result = {
    instanceName: waInstance.instanceName,
    days: normalized.days,
    chats: 0,
    scanned: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
  };

  const jids = new Set();
  try {
    const chats = asArray(await evolutionService.findChats(evolutionUrl, evolutionKey, waInstance.instanceName));
    chats.forEach((chat) => {
      const jid = chatJid(chat);
      if (jid && !evolutionService.isGroupJid(jid)) jids.add(jid);
    });
  } catch (error) {
    throw new Error(`Não foi possível listar as conversas na Evolution: ${error.message}`);
  }

  const selectedJids = [...jids].slice(0, normalized.maxChats);
  result.chats = selectedJids.length;
  const cutoff = Date.now() - normalized.days * 24 * 60 * 60 * 1000;
  const { processSingleMessage } = require('../controllers/webhookController');

  for (const jid of selectedJids) {
    let messages;
    try {
      messages = asArray(await evolutionService.findMessages(
        evolutionUrl,
        evolutionKey,
        waInstance.instanceName,
        jid,
        normalized.limitPerChat,
      ));
    } catch (error) {
      result.errors += 1;
      console.warn(`[chatHistoryImport] Falha ao consultar ${jid} em ${waInstance.instanceName}: ${error.message}`);
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
        await processSingleMessage(message, waInstance.instanceName, waInstance, waInstance.tenant, true, { forceResolvedOnCreate: true });
        result.imported += 1;
      } catch (error) {
        result.errors += 1;
        console.warn(`[chatHistoryImport] Falha ao importar ${externalId} em ${waInstance.instanceName}: ${error.message}`);
      }
    }
  }

  console.log(`[chatHistoryImport] ${waInstance.instanceName}: ${result.imported} importadas, ${result.scanned} analisadas em ${Date.now() - startedAt}ms.`);
  return result;
}

module.exports = { importChatHistory, __testing: { asArray, chatJid, messageTimestamp, normalizeOptions } };
