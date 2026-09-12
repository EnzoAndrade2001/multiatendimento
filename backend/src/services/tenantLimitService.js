const prisma = require('../lib/prisma');
const { resolveTenantEntitlements } = require('./featureEntitlementService');

const TENANT_LIMIT_FIELDS = Object.freeze({ maxUsers: 'maxUsers', maxConnections: 'maxConnections' });

async function resolveTenantLimits(tenantId, db = prisma) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { maxUsers: true, maxConnections: true } });
  if (!tenant) return null;
  const entitlements = await resolveTenantEntitlements(tenantId, db);
  const limits = { ...(entitlements?.limits || {}) };
  // Os limites históricos configurados por empresa são overrides explícitos.
  for (const [key, field] of Object.entries(TENANT_LIMIT_FIELDS)) {
    if (Number.isFinite(tenant[field]) && tenant[field] > 0) limits[key] = tenant[field];
  }
  return limits;
}

async function assertTenantLimit({ tenantId, limitKey, currentUsage, increment = 1, db = prisma }) {
  const limits = await resolveTenantLimits(tenantId, db);
  if (!limits) return { allowed: false, limit: null, usage: currentUsage };
  const limit = Number(limits[limitKey]);
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: true, limit: null, usage: currentUsage };
  return { allowed: Number(currentUsage) + increment <= limit, limit, usage: Number(currentUsage) };
}

module.exports = { resolveTenantLimits, assertTenantLimit };
