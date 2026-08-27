const prisma = require('../lib/prisma');
const { hasPermission } = require('../auth/permissions');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { mediaPath } = require('../utils/uploads');
const { recordPrivacyAudit } = require('../services/privacyAuditService');
const { fingerprint } = require('../utils/privacy');

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true, avatarUrl: true } },
  replyTo: { select: { id: true, body: true, senderId: true, type: true, attachmentName: true } },
  reactions: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
  reads: { select: { userId: true, readAt: true } },
};

let io;
function setIo(socketIo) { io = socketIo; }

function directKey(userId) { return `direct:${userId}`; }
function teamKey(teamId) { return `team:${teamId}`; }

const SAFE_ATTACHMENT_EXTENSIONS = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

function parseIdArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeOriginalName(value) {
  return path.basename(String(value || 'arquivo').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'arquivo';
}

function attachmentBufferMatches(mimeType, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return false;
  const startsWith = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  if (mimeType === 'image/jpeg') return startsWith(0xff, 0xd8, 0xff);
  if (mimeType === 'image/png') return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === 'image/gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType.startsWith('text/')) return !buffer.includes(0);
  if (mimeType.includes('openxmlformats')) return startsWith(0x50, 0x4b);
  if (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(mimeType)) {
    return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  }
  return false;
}

async function persistInternalAttachment(file) {
  if (!file?.buffer) return null;
  const mimeType = String(file.mimetype || '').toLowerCase();
  const extension = SAFE_ATTACHMENT_EXTENSIONS[mimeType];
  if (!extension) throw Object.assign(new Error('Formato de arquivo não permitido no chat interno.'), { statusCode: 415 });
  if (!attachmentBufferMatches(mimeType, file.buffer)) {
    throw Object.assign(new Error('O conteúdo do arquivo não corresponde ao formato informado.'), { statusCode: 415 });
  }
  const storedName = `internal-${Date.now()}-${crypto.randomUUID()}${extension}`;
  await fs.promises.writeFile(path.join(mediaPath, storedName), file.buffer, { flag: 'wx' });
  return {
    url: `/uploads/media/${storedName}`,
    path: path.join(mediaPath, storedName),
    name: safeOriginalName(file.originalname),
    mimeType,
    size: file.size,
  };
}

function parseConversationKey(value) {
  const [kind, id, ...rest] = String(value || '').split(':');
  if (rest.length || !id || !['direct', 'team'].includes(kind)) return null;
  return { kind, id, key: `${kind}:${id}` };
}

async function findAccessibleTeam(req, teamId) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, tenantId: req.user.tenantId },
    include: { members: { select: { userId: true } } },
  });
  if (!team) return null;
  const elevated = hasPermission(req.user, 'teams.manage');
  return elevated || team.members.some((member) => member.userId === req.user.userId) ? team : null;
}

async function resolveConversation(req, key) {
  const parsed = parseConversationKey(key);
  if (!parsed) return null;
  if (parsed.kind === 'direct') {
    if (parsed.id === req.user.userId) return null;
    const user = await prisma.user.findFirst({
      where: { id: parsed.id, tenantId: req.user.tenantId, active: true },
      select: { id: true, name: true, role: true, avatarUrl: true },
    });
    return user ? { ...parsed, target: user } : null;
  }
  const team = await findAccessibleTeam(req, parsed.id);
  return team ? { ...parsed, target: { id: team.id, name: team.name }, team } : null;
}

function messageWhere(req, conversation) {
  if (conversation.kind === 'team') return { tenantId: req.user.tenantId, teamId: conversation.id };
  return {
    tenantId: req.user.tenantId,
    teamId: null,
    OR: [
      { senderId: req.user.userId, receiverId: conversation.id },
      { senderId: conversation.id, receiverId: req.user.userId },
    ],
  };
}

async function assertMessageAccess(req, messageId) {
  const message = await prisma.internalMessage.findFirst({
    where: { id: messageId, tenantId: req.user.tenantId }, include: MESSAGE_INCLUDE,
  });
  if (!message) return null;
  if (message.teamId) return (await findAccessibleTeam(req, message.teamId)) ? message : null;
  return [message.senderId, message.receiverId].includes(req.user.userId) ? message : null;
}

function emitMessage(message, recipientUserIds = [], teamId = null) {
  if (!io) return;
  // Salas individuais evitam que um membro removido da equipe continue
  // recebendo mensagens até a próxima reconexão do Socket.IO.
  const rooms = new Set(recipientUserIds.filter(Boolean).map((id) => `user:${id}`));
  for (const room of rooms) {
    io.to(room).emit('internal_message:new', message);
    io.to(room).emit('new_internal', message);
  }
}

