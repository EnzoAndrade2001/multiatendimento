const prisma = require('../lib/prisma');
const historyService = require('../services/historyService');
const geminiService = require('../services/aiService');
const evolutionService = require('../services/evolutionService');
const ticketSessionService = require('../services/ticketSessionService');
const whatsappComplianceService = require('../services/whatsappComplianceService');
const path = require('path');
const fs = require('fs');
const { hasPermission } = require('../auth/permissions');
const { mergeTicketUserStates } = require('./ticketPreferencesController');
let io;
function setIo(socketIo) { io = socketIo; }
const isLocalDemo = () => String(process.env.LOCAL_DEMO || '').toLowerCase() === 'true';

function hasMissingWhatsAppNumber(value) {
  if (Array.isArray(value)) return value.some(hasMissingWhatsAppNumber);
  if (!value || typeof value !== 'object') return false;
  if (value.exists === false) return true;
  return Object.values(value).some(hasMissingWhatsAppNumber);
}

function isMissingWhatsAppNumberError(error) {
  return hasMissingWhatsAppNumber(error?.response?.data?.response?.message);
}

function toRemoteJid(target) {
  if (!target) return '';
  return target.includes('@') ? target : `${target}@s.whatsapp.net`;
}

function normalizeSendTarget(value) {
  const target = String(value || '').trim().toLowerCase();
  if (
    target.endsWith('@s.whatsapp.net')
    || target.endsWith('@lid')
    || target.endsWith('@g.us')
  ) {
    return target;
  }
  return evolutionService.normalizePhoneNumber(target);
}

function getResultRemoteJid(result) {
  return result?.key?.remoteJid
    || result?.message?.key?.remoteJid
    || result?.data?.key?.remoteJid
    || null;
}

function formatSendDetail(value) {
  if (Array.isArray(value)) {
    return value.map(formatSendDetail).filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') {
    if (value.exists === false) {
      const number = value.number || value.jid || '';
      return `numero ${number || 'informado'} nao encontrado no WhatsApp (exists=false)`;
    }
    return JSON.stringify(value);
  }

  return value == null ? '' : String(value);
}

function formatSendError(error) {
  const status = error?.response?.status;
  const responseData = error?.response?.data;
  const detail = formatSendDetail(
    responseData?.response?.message || responseData?.message || responseData?.error
  );
  const composedMessage = error?.message && !error.message.includes('[object Object]')
    ? error.message
    : null;

  const parts = [
    status ? `HTTP ${status}` : null,
    detail || (!composedMessage ? 'erro desconhecido' : null),
  ].filter(Boolean);

  if (composedMessage && composedMessage !== detail) {
    parts.push(composedMessage);
  }

  return parts.join(' - ');
}

function getQuotedPreview(message) {
  if (!message) return null;
  return message.body
    || (message.mediaType === 'image' ? '📷 Foto'
      : message.mediaType === 'video' ? '🎥 Vídeo'
        : message.mediaType === 'audio' ? '🎤 Áudio'
          : message.mediaType === 'document' ? '📎 Documento'
            : 'Mensagem');
}

async function findQuotedMessage(ticketId, tenantId, quotedMsgId, contactId = null) {
  const requestedId = String(quotedMsgId || '').trim();
  if (!requestedId) return null;

  // O front pode enviar o externalId (mensagens reais da Evolution) ou o id
  // interno (históricos/demo que ainda não receberam externalId). Sempre
  // restringimos a busca ao cliente/tenant para permitir citações no histórico
  // de sessões anteriores sem cruzar empresas ou contatos.
  return prisma.message.findFirst({
    where: {
      ticket: contactId
        ? { tenantId, contactId }
        : { tenantId, id: ticketId },
      OR: [{ externalId: requestedId }, { id: requestedId }],
    },
    orderBy: { createdAt: 'desc' },
  });
}

function getStoredQuotedId(message, requestedId) {
  return message?.externalId || message?.id || (String(requestedId || '').trim() || null);
}
const avatarRefreshCache = new Map();
const AVATAR_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;
const AVATAR_REFRESH_LIMIT = 10;

function getMimeTypeFromFileName(fileName = '', mediaType = 'document') {
  const ext = path.extname(fileName || '').toLowerCase();
  const mimeByExt = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.3gp': 'video/3gpp',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  if (mimeByExt[ext]) return mimeByExt[ext];
  if (mediaType === 'image') return 'image/jpeg';
  if (mediaType === 'video') return 'video/mp4';
  if (mediaType === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

async function getInstanceFallbackQueue(tenantId, preferredInstanceId, strictPreferred = false) {
  const instances = await prisma.waInstance.findMany({
    where: {
      tenantId,
      instanceName: { not: { startsWith: 'DELETED_' } },
    },
  });

  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  const queue = [];
  const push = (instance) => {
    if (instance && !queue.some((item) => item.id === instance.id)) queue.push(instance);
  };

  if (preferredInstanceId) {
    push(byId.get(preferredInstanceId));
    if (strictPreferred) return queue;
  }

  if (strictPreferred) return queue;

  instances
    .filter((instance) => String(instance.status).toLowerCase() === 'connected')
    .forEach(push);
  instances.forEach(push);

  return queue;
}

async function sendWithInstanceFallback({ tenantId, ticketId, preferredInstanceId, send, strictPreferred = false }) {
  const queue = await getInstanceFallbackQueue(tenantId, preferredInstanceId, strictPreferred);
  if (!queue.length) {
    throw new Error(strictPreferred
      ? 'A instância vinculada a esta conversa não foi encontrada.'
      : 'Nenhuma conexao WhatsApp encontrada ou configurada para esta empresa.');
  }

  const failures = [];
  for (const instance of queue) {
    try {
      const result = await send(instance);
      if (ticketId && instance.id !== preferredInstanceId) {
        await prisma.ticket.update({
          where: { id: ticketId },
          data: { instanceId: instance.id },
        });
      }
      return { result, instance };
    } catch (err) {
      const errorDetail = formatSendError(err);
      failures.push(`${instance.instanceName}: ${errorDetail}`);
      console.warn(`[sendWithInstanceFallback] Falha via ${instance.instanceName}${strictPreferred ? '' : '; tentando proxima instancia...'}:`, errorDetail);
    }
  }

  throw new Error(`${strictPreferred ? 'Falha ao enviar pela instancia vinculada a esta conversa' : 'Falha ao enviar por todas as conexoes disponiveis'}. Tentativas: ${failures.join(' | ')}`);
}

function getRecentConversation(messages = [], hours = 24, maxItems = 30) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  const recent = messages.filter(message => new Date(message.createdAt).getTime() >= cutoff);
  return recent.slice(-maxItems);
}

async function getUserVisibilityFilter(user) {
  if (hasPermission(user, 'inbox.view_all')) return null;
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.userId },
    select: { teamId: true },
  });
  const teamIds = memberships.map((item) => item.teamId);
  return {
    OR: [
      { agentId: user.userId },
      { agentId: null },
      ...(teamIds.length ? [{ teamId: { in: teamIds } }] : []),
    ],
  };
}

function buildWhere(conditions) {
  const filtered = conditions.filter(Boolean);
  if (filtered.length === 1) return filtered[0];
  return { AND: filtered };
}

function getTicketStatusWeight(status) {
  return { open: 3, pending: 2, bot: 2, resolved: 1 }[status] || 0;
}

