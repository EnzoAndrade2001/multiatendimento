const prisma = require('../lib/prisma');

const LIMITS = Object.freeze({ min: 30, max: 3650 });

function normalizePolicy(input = {}) {
  const days = (value, fallback) => Math.max(LIMITS.min, Math.min(LIMITS.max, Number.parseInt(value, 10) || fallback));
  return {
    enabled: Boolean(input.enabled),
    // Execução destrutiva permanece bloqueada nesta versão; preview é obrigatório.
    dryRun: true,
    mediaRetentionDays: days(input.mediaRetentionDays, 365),
    auditRetentionDays: days(input.auditRetentionDays, 730),
    billingRetentionDays: days(input.billingRetentionDays, 2555),
    agentLogRetentionDays: days(input.agentLogRetentionDays, 30),
  };
}

async function previewRetention(tenantId, policy) {
  const now = Date.now();
  const before = (days) => new Date(now - days * 86400000);
  const [mediaMessages, audits, billingLogs] = await Promise.all([
    prisma.message.count({ where: { ticket: { tenantId }, mediaUrl: { not: null }, createdAt: { lt: before(policy.mediaRetentionDays) } } }),
    prisma.privacyAuditLog.count({ where: { tenantId, createdAt: { lt: before(policy.auditRetentionDays) } } }),
    prisma.billingLog.count({ where: { tenantId, sentAt: { lt: before(policy.billingRetentionDays) } } }),
  ]);
  return { mediaMessages, audits, billingLogs, destructiveExecutionEnabled: false };
}

module.exports = { LIMITS, normalizePolicy, previewRetention };
