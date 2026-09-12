const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTenantLimits, assertTenantLimit } = require('../src/services/tenantLimitService');

function dbFixture({ maxUsers = 5, maxConnections = 1, planLimits = {} } = {}) {
  return {
    tenant: { findUnique: async ({ select }) => select?.plan ? { id: 't1', plan: 'professional' } : { maxUsers, maxConnections } },
    feature: { findMany: async () => [] },
    productPlan: { findUnique: async () => ({ id: 'p1', code: 'professional', name: 'Profissional', limits: planLimits, features: [] }) },
    tenantFeatureOverride: { findMany: async () => [] },
  };
}

test('limites históricos do tenant prevalecem sobre padrão do plano', async () => {
  const limits = await resolveTenantLimits('t1', dbFixture({ maxUsers: 7, maxConnections: 2, planLimits: { maxUsers: 10, maxConnections: 5, maxCampaignContacts: 1000 } }));
  assert.deepEqual(limits, { maxUsers: 7, maxConnections: 2, maxCampaignContacts: 1000 });
});

test('enforcement considera o incremento antes de permitir criação', async () => {
  const db = dbFixture({ maxUsers: 5 });
  assert.equal((await assertTenantLimit({ tenantId: 't1', limitKey: 'maxUsers', currentUsage: 4, db })).allowed, true);
  const denied = await assertTenantLimit({ tenantId: 't1', limitKey: 'maxUsers', currentUsage: 5, db });
  assert.equal(denied.allowed, false);
  assert.equal(denied.limit, 5);
});

test('limite ausente representa uso ilimitado', async () => {
  const result = await assertTenantLimit({ tenantId: 't1', limitKey: 'maxKnowledgeDocuments', currentUsage: 999, db: dbFixture() });
  assert.equal(result.allowed, true);
  assert.equal(result.limit, null);
});