function isTicketPreferred(candidate, current) {
  const candidateWeight = getTicketStatusWeight(candidate?.status);
  const currentWeight = getTicketStatusWeight(current?.status);

  if (candidateWeight !== currentWeight) {
    return candidateWeight > currentWeight;
  }

  return new Date(candidate?.updatedAt || 0).getTime() > new Date(current?.updatedAt || 0).getTime();
}

function dedupeTicketsByContact(tickets = []) {
  const grouped = new Map();

  for (const ticket of tickets) {
    const key = ticket.contactId || ticket.contact?.id || ticket.id;
    const current = grouped.get(key);

    if (!current || isTicketPreferred(ticket, current)) {
      grouped.set(key, ticket);
    }
  }

  return Array.from(grouped.values()).sort((a, b) => (
    new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  ));
}

function shouldAttemptAvatarRefresh(ticket) {
  const phone = ticket?.contact?.phone;
  const instanceName = ticket?.instance?.instanceName;
  if (!phone || !instanceName) return false;

  const avatarUrl = ticket?.contact?.avatarUrl || '';
  if (!avatarUrl) return true;

  return /^https?:\/\//i.test(avatarUrl);
}

function getAvatarRefreshKey(ticket) {
  return `${ticket?.instanceId || 'no-instance'}:${ticket?.contactId || 'no-contact'}`;
}

async function refreshTicketAvatarInBackground(ticket) {
  const refreshKey = getAvatarRefreshKey(ticket);
  const now = Date.now();
  const lastAttemptAt = avatarRefreshCache.get(refreshKey) || 0;
  if (now - lastAttemptAt < AVATAR_REFRESH_TTL_MS) return;

  avatarRefreshCache.set(refreshKey, now);

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ticket.tenantId },
      include: { settings: true },
    });

    if (!tenant?.settings?.evolutionUrl || !tenant.settings?.evolutionKey) return;

    const nextAvatarUrl = await evolutionService.fetchProfilePicture(
      tenant.settings.evolutionUrl,
      tenant.settings.evolutionKey,
      ticket.instance.instanceName,
      ticket.contact.phone,
    );

    if (!nextAvatarUrl || nextAvatarUrl === ticket.contact.avatarUrl) return;

    await prisma.contact.update({
      where: { id: ticket.contact.id },
      data: { avatarUrl: nextAvatarUrl },
    });

    if (!io) return;

    const freshTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        contact: true,
        agent: { select: { id: true, name: true } },
        team: true,
        instance: { select: { instanceName: true } },
      },
    });

    if (freshTicket) {
      io.to(ticket.tenantId).emit('ticket_updated', { ticket: freshTicket });
    }
  } catch (error) {
    console.error('[ticket avatars] falha ao renovar avatar:', error.message);
  }
}

function refreshVisibleTicketAvatars(tickets = []) {
  const uniqueCandidates = [];
  const seenKeys = new Set();

  for (const ticket of tickets) {
    if (!shouldAttemptAvatarRefresh(ticket)) continue;

    const refreshKey = getAvatarRefreshKey(ticket);
    if (seenKeys.has(refreshKey)) continue;

    seenKeys.add(refreshKey);
    uniqueCandidates.push(ticket);

    if (uniqueCandidates.length >= AVATAR_REFRESH_LIMIT) break;
  }

  uniqueCandidates.forEach((ticket) => {
    refreshTicketAvatarInBackground(ticket).catch(() => {});
  });
}

async function list(req, res) {
  const { status, mine, priority, agentId, teamId, search } = req.query;
  const visibilityFilter = await getUserVisibilityFilter(req.user);
  const pendingCondition = {
    OR: [
      { status: { in: ['pending', 'bot'] } },
      { status: 'open', agentId: null }
    ]
  };
  const conditions = [{ tenantId: req.user.tenantId }];
  
  if (mine === 'true') {
    conditions.push({ agentId: req.user.userId });
  } else if (visibilityFilter) {
    conditions.push(visibilityFilter);
  }

  if (status) {
    if (status === 'pending') {
      conditions.push(pendingCondition);
    } else if (status === 'all') {
      // "Contatos" - Mostra resolvidos e todos os em atendimento (independente de quem atende)
      conditions.push({ status: { in: ['resolved', 'open'] } });
    } else {
      conditions.push({ status });
    }
  } else if (mine === 'true') {
    conditions.push({ status: 'open' });
  }
  
  if (mine !== 'true' && agentId) {
    conditions.push({ agentId });
  }

  if (teamId) {
    conditions.push({ teamId });
  }

  if (priority) {
    conditions.push({ priority });
  }

  if (search) {
    // Precisa cobrir os mesmos campos que a busca de Contatos usa (nome
    // fantasia, CPF/CNPJ, telefone E whatsapp) - senao um cliente que so
    // aparece pelo CNPJ ou pelo campo "whatsapp" (diferente de "phone")
    // e encontrado la, mas nao aqui no Inbox.
    conditions.push({
      OR: [
        { contact: { name: { contains: search, mode: 'insensitive' } } },
        { contact: { fantasyName: { contains: search, mode: 'insensitive' } } },
        { contact: { cpfCnpj: { contains: search, mode: 'insensitive' } } },
        { contact: { phone: { contains: search } } },
        { contact: { whatsapp: { contains: search } } }
      ]
    });
  }

  const where = buildWhere(conditions);

  let tickets = await prisma.ticket.findMany({
    where,
    include: { 
      contact: { include: { crmCustomer: true } }, 
      agent: { select: { id: true, name: true } }, 
      team: true,
      instance: { select: { instanceName: true } }
    },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  });

  if (status === 'all') {
    tickets = dedupeTicketsByContact(tickets);
  }

  const userStates = tickets.length
    ? await prisma.userTicketState.findMany({
      where: {
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        ticketId: { in: tickets.map((ticket) => ticket.id) },
      },
      select: { ticketId: true, isUnread: true, isPinned: true, pinnedAt: true },
    })
    : [];
  tickets = mergeTicketUserStates(tickets, userStates);

  refreshVisibleTicketAvatars(tickets);

  // Busca as contagens globais para os badges
  const [countMine, countPending, countResolved, countAllGroups] = await Promise.all([
    prisma.ticket.count({ where: { tenantId: req.user.tenantId, agentId: req.user.userId, status: 'open' } }),
    prisma.ticket.count({
      where: buildWhere([
        { tenantId: req.user.tenantId },
        visibilityFilter,
        pendingCondition
      ])
    }),
    prisma.ticket.count({
      where: buildWhere([
        { tenantId: req.user.tenantId },
        visibilityFilter,
        { status: 'resolved' }
      ])
    }),
    prisma.ticket.groupBy({
      by: ['contactId'],
      where: buildWhere([
        { tenantId: req.user.tenantId },
        visibilityFilter,
        { status: { in: ['resolved', 'open'] } }
      ])
    })
  ]);

  res.json({
    tickets,
    counts: {
      mine: countMine,
      pending: countPending,
      resolved: countResolved,
      all: countAllGroups.length
    }
  });
}

