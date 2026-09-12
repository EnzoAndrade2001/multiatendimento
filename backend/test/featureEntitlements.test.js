const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLimits, resolveTenantEntitlements, hasFeature } = require('../src/services/featureEntitlementService');

function dbFixture({ plan = null, catalog = [], overrides = [] } = {}) {
  return {
    tenant: { findUnique: async () => ({ id: 't1', plan: 'professional' }) },
    feature: { findMany: async () => catalog },
    productPlan: { findUnique: async () => plan },
    tenantFeatureOverride: { findMany: async () => overrides },
  };
}

test('tenant legado sem catálogo mantém acesso permissivo', async () => {
  const db = dbFixture();
  const result = await resolveTenantEntitlements('t1', db);
  assert.equal(result.permissive, true);
  assert.equal(await hasFeature('t1', 'crm', db), true);
});

test('plano configurado bloqueia recurso ausente e combina limites', async () => {
  const crm = { id: 'f1', key: 'crm', name: 'CRM', category: 'negocio', active: true };
  const ia = { id: 'f2', key: 'ai_bot', name: 'IA', category: 'automacao', active: true };
  const db = dbFixture({ catalog: [crm, ia], plan: { id: 'p1', code: 'professional', name: 'Profissional', limits: { maxUsers: 10 }, features: [{ feature: crm, enabled: true, limits: { daily: 20 } }] } });
  assert.equal(await hasFeature('t1', 'crm', db), true);
  assert.equal(await hasFeature('t1', 'ai_bot', db), false);
  const result = await resolveTenantEntitlements('t1', db);
  assert.equal(result.limits.maxUsers, 10);
});

test('override prevalece sobre plano sem apagar limites do plano', async () => {
  const feature = { id: 'f1', key: 'crm', name: 'CRM', category: 'negocio', active: true };
  const db = dbFixture({ catalog: [feature], plan: { id: 'p1', code: 'professional', name: 'Profissional', limits: {}, features: [{ feature, enabled: false, limits: { daily: 20 } }] }, overrides: [{ feature, enabled: true, limits: { monthly: 200 } }] });
  const result = await resolveTenantEntitlements('t1', db);
  assert.deepEqual(result.features[0].limits, { daily: 20, monthly: 200 });
  assert.equal(result.features[0].source, 'override');
  assert.equal(await hasFeature('t1', 'crm', db), true);
});

test('limites rejeitam arrays', () => assert.throws(() => normalizeLimits([]), /objeto/));
