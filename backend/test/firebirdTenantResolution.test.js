const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { resolveTenantContext } = require('../src/controllers/firebirdSyncController');

const TOKEN = 'tenant-token-resolucao';
const TENANT = {
  id: 'tenant-token-1',
  slug: 'empresa-token',
  settings: { firebirdClientToken: TOKEN },
  instances: [{ id: 'instance-1', status: 'connected' }],
};

function requestWithToken(token = TOKEN) {
  return {
    header(name) {
      return name.toLowerCase() === 'x-firebird-token' ? token : undefined;
    },
  };
}

test('resolve o tenant pelo token quando o agente antigo nao envia slug', async (context) => {
  const originalFindMany = prisma.tenantSettings.findMany;
  context.after(() => {
    prisma.tenantSettings.findMany = originalFindMany;
  });

  prisma.tenantSettings.findMany = async () => [{ tenant: TENANT }];

  const result = await resolveTenantContext('', requestWithToken());
  assert.equal(result.tenant.id, TENANT.id);
  assert.equal(result.tenant.slug, TENANT.slug);
  assert.equal(result.instance.id, 'instance-1');
});

test('falha fechado se o token estiver associado a mais de um tenant', async (context) => {
  const originalFindMany = prisma.tenantSettings.findMany;
  context.after(() => {
    prisma.tenantSettings.findMany = originalFindMany;
  });

  prisma.tenantSettings.findMany = async () => [{ tenant: TENANT }, { tenant: { ...TENANT, id: 'tenant-token-2' } }];

  await assert.rejects(
    () => resolveTenantContext('', requestWithToken()),
    (error) => error.statusCode === 409 && /mais de uma empresa/.test(error.message),
  );
});