async function getMessages(req, res) {
  const { id } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 20), 100);
  const before = req.query.before ? new Date(req.query.before) : null;
  const includeHistory = req.query.includeHistory === 'true';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const ticket = await prisma.ticket.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!ticket) return res.status(404).json({ error: 'Ticket nao encontrado' });

  if (ticket.unreadCount > 0) {
    await prisma.ticket.update({
      where: { id },
      data: { unreadCount: 0 }
    });
    if (io) io.to(req.user.tenantId).emit('ticket_updated', { id, unreadCount: 0 });
  }

  const allTickets = includeHistory
    ? await prisma.ticket.findMany({
        where: { contactId: ticket.contactId, tenantId: req.user.tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true, status: true },
      })
    : [{ id: ticket.id, createdAt: ticket.createdAt, status: ticket.status }];

  const ticketIds = allTickets.map(t => t.id);
  const createdAtFilter = before && !Number.isNaN(before.getTime()) ? { lt: before } : undefined;
  const messageSearchFilter = search
    ? {
        OR: [
          { body: { contains: search, mode: 'insensitive' } },
          { transcription: { contains: search, mode: 'insensitive' } },
          { quotedMsgBody: { contains: search, mode: 'insensitive' } },
          { fileName: { contains: search, mode: 'insensitive' } },
        ],
      }
    : undefined;

  const messages = await prisma.message.findMany({
    where: {
      ticketId: { in: ticketIds },
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...(messageSearchFilter || {}),
    },
    orderBy: { createdAt: 'desc' },
    take: search ? limit + 1 : limit * 2,
    include: { agent: { select: { name: true } } },
  });

  const events = search
    ? []
    : await prisma.ticketEvent.findMany({
        where: {
          ticketId: { in: ticketIds },
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { user: { select: { name: true } } }
      });

  const combinedDesc = [
    ...messages.map(m => ({ ...m, _type: 'message' })),
    ...events.map(e => ({ ...e, _type: 'event' }))
  ]
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  .slice(0, limit + 1);

  const hasMore = combinedDesc.length > limit;
  const pageItems = hasMore ? combinedDesc.slice(0, limit) : combinedDesc;
  // pageItems ainda esta em ordem DECRESCENTE aqui -> o ultimo e o MAIS ANTIGO
  // da pagina. Precisa ser capturado ANTES do reverse() (que muta o array), ou
  // o cursor vira a mensagem mais nova e o "carregar mais" so anda 1 por vez.
  const oldestInPage = pageItems[pageItems.length - 1]?.createdAt || null;
  const combined = pageItems.reverse();

  const ticketMap = Object.fromEntries(allTickets.map(t => [t.id, t]));
  const result = [];
  let lastTicketId = null;

  for (const item of combined) {
    const tId = item.ticketId;
    if (tId !== lastTicketId) {
      const t = ticketMap[tId];
      result.push({
        _separator: true,
        date: t.createdAt,
        ticketId: t.id,
        isCurrent: t.id === id,
      });
      lastTicketId = tId;
    }
    result.push(item);
  }

  const nextCursor = hasMore ? oldestInPage : null;
  res.json({
    items: result,
    hasMore,
    nextCursor: nextCursor ? new Date(nextCursor).toISOString() : null,
  });
}

async function detail(req, res) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    include: {
      contact: { include: { crmCustomer: true } },
      agent: { select: { id: true, name: true } },
      team: true,
      instance: { select: { instanceName: true } },
    },
  });
  if (!ticket) return res.status(404).json({ error: 'Ticket nao encontrado' });
  return res.json(ticket);
}
async function assign(req, res) {
  const { id } = req.params;
  const { agentId, teamId, note } = req.body;
  const isSelfAssignment = agentId === req.user.userId && !teamId;
  const neededPermission = isSelfAssignment ? 'inbox.assign' : 'inbox.transfer';
  if (!hasPermission(req.user, neededPermission)) {
    return res.status(403).json({
      error: isSelfAssignment
        ? 'Voce nao possui permissao para assumir atendimentos.'
        : 'Voce nao possui permissao para transferir atendimentos.',
    });
  }

  const existing = await prisma.ticket.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Ticket não encontrado' });

  if (existing.status === 'resolved') await ticketSessionService.ensureSessionForActivity(existing);

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      agentId: agentId || null,
      teamId: teamId || null,
      status: agentId ? 'open' : (teamId ? 'pending' : 'open'),
      // Reabrir um ticket resolvido inicia uma nova conversa (mesma linha reaproveitada).
    },
    include: { contact: true, agent: { select: { id: true, name: true } }, team: true },
  });

  if (io) {
    io.to(ticket.tenantId).emit('ticket_updated', { ticketId: ticket.id, status: ticket.status, ticket });
  }

  // Auditoria de transferência/atribuição
  const assignEvent = await historyService.logEvent({
    ticketId: ticket.id,
    tenantId: ticket.tenantId,
    userId: req.user.userId,
    type: agentId ? 'assigned' : (teamId ? 'transferred' : 'unassigned'),
    payload: { agentId, teamId, agentName: ticket.agent?.name, teamName: ticket.team?.name }
  });
  if (io) {
    io.to(ticket.tenantId).emit('new_event', assignEvent);
  }

  // Log note event if a note is provided during transfer
  if (note && typeof note === 'string' && note.trim()) {
    const noteEvent = await historyService.logEvent({
      ticketId: ticket.id,
      tenantId: ticket.tenantId,
      userId: req.user.userId,
      type: 'note',
      payload: { note: note.trim() }
    });
      if (io) {
        io.to(ticket.tenantId).emit('ticket_updated', { ticketId: ticket.id });
        io.to(ticket.tenantId).emit('new_event', noteEvent);
      }
  }

  // GERAÇÃO DE RESUMO IA (ASSÍNCRONO)
  if (agentId || teamId) {
    (async () => {
       try {
         const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: ticket.tenantId } });
         if (geminiService.hasConfiguredProvider(settings) && settings?.botEnabled) {
            const history = await prisma.message.findMany({
              where: { ticketId: ticket.id },
              orderBy: { createdAt: 'asc' },
              take: 100
            });
            const recentHistory = getRecentConversation(history, 24, 30);
            if (recentHistory.length >= 5) {
               const summary = await geminiService.generateTransferSummary(settings, recentHistory);
               if (summary) {
                  await historyService.logEvent({
                    ticketId: ticket.id,
                    tenantId: ticket.tenantId,
                    type: 'ia_summary',
                    payload: JSON.stringify({ summary })
                  });
                  if (io) io.to(ticket.tenantId).emit('ticket_updated', { id: ticket.id });
               }
            }
         }
       } catch (e) { console.error('[assign] erro resumo IA:', e.message); }
    })();
  }

  res.json(ticket);
}

async function update(req, res) {
  const { id } = req.params;
  const { priority, status } = req.body;

  if (status === 'resolved' && !hasPermission(req.user, 'inbox.resolve')) {
    return res.status(403).json({ error: 'Voce nao possui permissao para encerrar atendimentos.' });
  }
  if (status && status !== 'resolved' && !hasPermission(req.user, 'inbox.reopen')) {
    return res.status(403).json({ error: 'Voce nao possui permissao para alterar o status do atendimento.' });
  }

  const existing = await prisma.ticket.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Ticket não encontrado' });

  const reopeningFromResolved = existing.status === 'resolved' && status && status !== 'resolved';
  if (reopeningFromResolved) await ticketSessionService.ensureSessionForActivity(existing);
  const resolvingNow = status === 'resolved' && existing.status !== 'resolved';
  const resolvedAt = resolvingNow ? new Date() : null;

  const ticket = await prisma.ticket.update({
    where: { id },
    data: {
      ...(priority && { priority }),
      ...(status && { status }),
      // Reabrir manualmente um ticket resolvido inicia uma nova conversa.
      ...(resolvedAt && { resolvedAt }),
    }
  });

  if (resolvedAt) await ticketSessionService.resolveTicketSession(existing, resolvedAt);

  res.json(ticket);
}

