const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { mediaPath } = require('../utils/uploads');
const { recordPrivacyAudit } = require('../services/privacyAuditService');

async function canAccessMedia(tenantId, mediaUrl) {
  const message = await prisma.message.findFirst({
    where: { mediaUrl, ticket: { tenantId } }, select: { id: true },
  });
  if (message) return { resourceType: 'message_media', resourceId: message.id };
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
  const access = await canAccessMedia(req.user.tenantId, mediaUrl);
  if (!access) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  const filePath = path.resolve(mediaPath, filename);
  if (!filePath.startsWith(`${path.resolve(mediaPath)}${path.sep}`) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }
  await recordPrivacyAudit(req, { action: 'MEDIA_ACCESS', ...access, metadata: { filenameHash: require('../utils/privacy').fingerprint(filename) } });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(filePath);
}

module.exports = { downloadMedia, canAccessMedia };
