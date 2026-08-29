const prisma = require('../lib/prisma');
const { sanitizeMetadata } = require('../utils/privacy');

async function recordPrivacyAudit(req, { action, resourceType, resourceId, status = 'SUCCESS', metadata }) {
  try {
    return await prisma.privacyAuditLog.create({
      data: {
        tenantId: req.user.tenantId,
        actorId: req.user.userId || null,
        action,
        resourceType,
        resourceId: resourceId || null,
        status,
        ipAddress: String(req.ip || '').slice(0, 100) || null,
        userAgent: String(req.get?.('user-agent') || '').slice(0, 500) || null,
        metadata: sanitizeMetadata(metadata || {}),
      },
    });
  } catch (error) {
    console.error(`[privacy-audit] Falha ao registrar ${action}: ${error.message}`);
    return null;
  }
}

// Igual ao recordPrivacyAudit, mas sem depender de `req` — para eventos
// disparados fora de uma requisição HTTP (webhooks, workers, opt-out do cliente).
async function recordPrivacyAuditRaw({ tenantId, actorId = null, action, resourceType, resourceId, status = 'SUCCESS', metadata }) {
  try {
    return await prisma.privacyAuditLog.create({
      data: {
        tenantId,
        actorId: actorId || null,
        action,
        resourceType,
        resourceId: resourceId || null,
        status,
        ipAddress: null,
        userAgent: null,
        metadata: sanitizeMetadata(metadata || {}),
      },
    });
  } catch (error) {
    console.error(`[privacy-audit] Falha ao registrar ${action}: ${error.message}`);
    return null;
  }
}

module.exports = { recordPrivacyAudit, recordPrivacyAuditRaw };