async function resolve(req, res) {
  const { id } = req.params;
  const existing = await prisma.ticket.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (existing.status === 'resolved') return res.json(existing);

  const resolvedAt = new Date();
  const ticket = await prisma.ticket.update({
    where: { id },
    data: { status: 'resolved', resolvedAt },
    include: { contact: true }
  });
  await ticketSessionService.resolveTicketSession(existing, resolvedAt);

  // Auditoria
  await historyService.logEvent({
    ticketId: ticket.id,
    tenantId: req.user.tenantId,
    userId: req.user.userId,
    type: 'resolved'
  });

  // Gatilho de Webhook Externo e Pesquisa de Satisfação
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } });
  
  (async () => {
    try {
      // 1. Webhook Externo
      if (settings?.webhookUrl) {
        const axios = require('axios');
        await axios.post(settings.webhookUrl, {
          event: 'ticket_resolved',
          ticket: { id: ticket.id, contact: ticket.contact.phone, resolvedAt: ticket.resolvedAt }
        }, { timeout: 5000 }).catch(e => console.error('[webhook_external] erro:', e.message));
      }

      // 2. Pesquisa de Satisfação (CSAT)
      console.log(`[CSAT_CHECK] Ticket=${ticket.id} Enabled=${settings?.ratingEnabled}`);
      if (settings?.ratingEnabled) {
        const evolutionService = require('../services/evolutionService');
        const waInstance = await prisma.waInstance.findUnique({ where: { id: ticket.instanceId } });
        
        if (waInstance) {
          console.log(`[CSAT_SEND] Enviando para ${require('../utils/privacy').maskPhone(ticket.contact.phone)} via ${waInstance.instanceName}`);
          const ratingText = settings.ratingMessage || "Como você avalia nosso atendimento de 1 a 5?";
          const result = await evolutionService.sendText(
            settings.evolutionUrl, 
            settings.evolutionKey, 
            waInstance.instanceName, 
            ticket.contact.phone, 
            ratingText
          );

          // Registrar no banco para aparecer no chat
          await prisma.message.create({
            data: {
              ticketId: ticket.id,
              body: ratingText,
              fromMe: true,
              fromBot: true,
              automationType: 'CSAT',
              externalId: result?.key?.id || result?.message?.key?.id
            }
          });
          if (io) io.to(req.user.tenantId).emit('new_message', { ticketId: ticket.id });

        } else {
          console.error(`[CSAT_ERROR] Instância não encontrada: ${ticket.instanceId}`);
        }
      }
    } catch (err) {
      console.error('[after_resolve] erro:', err.message);
    }
  })();
  res.json(ticket);

  // IA: Geração de Tags Automáticas ao encerrar (DESATIVADO pelo usuário)
  /*
  if (settings?.geminiKey) {
    (async () => {
      try {
        const geminiService = require('../services/aiService');
        const history = await prisma.message.findMany({
          where: { ticketId: id },
          orderBy: { createdAt: 'asc' },
          take: 30
        });
        
        console.log(`[autoTags] analisando ticket ${id}...`);
        
        // 1. Buscar Etiquetas Oficiais (Master List)
        const officialTags = await prisma.tag.findMany({ where: { tenantId: ticket.tenantId } });
        const tagNames = officialTags.map(t => t.name);

        // 2. Pedir para a IA escolher apenas entre as oficiais
        const newTags = await geminiService.generateTags(settings, history, tagNames);
        
        if (newTags && newTags.length > 0) {
          console.log(`[autoTags] tags sugeridas: ${newTags.join(', ')}`);
          const currentTags = JSON.parse(ticket.contact.tags || '[]');
          const combined = Array.from(new Set([...currentTags, ...newTags]));
          
          await prisma.contact.update({
            where: { id: ticket.contactId },
            data: { tags: JSON.stringify(combined) }
          });
        }
      } catch (err) {
        console.error('[autoTags] erro:', err.message);
      }
    })();
  }
  */
}

