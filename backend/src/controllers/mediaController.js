const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { mediaPath } = require('../utils/uploads');
const { recordPrivacyAudit } = require('../services/privacyAuditService');
const { hasPermission } = require('../auth/permissions');

async function canAccessMedia(tenantId, mediaUrl, userId = null, allowAllTeams = false) {
  const message = await prisma.message.findFirst({
    where: { mediaUrl, ticket: { tenantId } }, select: { id: true },
  });
  if (message) return { resourceType: 'message_media', resourceId: message.id };
  const internalMessage = userId ? await prisma.internalMessage.findFirst({
    where: {
      tenantId, attachmentUrl: mediaUrl,
      OR: [
        { senderId: userId },
        { receiverId: userId },
        allowAllTeams ? { teamId: { not: null } } : { team: { members: { some: { userId } } } },
      ],
    },
    select: { id: true, attachmentName: true, attachmentMimeType: true },
  }) : null;
  if (internalMessage) return {
    resourceType: 'internal_message_attachment', resourceId: internalMessage.id,
    originalName: internalMessage.attachmentName, mimeType: internalMessage.attachmentMimeType,
  };
  const document = await prisma.externalSyncRecord.findFirst({
    where: {
      tenantId, entity: 'billingDocumentRequest',
      payload: { path: ['mediaUrl'], equals: mediaUrl },
    },
    select: { id: true },
  });
  return document ? { resourceType: 'billing_document', resourceId: document.id } : null;
}

async function downloadMedia(req, res) {
  const filename = path.basename(String(req.params.filename || ''));
  if (!filename || filename !== req.params.filename) return res.status(400).json({ error: 'Arquivo inválido.' });
  const mediaUrl = `/uploads/media/${filename}`;
  const access = await canAccessMedia(req.user.tenantId, mediaUrl, req.user.userId, hasPermission(req.user, 'teams.manage'));
  if (!access) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const filePath = path.resolve(mediaPath, filename);
  if (!filePath.startsWith(`${path.resolve(mediaPath)}${path.sep}`) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  await recordPrivacyAudit(req, { action: 'MEDIA_ACCESS', ...access, metadata: { filenameHash: require('../utils/privacy').fingerprint(filename) } });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (access.mimeType) res.type(access.mimeType);
  if (access.originalName) {
    const encodedName = encodeURIComponent(access.originalName).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedName}`);
  }
  return res.sendFile(filePath);
}

module.exports = { downloadMedia, canAccessMedia };
