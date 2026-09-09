process.env.PRINTGUARD_ENCRYPTION_KEY = process.env.PRINTGUARD_ENCRYPTION_KEY || 'a'.repeat(64);

const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { decryptSecret } = require('../src/services/printGuardCrypto');
const { pushBatch } = require('../src/controllers/firebirdSyncController');

const TOKEN = 'push-token';
const TENANT = { id: 't-pb', slug: 'empresa', settings: { firebirdClientToken: TOKEN }, instances: [] };

function makeReq(body) {
  return {
    body: { tenantSlug: TENANT.slug, ...body },
    header: (n) => (String(n).toLowerCase() === 'x-firebird-token' ? TOKEN : undefined),
  };
}
function makeRes() {
  const res = { statusCode: 200, body: undefined, status(c) { res.statusCode = c; return res; }, json(p) { res.body = p; return res; } };
  return res;
}

// pushBatch tambem grava firebirdLastSyncAt no fim; a gente so olha a chamada
// que carrega a credencial.
function patch(context, { tokenAlreadySet = false } = {}) {
  const og = {
    find: prisma.tenant.findUnique,
    settingsFind: prisma.tenantSettings.findUnique,
    upd: prisma.tenantSettings.update,
    upsert: prisma.externalSyncRecord.upsert,
  };
  context.after(() => {
    prisma.tenant.findUnique = og.find;
    prisma.tenantSettings.findUnique = og.settingsFind;
    prisma.tenantSettings.update = og.upd;
    prisma.externalSyncRecord.upsert = og.upsert;
  });
  const updates = [];
  prisma.tenant.findUnique = async () => ({ ...TENANT });
  prisma.tenantSettings.findUnique = async () => ({ plugBoletoTokenCipher: tokenAlreadySet ? 'v1.xxx' : null });
  prisma.tenantSettings.update = async (args) => { updates.push(args.data); return {}; };
  prisma.externalSyncRecord.upsert = async () => ({});
  return updates;
}

test('pushBatch plugBoletoConfig: 1a sincronizacao cifra o token E liga a flag', async (context) => {
  const updates = patch(context, { tokenAlreadySet: false });
  const res = makeRes();
  await pushBatch(makeReq({
    entity: 'plugBoletoConfig',
    records: [{ cedenteCnpj: '35.692.721/0001-94', token: 'TOK-1', baseUrl: 'https://plugboleto.com.br/api/v1', printPath: '/boletos/impressao/lote' }],
  }), res);

  assert.equal(res.statusCode, 200);
  const credUpdate = updates.find((d) => d.plugBoletoTokenCipher);
  assert.ok(credUpdate, 'deve gravar a credencial');
  assert.equal(credUpdate.plugBoletoEnabled, true, '1a vez -> liga sozinho');
  assert.equal(credUpdate.plugBoletoCedenteCnpj, '35692721000194');
  assert.equal(decryptSecret(credUpdate.plugBoletoTokenCipher), 'TOK-1');
  assert.ok(credUpdate.plugBoletoConfigSyncedAt instanceof Date);
});

test('pushBatch plugBoletoConfig: credencial JA existia -> NAO mexe em plugBoletoEnabled (respeita o usuario)', async (context) => {
  const updates = patch(context, { tokenAlreadySet: true });
  const res = makeRes();
  await pushBatch(makeReq({
    entity: 'plugBoletoConfig',
    records: [{ cedenteCnpj: '35.692.721/0001-94', token: 'TOK-2', baseUrl: 'x', printPath: 'y' }],
  }), res);

  assert.equal(res.statusCode, 200);
  const credUpdate = updates.find((d) => d.plugBoletoTokenCipher);
  assert.ok(credUpdate, 'ainda sincroniza a credencial');
  assert.equal('plugBoletoEnabled' in credUpdate, false, 'nao sobrescreve o on/off do usuario');
  assert.equal(decryptSecret(credUpdate.plugBoletoTokenCipher), 'TOK-2');
});

test('pushBatch plugBoletoConfig: sem token nao grava credencial', async (context) => {
  const updates = patch(context);
  const res = makeRes();
  await pushBatch(makeReq({ entity: 'plugBoletoConfig', records: [{ cedenteCnpj: '123', token: '' }] }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(updates.find((d) => d.plugBoletoTokenCipher), undefined);
});