async function sendMessage(req, res) {
  const { id } = req.params;
  const { body, quotedMsgId, instanceId, template } = req.body;

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: { contact: true, instance: true },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });

    const outbound = await whatsappComplianceService.authorizeOutbound({
      tenantId: req.user.tenantId,
      ticket,
      instanceId,
      templateSelection: template,
    });

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } });
    const evolutionUrl = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
    const evolutionKey = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;

    if (isLocalDemo()) {
      const agent = await prisma.user.findUnique({ where: { id: req.user.userId } });
      const messageBody = outbound.mode === 'template' ? outbound.renderedBody : String(body || '').trim();
      if (!messageBody) return res.status(400).json({ error: 'Digite uma mensagem para enviar.' });
      const quoted = await findQuotedMessage(id, req.user.tenantId, quotedMsgId, ticket.contactId);
      const sessionResult = await ticketSessionService.ensureSessionForActivity(ticket);
      const now = new Date();
      const updatedTicket = await prisma.ticket.update({
        where: { id },
        data: {
          status: 'open',
          agentId: req.user.userId,
          unreadCount: 0,
          firstResponseAt: sessionResult.startedNew ? now : ticket.firstResponseAt || now,
          slaDueAt: null,
          lastMessageAt: now,
        },
      });
      const message = await prisma.message.create({
        data: {
          ticketId: id,
          agentId: req.user.userId,
          body: messageBody,
          fromMe: true,
          externalId: `demo-${Date.now()}`,
          quotedMsgId: getStoredQuotedId(quoted, quotedMsgId),
          quotedMsgBody: getQuotedPreview(quoted),
        },
      });
      if (io) io.to(req.user.tenantId).emit('new_message', { message, ticket: updatedTicket, contact: ticket.contact, fromMe: true });
      return res.json(message);
    }

    if (!evolutionUrl || !evolutionKey) {
      return res.status(400).json({ error: 'Integração com o WhatsApp (Evolution API) não configurada para esta empresa' });
    }

    const evolutionService = require('../services/evolutionService');
    const agent = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!agent) return res.status(400).json({ error: 'Usuário/Agente não encontrado' });
    const messageBody = outbound.mode === 'template' ? outbound.renderedBody : body;
    const finalBody = `*${agent.name}*\n${messageBody}`;
    
    // Normaliza o número: se tiver 10 ou 11 dígitos, adiciona 55
    const phone = normalizeSendTarget(
      ticket.contact?.whatsappJid || ticket.contact?.whatsapp || ticket.contact?.phone
    );
    const isGroup = phone.includes('@g.us') || evolutionService.isGroupJid(ticket.contact?.phone);
    const remoteJid = isGroup ? phone : toRemoteJid(phone);

    let quotedMsgBody = null;
    let quotedObj = null;
    let storedQuotedMsgId = null;
    if (quotedMsgId && outbound.instance.id === ticket.instanceId) {
      const quoted = await findQuotedMessage(id, req.user.tenantId, quotedMsgId, ticket.contactId);
      if (quoted) {
        quotedMsgBody = getQuotedPreview(quoted);
        storedQuotedMsgId = getStoredQuotedId(quoted, quotedMsgId);
        // A Evolution precisa do id remoto para montar a citação. O id
        // interno continua salvo para preservar a referência no histórico.
        quotedObj = quoted.externalId
          ? { id: quoted.externalId, remoteJid, fromMe: quoted.fromMe, body: quotedMsgBody }
          : null;
      }
    }

    const { result, instance: usedInstance } = await sendWithInstanceFallback({
      tenantId: req.user.tenantId,
      ticketId: id,
      preferredInstanceId: outbound.instance.id,
      strictPreferred: true,
      send: (instance) => {
        if (outbound.mode === 'template') {
          const components = outbound.templateValues.length ? [{
            type: 'body',
            parameters: outbound.templateValues.map((text) => ({ type: 'text', text })),
          }] : [];
          return evolutionService.sendTemplate(evolutionUrl, evolutionKey, instance.instanceName, phone, {
            name: outbound.template.name,
            language: outbound.template.language,
            components,
          });
        }
        return evolutionService.sendText(evolutionUrl, evolutionKey, instance.instanceName, phone, finalBody, quotedObj);
      },
    });
    const externalId = result?.key?.id || result?.message?.key?.id;
    const confirmedRemoteJid = getResultRemoteJid(result);

    if (
      typeof confirmedRemoteJid === 'string'
      && (confirmedRemoteJid.endsWith('@s.whatsapp.net') || confirmedRemoteJid.endsWith('@lid'))
      && confirmedRemoteJid !== ticket.contact?.whatsappJid
    ) {
      await prisma.contact.update({
        where: { id: ticket.contactId },
        data: { whatsappJid: confirmedRemoteJid.toLowerCase() },
      });
    }

    // Auto-atribuição se o ticket não estiver aberto ou estiver sem agente
    await ticketSessionService.ensureSessionForActivity(ticket);
    if (ticket.status !== 'open' || !ticket.agentId) {
      await prisma.ticket.update({
        where: { id },
        data: {
          status: 'open',
          agentId: req.user.userId,
          lastMessageAt: new Date(),
          // Responder um ticket resolvido reabre a mesma linha: inicia uma nova conversa.
        }
      });
      if (io) io.to(req.user.tenantId).emit('ticket_updated', { ticketId: id });
    }

    // SLA: Marca primeira resposta do agente
    await prisma.ticket.updateMany({
      where: { id, tenantId: req.user.tenantId, firstResponseAt: null },
      data: { firstResponseAt: new Date(), slaDueAt: null },
    });

    const message = await prisma.message.create({
      data: { ticketId: id, agentId: req.user.userId, body: messageBody, fromMe: true, externalId, quotedMsgId: storedQuotedMsgId, quotedMsgBody },
    });

    // Atualiza lastMessageAt para ordenação da lista
    await prisma.ticket.update({ where: { id }, data: { lastMessageAt: new Date(), instanceId: usedInstance.id } });
    if (usedInstance.id !== ticket.instanceId && io) io.to(req.user.tenantId).emit('ticket_updated', { ticketId: id });
    res.json(message);
  } catch (err) {
    console.error('[sendMessage] erro:', err.response?.data || err.message);
    res.status(err.status || 500).json({
      error: 'Falha ao enviar mensagem: ' + (err.response?.data?.message || err.message),
      code: err.code,
      window: err.window,
    });
  }
}

