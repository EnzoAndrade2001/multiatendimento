const prisma = require('../lib/prisma');

const FEATURE_KEY_RE = /^[a-z][a-z0-9_.-]{1,79}$/;

function normalizeLimits(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Limites devem ser um objeto.');
  return value;
}

async function resolveTenantEntitlements(tenantId, db = prisma) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, plan: true } });
  if (!tenant) return null;
  const [catalog, plan, overrides] = await Promise.all([
    db.feature.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    db.productPlan.findUnique({ where: { code: tenant.plan }, include: { features: { include: { feature: true } } } }),
    db.tenantFeatureOverride.findMany({ where: { tenantId }, include: { feature: true } }),
  ]);
  // Compatibilidade: catálogo/planos ainda não inicializados nunca revogam acesso existente.
  const permissive = catalog.length === 0 || !plan;
  const map = new Map(catalog.map((feature) => [feature.key, {
    key: feature.key, name: feature.name, category: feature.category,
    enabled: permissive, limits: {}, source: permissive ? 'legacy' : 'plan',
  }]));
  for (const item of plan?.features || []) {
    if (!item.feature.active) continue;
    map.set(item.feature.key, { key: item.feature.key, name: item.feature.name, category: item.feature.category,
      enabled: item.enabled, limits: normalizeLimits(item.limits), source: 'plan' });
  }
  for (const override of overrides) {
    const current = map.get(override.feature.key) || { key: override.feature.key, name: override.feature.name, category: override.feature.category, enabled: permissive, limits: {}, source: 'legacy' };
    const overrideLimits = normalizeLimits(override.limits);
    const hasOverride = override.enabled != null || Object.keys(overrideLimits).length > 0;
    map.set(override.feature.key, { ...current,
      enabled: override.enabled == null ? current.enabled : override.enabled,
      limits: { ...current.limits, ...overrideLimits }, source: hasOverride ? 'override' : current.source });
  }
  return { tenantId, planCode: tenant.plan, plan: plan ? { id: plan.id, code: plan.code, name: plan.name } : null,
    permissive, limits: { ...normalizeLimits(plan?.limits) }, features: [...map.values()] };
}

async function hasFeature(tenantId, key, db = prisma) {
  const resolved = await resolveTenantEntitlements(tenantId, db);
  if (!resolved) return false;
  if (resolved.permissive && !resolved.features.some((f) => f.key === key)) return true;
  return resolved.features.some((feature) => feature.key === key && feature.enabled);
}

module.exports = { FEATURE_KEY_RE, normalizeLimits, resolveTenantEntitlements, hasFeature };
