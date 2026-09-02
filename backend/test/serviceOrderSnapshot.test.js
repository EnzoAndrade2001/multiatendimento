const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { pushBatch } = require('../src/controllers/firebirdSyncController');

const TOKEN = 'agente-token-teste';
const TENANT = {
  id: 'tenant-snapshot',
  slug: 'lcd',
  settings: { firebirdClientToken: TOKEN },
  instances: [{ id: 'instance-1', status: 'connected' }],
};

test('snapshot autoritativo fecha no cache O.S. que saiu da IXLOS aberta', async (context) => {
  const originals = {
    tenantFindUnique: prisma.tenant.findUnique,
    tenantSettingsUpdate: prisma.tenantSettings.update,
    externalSyncRecordFindMany: prisma.externalSyncRecord.findMany,
    externalSyncRecordUpdate: prisma.externalSyncRecord.update,
  };
  context.after(() => {
    prisma.tenant.findUnique = originals.tenantFindUnique;
    prisma.tenantSettings.update = originals.tenantSettingsUpdate;
    prisma.externalSyncRecord.findMany = originals.externalSyncRecordFindMany;
    prisma.externalSyncRecord.update = originals.externalSyncRecordUpdate;
  });

  prisma.tenant.findUnique = async () => TENANT;
  prisma.tenantSettings.update = async () => ({});
  prisma.externalSyncRecord.findMany = async () => ([
    { id: 'cached-open', externalId: '1', payload: { raw: { status: 'E' } } },
    { id: 'still-open', externalId: '2', payload: { raw: { status: 'E' } } },
    { id: 'already-closed', externalId: '3', payload: { raw: { status: 'O' } } },
  ]);
  let updateArgs = null;
  prisma.externalSyncRecord.update = async (args) => { updateArgs = args; return {}; };

  const req = {
    body: {
      tenantSlug: 'lcd',
      entity: 'serviceOrdersOpenSnapshot',
      records: [{ completeWindow: true, count: 1, externalIds: ['2'], capturedAt: '2026-09-02T19:00:00' }],
    },
    header(name) { return name.toLowerCase() === 'x-firebird-token' ? TOKEN : undefined; },
  };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await pushBatch(req, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.stats.reconciled, 1);
  assert.equal(updateArgs.where.id, 'cached-open');
  assert.equal(updateArgs.data.payload.raw.status, 'O');
  assert.equal(updateArgs.data.payload.sourceReconciledClosed, true);
});