async function getOutboundOptions(req, res) {
  try {
    const options = await whatsappComplianceService.getOutboundOptions({
      tenantId: req.user.tenantId,
      ticketId: req.params.id,
      instanceId: req.query.instanceId,
    });
    res.json(options);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
}

async function sendMediaMessage(req, res) {
  const { id } = req.params;
  const file = req.file;
  const caption = req.body.caption || '';
  const quotedMsgId = req.body.quotedMsgId;
  const instanceId = req.body.instanceId;

  if (!file) return res.status(400).json({ error: 'Arquivo obrigatório' });

  try {
    const ticket = await prisma.ticket.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: { contact: true, instance: true },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });

    const outbound = await whatsappComplianceService.authorizeOutbound({
      tenantId: req.user.tenantId,
      ticket,
      instanceId,
      media: true,
    });

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } });
    const evolutionUrl = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
    const evolutionKey = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;

    if (isLocalDemo()) {
      const mediaUrl = `/uploads/media/${file.filename}`;
      const quoted = await findQuotedMessage(id, req.user.tenantId, quotedMsgId, ticket.contactId);
      const mediaType = file.mimetype?.startsWith('image/')
        ? 'image'
        : file.mimetype?.startsWith('video/')
          ? 'video'
          : file.mimetype?.startsWith('audio/')
            ? 'audio'
            : 'document';
      const sessionResult = await ticketSessionService.ensureSessionForActivity(ticket);
      const now = new Date();
      const updatedTicket = await prisma.ticket.update({
        where: { id },
        data: { status: 'open', agentId: req.user.userId, unreadCount: 0, firstResponseAt: sessionResult.startedNew ? now : ticket.firstResponseAt || now, slaDueAt: null, lastMessageAt: now },
      });
      const message = await prisma.message.create({
        data: {
          ticketId: id,
          agentId: req.user.userId,
          body: caption,
          fromMe: true,
          mediaUrl,
          mediaType,
          mediaStatus: 'ok',
          fileName: file.originalname,
          externalId: `demo-media-${Date.now()}`,
          quotedMsgId: getStoredQuotedId(quoted, quotedMsgId),
          quotedMsgBody: getQuotedPreview(quoted),
        },
      });
      if (io) io.to(req.user.tenantId).emit('new_message', { message, ticket: updatedTicket, contact: ticket.contact, fromMe: true });
      return res.json(message);
    }

    if (!evolutionUrl || !evolutionKey) {
      return res.status(400).json({ error: 'Integração com o WhatsApp (Evolution API) não configurada para esta empresa' });
    }

    const evolutionService = require('../services/evolutionService');

    const base64 = (await fs.promises.readFile(file.path)).toString('base64');
    const mime = file.mimetype;

    // Normaliza o número: se tiver 10 ou 11 dígitos, adiciona 55
    const phoneCandidates = [...new Set([
      ticket.contact?.whatsappJid,
      ticket.contact?.whatsapp,
      ticket.contact?.phone,
    ]
      .map(normalizeSendTarget)
      .filter(Boolean))];
    const phone = phoneCandidates[0] || '';

    if (!phone) {
      return res.status(400).json({ error: 'O contato nao possui numero de WhatsApp valido.' });
    }

    const recentExternalIds = (await prisma.message.findMany({
      where: {
        ticketId: id,
        externalId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { externalId: true },
    })).map((message) => message.externalId).filter(Boolean);

    let mediaUrl = `/uploads/media/${file.filename}`;
    let mediaType = 'document';

    const agent = await prisma.user.findUnique({ where: { id: req.user.userId } });
    // Só adiciona o nome do agente se houver legenda ou se for imagem/vídeo
    const finalCaption = caption ? `*${agent?.name || 'Agente'}*\n${caption}` : `*${agent?.name || 'Agente'}*`;
    
    const isGroup = phone.includes('@g.us') || evolutionService.isGroupJid(ticket.contact?.phone);
    const remoteJid = isGroup ? phone : `${phone}@s.whatsapp.net`;

    let quotedMsgBody = null;
    let quotedObj = null;
    let storedQuotedMsgId = null;
    if (quotedMsgId) {
      const quoted = await findQuotedMessage(id, req.user.tenantId, quotedMsgId, ticket.contactId);
      if (quoted) {
        quotedMsgBody = getQuotedPreview(quoted);
        storedQuotedMsgId = getStoredQuotedId(quoted, quotedMsgId);
        quotedObj = quoted.externalId
          ? { id: quoted.externalId, remoteJid, fromMe: quoted.fromMe, body: quotedMsgBody }
          : null;
      }
    }

    const { result, instance: usedInstance } = await sendWithInstanceFallback({
      tenantId: req.user.tenantId,
      ticketId: id,
      // Anexos devem permanecer na instancia da conversa. Se o ticket antigo
      // nao tiver instancia, usamos apenas a instancia atualmente vinculada ao contato;
      // nunca alternamos silenciosamente para outro numero do tenant.
      preferredInstanceId: outbound.instance.id,
      strictPreferred: true,
      send: async (instance) => {
        let lastError;
        let conversationJids = [];

        if (recentExternalIds.length > 0) {
          try {
            conversationJids = await evolutionService.findConversationJidsByMessageIds(
              evolutionUrl,
              evolutionKey,
              instance.instanceName,
              recentExternalIds
            );
            if (conversationJids.length > 0) {
              console.log(
                `[sendMediaMessage] Destinatario recuperado do historico da conversa na instancia ${instance.instanceName}.`
              );
            }
          } catch (error) {
            console.warn(
              `[sendMediaMessage] Nao foi possivel recuperar o JID pelo historico; usando cadastro do contato: ${formatSendError(error)}`
            );
          }
        }

        const targetCandidates = [...new Set([...conversationJids, ...phoneCandidates])];

        for (let index = 0; index < targetCandidates.length; index += 1) {
          const targetPhone = targetCandidates[index];
          const isGroupTarget = targetPhone.includes('@g.us') || evolutionService.isGroupJid(targetPhone);
          const quoteForInstance = instance.id === ticket.instanceId && quotedObj
            ? (typeof quotedObj === 'object'
              ? { ...quotedObj, remoteJid: isGroupTarget ? targetPhone : toRemoteJid(targetPhone) }
              : quotedObj)
            : null;

          try {
            if (mime.startsWith('image/')) {
              mediaType = 'image';
              return await evolutionService.sendMedia(evolutionUrl, evolutionKey, instance.instanceName, targetPhone, {
                mediatype: 'image', media: base64, mimetype: mime, filename: file.originalname, caption: finalCaption, quoted: quoteForInstance, filePath: file.path
              });
            } else if (mime.startsWith('audio/')) {
              mediaType = 'audio';
              try {
                const mediaService = require('../services/mediaService');
                const oldPath = file.path;
                const newPath = await mediaService.normalizeAudio(oldPath);
                const newFilename = path.basename(newPath);
                mediaUrl = `/uploads/media/${newFilename}`;
                const oggBase64 = (await fs.promises.readFile(newPath)).toString('base64');
                return await evolutionService.sendAudio(evolutionUrl, evolutionKey, instance.instanceName, targetPhone, oggBase64, quoteForInstance);
              } catch (err) {
                console.error('[audioConvert] erro:', err.message);
                return await evolutionService.sendAudio(evolutionUrl, evolutionKey, instance.instanceName, targetPhone, base64, quoteForInstance);
              }
            } else if (mime.startsWith('video/')) {
              mediaType = 'video';
              return await evolutionService.sendMedia(evolutionUrl, evolutionKey, instance.instanceName, targetPhone, {
                mediatype: 'video', media: base64, mimetype: mime, filename: file.originalname, caption: finalCaption, quoted: quoteForInstance, filePath: file.path
              });
            }

            mediaType = 'document';
            const docCaption = caption ? finalCaption : undefined;
            return await evolutionService.sendMedia(evolutionUrl, evolutionKey, instance.instanceName, targetPhone, {
              mediatype: 'document',
              media: base64,
              mimetype: mime,
              filename: file.originalname,
              caption: docCaption,
              quoted: quoteForInstance,
              filePath: file.path
            });
          } catch (error) {
            lastError = error;
            const canTryLinkedWhatsApp = index < targetCandidates.length - 1
              && isMissingWhatsAppNumberError(error);
            if (!canTryLinkedWhatsApp) throw error;

            console.warn(
              `[sendMediaMessage] Numero principal nao encontrado no WhatsApp; tentando numero vinculado na mesma instancia ${instance.instanceName}.`
            );
          }
        }

        throw lastError;
      },
    });

    const externalId = result?.key?.id || result?.message?.key?.id;

    await ticketSessionService.ensureSessionForActivity(ticket);
    if (ticket.status !== 'open' || !ticket.agentId) {
      await prisma.ticket.update({
        where: { id },
        data: {
          status: 'open',
          agentId: req.user.userId,
          lastMessageAt: new Date(),
          // Responder um ticket resolvido reabre a mesma linha: inicia uma nova conversa.
        }
      });
      if (io) io.to(req.user.tenantId).emit('ticket_updated', { ticketId: id });
    }

    const message = await prisma.message.create({
      data: {
        ticketId: id,
        agentId: req.user.userId,
        body: caption,
        fromMe: true,
        mediaUrl,
        mediaType,
        fileName: file.originalname,
        externalId,
        mediaStatus: 'ok',
        quotedMsgId: storedQuotedMsgId,
        quotedMsgBody
      },
    });

    // Atualiza lastMessageAt para ordenação da lista
    await prisma.ticket.update({ where: { id }, data: { lastMessageAt: new Date(), instanceId: usedInstance.id } });
    if (usedInstance.id !== ticket.instanceId && io) io.to(req.user.tenantId).emit('ticket_updated', { ticketId: id });

    await prisma.ticket.updateMany({
      where: { id, tenantId: req.user.tenantId, firstResponseAt: null },
      data: { firstResponseAt: new Date(), slaDueAt: null },
    });

    if (mediaType === 'audio' && require('../services/aiService').resolveCapabilityEngine(settings, 'audio').engine) {
      (async () => {
        try {
          const geminiService = require('../services/aiService');
          const { mediaPath } = require('../utils/uploads');
          // Usa path.resolve para evitar problemas de caminho relativo no background
          const audioPath = path.resolve(mediaPath, path.basename(mediaUrl));
          if (!fs.existsSync(audioPath)) return;
          const audioBase64 = (await fs.promises.readFile(audioPath)).toString('base64');
          const transcription = await geminiService.transcribeAudio(settings, audioBase64, 'audio/ogg');
          if (transcription) {
            const updated = await prisma.message.update({ where: { id: message.id }, data: { transcription } });
            if (io) io.to(req.user.tenantId).emit('message_updated', { ticketId: id, message: updated });
          }
        } catch (err) {
          console.error('[agentTranscription] erro:', err.message);
        }
      })();
    }

    res.json(message);
  } catch (err) {
    console.error('[sendMediaMessage] erro:', err.response?.data || err.message);
    res.status(err.status || 500).json({
      error: 'Falha ao enviar mídia: ' + (err.response?.data?.message || err.message),
      code: err.code,
      window: err.window,
    });
  }
}

