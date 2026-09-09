process.env.PRINTGUARD_ENCRYPTION_KEY = process.env.PRINTGUARD_ENCRYPTION_KEY || 'a'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { decryptSecret } = require('../src/services/printGuardCrypto');
const { PLUGBOLETO_REQUEST_ENTITY } = require('../src/services/plugBoletoConfigService');
const { commandCallback } = require('../src/controllers/firebirdSyncController');

const TOKEN = 'sync-token';
const TENANT = { id: 't-plug', slug: 'empresa', settings: { firebirdClientToken: TOKEN }, instances: [] };

function makeReq(id, body) {
  return {
    params: { id },
    body: { tenantSlug: TENANT.slug, ...body },
    header: (name) => (String(name).toLowerCase() === 'x-firebird-token' ? TOKEN : undefined),
  };
}
function makeRes() {
  const res = { statusCode: 200, body: undefined, status(c) { res.statusCode = c; return res; }, json(p) { res.body = p; return res; } };
  return res;
}

function patch(context, { findFirst, tenantUpdate, recordUpdate }) {
  const og = {
    tenantFind: prisma.tenant.findUnique,
    findFirst: prisma.externalSyncRecord.findFirst,
    tenantUpdate: prisma.tenantSettings.update,
    recordUpdate: prisma.externalSyncRecord.update,
  };
  context.after(() => {
    prisma.tenant.findUnique = og.tenantFind;
    prisma.externalSyncRecord.findFirst = og.findFirst;
    prisma.tenantSettings.update = og.tenantUpdate;
    prisma.externalSyncRecord.update = og.recordUpdate;
  });
  prisma.tenant.findUnique = async () => ({ ...TENANT });
  prisma.externalSyncRecord.findFirst = findFirst;
  prisma.tenantSettings.update = tenantUpdate;
  prisma.externalSyncRecord.update = recordUpdate;
}

test('callback FETCH_PLUGBOLETO_CONFIG: sucesso grava token cifrado e marca success', async (context) => {
  let settingsData = null;
  let recordData = null;
  patch(context, {
    findFirst: async (args) => (args.where.entity === PLUGBOLETO_REQUEST_ENTITY
      ? { id: 'req-1', payload: { status: 'processing' } }
      : null),
    tenantUpdate: async (args) => { settingsData = args.data; return {}; },
    recordUpdate: async (args) => { recordData = args.data; return {}; },
  });

  const res = makeRes();
  await commandCallback(makeReq('req-1', {
    success: true,
    result: { plugBoleto: { cedenteCnpj: '35.692.721/0001-94', token: 'Tok-XYZ', baseUrl: 'https://plugboleto.com.br/api/v1', printPath: '/boletos/impressao/lote' } },
  }), res);

  assert.deepEqual(res.body, { ok: true });
  assert.equal(settingsData.plugBoletoEnabled, true);
  assert.equal(settingsData.plugBoletoCedenteCnpj, '35692721000194');
  assert.equal(settingsData.plugBoletoBaseUrl, 'https://plugboleto.com.br/api/v1');
  assert.equal(decryptSecret(settingsData.plugBoletoTokenCipher), 'Tok-XYZ');
  assert.equal(recordData.payload.status, 'success');
});

test('callback FETCH_PLUGBOLETO_CONFIG: sem token -> marca failed, nao toca em settings', async (context) => {
  let settingsUpdated = false;
  let recordData = null;
  patch(context, {
    findFirst: async (args) => (args.where.entity === PLUGBOLETO_REQUEST_ENTITY
      ? { id: 'req-2', payload: { status: 'processing' } }
      : null),
    tenantUpdate: async () => { settingsUpdated = true; return {}; },
    recordUpdate: async (args) => { recordData = args.data; return {}; },
  });

  const res = makeRes();
  await commandCallback(makeReq('req-2', { success: false, error: 'Nenhuma credencial no iLux' }), res);

  assert.deepEqual(res.body, { ok: true });
  assert.equal(settingsUpdated, false);
  assert.equal(recordData.payload.status, 'failed');
  assert.match(recordData.payload.error, /Nenhuma credencial/);
});