async function listConversations(req, res) {
  const tenantId = req.user.tenantId;
  const userId = req.user.userId;
  const [users, teams, states, directMessages] = await Promise.all([
    prisma.user.findMany({ where: { tenantId, active: true, id: { not: userId } }, select: { id: true, name: true, role: true, avatarUrl: true }, orderBy: { name: 'asc' } }),
    prisma.team.findMany({
      where: { tenantId, ...(hasPermission(req.user, 'teams.manage') ? {} : { members: { some: { userId } } }) },
      select: { id: true, name: true }, orderBy: { name: 'asc' },
    }),
    prisma.internalConversationState.findMany({ where: { tenantId, userId } }),
    prisma.internalMessage.findMany({
      where: { tenantId, teamId: null, OR: [{ senderId: userId }, { receiverId: userId }] },
      include: MESSAGE_INCLUDE, orderBy: { createdAt: 'desc' }, take: 500,
    }),
  ]);
  const teamIds = teams.map((team) => team.id);
  const teamMessages = teamIds.length ? await prisma.internalMessage.findMany({
    where: { tenantId, teamId: { in: teamIds } }, include: MESSAGE_INCLUDE, orderBy: { createdAt: 'desc' }, take: 500,
  }) : [];
  const stateMap = new Map(states.map((state) => [state.conversationKey, state]));
  const lastDirect = new Map();
  for (const message of directMessages) {
    const peerId = message.senderId === userId ? message.receiverId : message.senderId;
    if (peerId && !lastDirect.has(peerId)) lastDirect.set(peerId, message);
  }
  const lastTeam = new Map();
  for (const message of teamMessages) if (!lastTeam.has(message.teamId)) lastTeam.set(message.teamId, message);
  const mentionCount = (messages, state, teamId = null) => messages.reduce((total, message) => {
    if (state?.readAt && new Date(message.createdAt) <= new Date(state.readAt)) return total;
    const userMentions = Array.isArray(message.mentionUserIds) ? message.mentionUserIds : [];
    const teamMentions = Array.isArray(message.mentionTeamIds) ? message.mentionTeamIds : [];
    return total + Number(userMentions.includes(userId) || (teamId && teamMentions.includes(teamId)));
  }, 0);
  const mapConversation = (kind, target, lastMessage, messages = []) => {
    const key = kind === 'direct' ? directKey(target.id) : teamKey(target.id);
    const state = stateMap.get(key);
    return {
      key, kind, target, lastMessage: lastMessage || null,
      unreadCount: state?.unreadCount || 0,
      mentionCount: mentionCount(messages, state, kind === 'team' ? target.id : null),
      pinned: Boolean(state?.pinned), readAt: state?.readAt || null,
    };
  };
  const conversations = [
    ...users.map((user) => mapConversation('direct', user, lastDirect.get(user.id), directMessages.filter((message) => [message.senderId, message.receiverId].includes(user.id)))),
    ...teams.map((team) => mapConversation('team', team, lastTeam.get(team.id), teamMessages.filter((message) => message.teamId === team.id))),
  ].sort((left, right) => Number(right.pinned) - Number(left.pinned)
    || new Date(right.lastMessage?.createdAt || 0) - new Date(left.lastMessage?.createdAt || 0)
    || left.target.name.localeCompare(right.target.name));
  return res.json({ conversations });
}