async function reopen(req, res) {
  const { contactId, instanceId } = req.body;
  if (!contactId) return res.status(400).json({ error: 'contactId obrigatório' });
  if (!instanceId) return res.status(400).json({ error: 'Selecione a instancia para abrir a conversa.' });

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId: req.user.tenantId },
  });
  if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

  const selectedInstance = await prisma.waInstance.findFirst({
    where: {
      id: instanceId,
      tenantId: req.user.tenantId,
      instanceName: { not: { startsWith: 'DELETED_' } },
    },
  });
  if (!selectedInstance) {
    return res.status(400).json({ error: 'Instancia invalida ou nao pertence a esta empresa.' });
  }
  if (String(selectedInstance.status).toLowerCase() !== 'connected') {
    return res.status(400).json({ error: 'A instancia selecionada nao esta conectada.' });
  }

  // Verifica se já existe ticket aberto para esse contato
  const existing = await prisma.ticket.findFirst({
    where: {
      contactId,
      tenantId: req.user.tenantId,
      status: { in: ['pending', 'open', 'bot'] },
    },
  });
  if (existing) {
    if (existing.instanceId !== instanceId) {
      return res.status(409).json({
        error: 'Este contato ja possui uma conversa ativa em outra instancia.',
      });
    }
    return res.json(existing);
  }

  if (contact.instanceId !== instanceId && contact.whatsappJid?.endsWith('@lid')) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { whatsappJid: null },
    });
  }

  const ticket = await prisma.ticket.create({
    data: {
      tenantId: req.user.tenantId,
      instanceId,
      contactId,
      agentId: req.user.userId,
      status: 'open',
      sessionStartedAt: new Date(),
    },
    include: { contact: true, instance: true }
  });
  await ticketSessionService.startTicketSession({
    tenantId: ticket.tenantId,
    ticketId: ticket.id,
    startedAt: ticket.sessionStartedAt || ticket.createdAt,
  });

  // Auditoria
  await historyService.logEvent({
    ticketId: ticket.id,
    tenantId: req.user.tenantId,
    userId: req.user.userId,
    type: 'reopened',
    payload: JSON.stringify({
      instanceId: selectedInstance.id,
      instanceName: selectedInstance.instanceName,
    }),
  });

  res.json(ticket);
}

async function summarize(req, res) {
  console.log('[DEBUG] summarize chamado para ticket:', req.params.id);
  const { id } = req.params;
  const ticket = await prisma.ticket.findFirst({
    where: { id, tenantId: req.user.tenantId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 100 },
        contact: { include: { crmCustomer: true } },
    },
  });

  if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });

  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } });
  if (!geminiService.hasConfiguredProvider(settings)) return res.status(400).json({ error: 'IA não configurada para este tenant' });

  const geminiService = require('../services/aiService');
  const history = getRecentConversation(ticket.messages, 24, 50);
  const prompt = `Resuma apenas a conversa mais recente, considerando no maximo as ultimas 24 horas de atendimento com ${ticket.contact.name || ticket.contact.phone}. Identifique o problema principal e o estado atual da resolucao. Seja conciso e use topicos.`;
  
  try {
    if (history.length === 0) {
      return res.json({ summary: 'Nao ha mensagens recentes nas ultimas 24 horas para resumir.' });
    }
    const summary = await geminiService.summarize(settings, 'Você é um supervisor de atendimento. Gere resumos executivos.', history, prompt);
    res.json({ summary });
  } catch (err) {
    console.error('[summarize] erro:', err.message);
    res.status(500).json({ error: 'Erro ao gerar resumo: ' + err.message });
  }
}

async function deleteMessage(req, res) {
  const { id: ticketId } = req.params;
  const { messageId } = req.params;
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { ticket: { include: { contact: true, instance: true } } }
  });

  if (!message || message.ticketId !== ticketId || message.ticket.tenantId !== req.user.tenantId) {
    return res.status(404).json({ error: 'Mensagem não encontrada ou acesso negado' });
  }
  if (!message.fromMe) return res.status(403).json({ error: 'Você só pode apagar suas próprias mensagens no WhatsApp' });

  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } });
    const evolutionService = require('../services/evolutionService');
    
    // Revoga no WhatsApp quando a mensagem possui os dados necessarios.
    // A exclusao local continua funcionando mesmo sem configuracao da Evolution
    // ou para mensagens internas/historicas sem externalId.
    if (settings?.evolutionUrl && settings?.evolutionKey && message.externalId && message.ticket.instance?.instanceName) {
      try {
        await evolutionService.revokeMessage(
          settings.evolutionUrl,
          settings.evolutionKey,
          message.ticket.instance.instanceName,
          message.ticket.contact.phone,
          message.externalId
        );
      } catch (waErr) {
        console.warn('[deleteMessage] falha ao revogar no WA (provavelmente tempo expirado):', waErr.message);
      }
    }

    // Marca como apagada no banco
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { isDeleted: true, body: 'Mensagem apagada' }
    });

    res.json(updated);
  } catch (err) {
    console.error('[deleteMessage] erro crítico:', err.message);
    res.status(500).json({ error: 'Erro ao processar exclusão de mensagem' });
  }
}

async function linkContact(req, res) {
  const { id } = req.params;
  const { contactId, crmCustomerId } = req.body;
  const { tenantId } = req.user;

  try {
    const ticket = await prisma.ticket.findFirst({ where: { id, tenantId }, include: { contact: true } });
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });

    var sourceContactId = ticket.contactId;
    var whatsapp = ticket.contact.phone;

    if (req.body.unlinkCrm === true) {
      await prisma.contact.update({
        where: { id: sourceContactId },
        data: { crmCustomerId: null }
      });

      // Remove os equipamentos sincronizados do CRM do contato
      await prisma.equipment.deleteMany({
        where: {
          contactId: sourceContactId,
          externalSource: 'firebird'
        }
      });

      const updatedTicket = await prisma.ticket.findUnique({
        where: { id },
        include: {
          contact: { include: { crmCustomer: true } },
          agent: { select: { name: true } },
          team: true,
          instance: { select: { instanceName: true } }
        }
      });

      await historyService.logEvent({
        ticketId: id,
        tenantId,
        userId: req.user.userId,
        type: 'crm_customer_unlinked',
        payload: { contactId: sourceContactId }
      });

      if (io) {
        io.to(tenantId).emit('ticket_updated', { ticketId: id, ticket: updatedTicket });
      }

      return res.json(updatedTicket);
    }

    if (crmCustomerId) {
      const targetCustomer = await prisma.crmCustomer.findFirst({ where: { id: crmCustomerId, tenantId } });
      if (!targetCustomer) return res.status(404).json({ error: 'Cliente CRM nao encontrado' });

      await prisma.contact.update({
        where: { id: sourceContactId },
        data: { crmCustomerId }
      });

      // Sincroniza os equipamentos do CRM para o contato imediatamente
      const { syncCrmEquipmentsToEquipment } = require('../services/crmSyncService');
      await syncCrmEquipmentsToEquipment(tenantId, sourceContactId);

      const updatedTicket = await prisma.ticket.findUnique({
        where: { id },
        include: {
          contact: { include: { crmCustomer: true } },
          agent: { select: { name: true } },
          team: true,
          instance: { select: { instanceName: true } }
        }
      });

      await historyService.logEvent({
        ticketId: id,
        tenantId,
        userId: req.user.userId,
        type: 'crm_customer_linked',
        payload: { contactId: sourceContactId, crmCustomerId, whatsapp }
      });

      if (io) {
        io.to(tenantId).emit('ticket_updated', { ticketId: id, ticket: updatedTicket });
      }

      return res.json(updatedTicket);
    }

    const targetContact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
    if (!targetContact) return res.status(404).json({ error: 'Contato de destino não encontrado' });

    var sourceContactId = ticket.contactId;
    var whatsapp = ticket.contact.phone; // O número atual do ticket

    // 1. NÃO reatribui o ticket para o contato do CRM. 
    // Em vez disso, mantemos o contato original do WhatsApp, mas vinculamos ele via telefone no CRM.
    
    // 2. Atualiza o WhatsApp do contato de destino (CRM) com o número de quem está falando
    const existingWithWa = await prisma.contact.findFirst({ where: { tenantId, whatsapp, NOT: { id: contactId } } });
    if (existingWithWa) {
      await prisma.contact.update({ where: { id: existingWithWa.id }, data: { whatsapp: null } });
    }

    await prisma.contact.update({
      where: { id: contactId },
      data: { whatsapp }
    });

    // 3. Opcional: Podemos marcar no contato original qual o ID do CRM dele (usando um campo ou metadado)
    // Por enquanto, vamos usar a lógica de busca por telefone invertida.
    
    // Retorna o ticket atualizado (sem mudar o contactId)
    const updatedTicket = await prisma.ticket.findUnique({
      where: { id },
      include: { contact: { include: { crmCustomer: true } }, agent: { select: { name: true } }, team: true, instance: { select: { instanceName: true } } }
    });

    // 3. Log de evento
    await historyService.logEvent({
      ticketId: id,
      tenantId,
      userId: req.user.userId,
      type: 'contact_linked',
      payload: { fromId: sourceContactId, toId: contactId, whatsapp }
    });

    if (io) {
      io.to(tenantId).emit('ticket_updated', { ticketId: id, ticket: updatedTicket });
    }

    res.json(updatedTicket);
  } catch (err) {
    console.error('[linkContact] ERRO CRÍTICO:', err);
    res.status(500).json({ error: 'Erro ao vincular contato: ' + err.message });
  }
}

async function forwardMessage(req, res) {
  const { messageId, contactId } = req.body;
  const tenantId = req.user.tenantId;

  try {
    const originalMsg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { ticket: { include: { contact: true, instance: true } } }
    });

    if (!originalMsg) return res.status(404).json({ error: 'Mensagem original não encontrada' });

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
    if (!contact) return res.status(404).json({ error: 'Contato de destino não encontrado' });

    // Encontra ou cria um ticket aberto para o contato
    let ticket = await prisma.ticket.findFirst({
      where: { contactId: contact.id, status: 'open', tenantId },
      include: { instance: true }
    });

    if (!ticket) {
      const instanceId = originalMsg.ticket?.instanceId || (await prisma.waInstance.findFirst({ where: { tenantId, status: 'connected' } }))?.id;
      if (!instanceId) return res.status(400).json({ error: 'Nenhuma instância disponível' });

      ticket = await prisma.ticket.create({
        data: { contactId: contact.id, instanceId, status: 'open', tenantId, agentId: req.user.userId, sessionStartedAt: new Date() },
        include: { instance: true }
      });
      await ticketSessionService.startTicketSession({ tenantId, ticketId: ticket.id, startedAt: ticket.sessionStartedAt || ticket.createdAt });
    }

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const evolutionUrl = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
    const evolutionKey = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;

    if (!evolutionUrl || !evolutionKey) {
      return res.status(400).json({ error: 'Integração com o WhatsApp (Evolution API) não configurada para esta empresa' });
    }

    const evolutionService = require('../services/evolutionService');
    const agent = await prisma.user.findUnique({ where: { id: req.user.userId } });

    const phone = evolutionService.normalizePhoneNumber(contact.phone || '');

    const body = originalMsg.body;
    const mediaUrl = originalMsg.mediaUrl;
    const mediaType = originalMsg.mediaType;

    const { result } = await sendWithInstanceFallback({
      tenantId,
      ticketId: ticket.id,
      preferredInstanceId: ticket.instanceId,
      send: async (instance) => {
        if (mediaUrl) {
          const filePath = path.resolve(__dirname, '..', '..', mediaUrl.startsWith('/') ? mediaUrl.substring(1) : mediaUrl);
          if (!fs.existsSync(filePath)) {
            const err = new Error('Arquivo de mídia não encontrado no servidor');
            err.statusCode = 400;
            throw err;
          }

          const base64 = (await fs.promises.readFile(filePath)).toString('base64');
          const mimetype = getMimeTypeFromFileName(originalMsg.fileName, mediaType);
          const finalCaption = mediaType === 'audio' ? null : `*Encaminhado por ${agent?.name || 'Agente'}*\n${body || ''}`;

          if (mediaType === 'audio') {
            return evolutionService.sendAudio(evolutionUrl, evolutionKey, instance.instanceName, phone, base64);
          }

          return evolutionService.sendMedia(evolutionUrl, evolutionKey, instance.instanceName, phone, {
            mediatype: mediaType === 'document' ? 'document' : mediaType,
            media: base64,
            mimetype,
            filename: originalMsg.fileName || `${mediaType || 'arquivo'}${path.extname(filePath) || ''}`,
            caption: finalCaption,
            filePath
          });
        }

        const finalBody = `*Encaminhado por ${agent?.name || 'Agente'}*\n${body || ''}`;
        return evolutionService.sendText(evolutionUrl, evolutionKey, instance.instanceName, phone, finalBody);
      },
    });

    const externalId = result?.key?.id || result?.message?.key?.id;
    await ticketSessionService.ensureSessionForActivity(ticket);
    await prisma.ticket.updateMany({
      where: { id: ticket.id, tenantId, firstResponseAt: null },
      data: { firstResponseAt: new Date(), slaDueAt: null },
    });
    const newMessage = await prisma.message.create({
      data: {
        ticketId: ticket.id,
        agentId: req.user.userId,
        body: originalMsg.body,
        mediaUrl: originalMsg.mediaUrl,
        mediaType: originalMsg.mediaType,
        fromMe: true,
        externalId
      }
    });

    if (io) {
      io.to(tenantId).emit('new_message', { message: newMessage, ticket });
      io.to(tenantId).emit('ticket_updated', { ticketId: ticket.id });
    }

    res.json(newMessage);
  } catch (err) {
    console.error('[forwardMessage] erro:', err.message);
    res.status(500).json({ error: 'Erro ao encaminhar mensagem' });
  }
}

async function createNote(req, res) {
  const { id } = req.params;
  const { body } = req.body;
  const tenantId = req.user.tenantId;

  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Conteúdo da nota é obrigatório' });
  }

  try {
    const ticket = await prisma.ticket.findFirst({ where: { id, tenantId } });
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });

    const event = await historyService.logEvent({
      ticketId: ticket.id,
      tenantId: ticket.tenantId,
      userId: req.user.userId,
      type: 'note',
      payload: { note: body.trim() }
    });

    if (io) {
      io.to(tenantId).emit('ticket_updated', { ticketId: ticket.id });
      io.to(tenantId).emit('new_message', { ticketId: ticket.id });
    }

    res.json(event);
  } catch (err) {
    console.error('[createNote] erro:', err.message);
    res.status(500).json({ error: 'Erro ao criar nota interna' });
  }
}

module.exports = { list, detail, getMessages, getOutboundOptions, assign, resolve, update, sendMessage, sendMediaMessage, deleteMessage, reopen, summarize, linkContact, forwardMessage, createNote, setIo };