async function listConversationMessages(req, res) {
  const conversation = await resolveConversation(req, req.params.key);
  if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const where = messageWhere(req, conversation);
  if (req.query.before) {
    const cursorMessage = await prisma.internalMessage.findFirst({ where: { id: String(req.query.before), ...where }, select: { createdAt: true } });
    const before = cursorMessage?.createdAt || new Date(String(req.query.before));
    if (!Number.isNaN(before.getTime())) where.createdAt = { lt: before };
  }
  const rows = await prisma.internalMessage.findMany({ where, include: MESSAGE_INCLUDE, orderBy: { createdAt: 'desc' }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const chronological = page.reverse();
  return res.json({ messages: chronological, nextCursor: hasMore ? chronological[0]?.id || null : null });
}

async function list(req, res) {
  if (!req.query.receiverId) return listConversations(req, res);
  req.params.key = directKey(req.query.receiverId);
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(payload.messages || payload);
  return listConversationMessages(req, res);
}

async function updateState(req, conversation, data) {
  return prisma.internalConversationState.upsert({
    where: { tenantId_userId_conversationKey: { tenantId: req.user.tenantId, userId: req.user.userId, conversationKey: conversation.key } },
    update: data,
    create: { tenantId: req.user.tenantId, userId: req.user.userId, conversationKey: conversation.key, ...data },
  });
}

async function markRead(req, res) {
  const conversation = await resolveConversation(req, req.params.key);
  if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const markUnread = req.body?.unread === true;
  const now = new Date();
  const state = await updateState(req, conversation, markUnread ? { unreadCount: 1, readAt: null } : { unreadCount: 0, readAt: now });
  if (!markUnread) {
    const messages = await prisma.internalMessage.findMany({
      where: { ...messageWhere(req, conversation), senderId: { not: req.user.userId } }, select: { id: true }, take: 500,
    });
    if (messages.length) await prisma.internalMessageRead.createMany({
      data: messages.map((message) => ({ tenantId: req.user.tenantId, messageId: message.id, userId: req.user.userId, readAt: now })),
      skipDuplicates: true,
    });
  }
  if (io) io.to(`user:${req.user.userId}`).emit('internal_conversation:updated', state);
  return res.json(state);
}

async function pinConversation(req, res) {
  if (typeof req.body?.pinned !== 'boolean') return res.status(400).json({ error: 'pinned deve ser booleano.' });
  const conversation = await resolveConversation(req, req.params.key);
  if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const state = await updateState(req, conversation, { pinned: req.body.pinned });
  if (io) io.to(`user:${req.user.userId}`).emit('internal_conversation:updated', state);
  return res.json(state);
}

async function validateMentions(req, userIds, teamIds) {
  const [users, teams] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds }, tenantId: req.user.tenantId, active: true }, select: { id: true } }) : [],
    teamIds.length ? prisma.team.findMany({ where: { id: { in: teamIds }, tenantId: req.user.tenantId }, select: { id: true } }) : [],
  ]);
  return users.length === userIds.length && teams.length === teamIds.length;
}

async function sendMessage(req, res) {
  const { receiverId, teamId, replyToId } = req.body || {};
  const body = String(req.body?.body || '').trim();
  const type = req.body?.type || 'message';
  if ((!body && !req.file) || body.length > 4000) return res.status(400).json({ error: 'Informe uma mensagem ou anexo de até 20 MB.' });
  if (!['message', 'note'].includes(type)) return res.status(400).json({ error: 'Tipo deve ser message ou note.' });
  if (Boolean(receiverId) === Boolean(teamId)) return res.status(400).json({ error: 'Informe exatamente um destinatário ou equipe.' });
  const conversation = await resolveConversation(req, receiverId ? directKey(receiverId) : teamKey(teamId));
  if (!conversation) return res.status(404).json({ error: 'Destinatário ou equipe não encontrado.' });
  if (replyToId) {
    const reply = await assertMessageAccess(req, replyToId);
    if (!reply || (conversation.kind === 'team' ? reply.teamId !== conversation.id : ![reply.senderId, reply.receiverId].includes(conversation.id))) {
      return res.status(400).json({ error: 'Mensagem respondida não pertence a esta conversa.' });
    }
  }
  const rawUserMentions = parseIdArray(req.body?.mentionUserIds);
  const rawTeamMentions = parseIdArray(req.body?.mentionTeamIds);
  if (rawUserMentions.length > 20 || rawTeamMentions.length > 20) {
    return res.status(400).json({ error: 'Limite de 20 menções por mensagem excedido.' });
  }
  const mentionUserIds = [...new Set(rawUserMentions.map(String))];
  const mentionTeamIds = [...new Set(rawTeamMentions.map(String))];
  if (!await validateMentions(req, mentionUserIds, mentionTeamIds)) return res.status(400).json({ error: 'Uma ou mais menções não pertencem a esta empresa.' });

  let attachment;
  let messageCreated = false;
  try {
    attachment = await persistInternalAttachment(req.file);
    const message = await prisma.internalMessage.create({
      data: {
        tenantId: req.user.tenantId, senderId: req.user.userId,
        receiverId: conversation.kind === 'direct' ? conversation.id : null,
        teamId: conversation.kind === 'team' ? conversation.id : null,
        type, body, replyToId: replyToId || null, mentionUserIds, mentionTeamIds,
        attachmentUrl: attachment?.url || null,
        attachmentName: attachment?.name || null,
        attachmentMimeType: attachment?.mimeType || null,
        attachmentSize: attachment?.size || null,
      }, include: MESSAGE_INCLUDE,
    });
    messageCreated = true;
    if (attachment) await recordPrivacyAudit(req, {
      action: 'INTERNAL_ATTACHMENT_UPLOAD',
      resourceType: 'internal_message_attachment',
      resourceId: message.id,
      metadata: { filenameHash: fingerprint(attachment.name), mimeType: attachment.mimeType, size: attachment.size },
    });
    const recipientIds = conversation.kind === 'direct'
      ? [conversation.id]
      : conversation.team.members.map((member) => member.userId).filter((id) => id !== req.user.userId);
    await Promise.all(recipientIds.map((userId) => {
      const recipientKey = conversation.kind === 'direct' ? directKey(req.user.userId) : conversation.key;
      return prisma.internalConversationState.upsert({
        where: { tenantId_userId_conversationKey: { tenantId: req.user.tenantId, userId, conversationKey: recipientKey } },
        update: { unreadCount: { increment: 1 } },
        create: { tenantId: req.user.tenantId, userId, conversationKey: recipientKey, unreadCount: 1 },
      });
    }));
    emitMessage(message, [req.user.userId, ...recipientIds], conversation.kind === 'team' ? conversation.id : null);
    if (io) {
      for (const userId of mentionUserIds) io.to(`user:${userId}`).emit('internal_mention', { message, mentionedUserId: userId });
      if (mentionTeamIds.length) {
        const mentionedMembers = await prisma.teamMember.findMany({
          where: { teamId: { in: mentionTeamIds }, team: { tenantId: req.user.tenantId } },
          select: { teamId: true, userId: true },
        });
        for (const member of mentionedMembers) {
          io.to(`user:${member.userId}`).emit('internal_mention', { message, mentionedTeamId: member.teamId });
        }
      }
    }
    return res.status(201).json(message);
  } catch (error) {
    if (!messageCreated && attachment?.path) await fs.promises.unlink(attachment.path).catch(() => {});
    console.error('[internal-chat] Falha ao enviar mensagem:', error.message);
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível enviar a mensagem interna.' });
  }
}

async function send(req, res) { return sendMessage(req, res); }

async function getThread(req, res) {
  const message = await assertMessageAccess(req, req.params.id);
  if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  const parentId = message.replyToId || message.id;
  const parent = message.replyToId ? await assertMessageAccess(req, parentId) : message;
  const replies = await prisma.internalMessage.findMany({
    where: { tenantId: req.user.tenantId, replyToId: parentId }, include: MESSAGE_INCLUDE, orderBy: { createdAt: 'asc' }, take: 200,
  });
  return res.json({ parent, replies });
}

async function setReaction(req, res) {
  const message = await assertMessageAccess(req, req.params.id);
  if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  const emoji = String(req.body?.emoji || '').trim();
  if (!emoji || emoji.length > 16) return res.status(400).json({ error: 'Reação inválida.' });
  await prisma.internalMessageReaction.upsert({
    where: { messageId_userId_emoji: { messageId: message.id, userId: req.user.userId, emoji } },
    update: {}, create: { tenantId: req.user.tenantId, messageId: message.id, userId: req.user.userId, emoji },
  });
  return reactionResponse(req, res, message);
}

async function removeReaction(req, res) {
  const message = await assertMessageAccess(req, req.params.id);
  if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  await prisma.internalMessageReaction.deleteMany({
    where: { tenantId: req.user.tenantId, messageId: message.id, userId: req.user.userId, emoji: req.params.emoji },
  });
  return reactionResponse(req, res, message);
}

async function reactionResponse(req, res, message) {
  const reactions = await prisma.internalMessageReaction.findMany({
    where: { tenantId: req.user.tenantId, messageId: message.id },
    include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' },
  });
  if (io) {
    const memberIds = message.teamId
      ? (await prisma.teamMember.findMany({
        where: { teamId: message.teamId, team: { tenantId: req.user.tenantId } }, select: { userId: true },
      })).map((member) => member.userId)
      : [message.senderId, message.receiverId];
    const rooms = [...new Set(memberIds.filter(Boolean).map((id) => `user:${id}`))];
    for (const room of rooms) io.to(room).emit('internal_message:updated', { id: message.id, reactions });
  }
  return res.json({ reactions });
}

module.exports = {
  list, send, setIo, listConversations, listConversationMessages, markRead,
  pinConversation, sendMessage, getThread, setReaction, removeReaction,
  parseConversationKey, messageWhere, resolveConversation, assertMessageAccess,
};
