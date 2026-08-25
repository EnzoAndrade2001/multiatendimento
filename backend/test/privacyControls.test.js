const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const { normalizePolicy } = require('../src/services/privacyRetentionService');
const { defaultPolicy } = require('../src/services/privacyPolicyService');
const { sanitizeMetadata, maskPhone } = require('../src/utils/privacy');
const { PROFILE_PERMISSIONS } = require('../src/auth/permissions');
const { canAccessMedia } = require('../src/controllers/mediaController');
const privacyController = require('../src/controllers/privacyController');

function responseRecorder() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

test('retencao permanece dry-run e aplica limites seguros', () => {
  assert.deepEqual(normalizePolicy({ enabled: true, dryRun: false, mediaRetentionDays: 1, auditRetentionDays: 99999 }), {
    enabled: true, dryRun: true, mediaRetentionDays: 30, auditRetentionDays: 3650,
    billingRetentionDays: 2555, agentLogRetentionDays: 30,
  });
});

test('metadados de auditoria redigem segredos e logs mascaram telefone', () => {
  assert.deepEqual(sanitizeMetadata({ token: 'abc', nested: { apiKey: 'def', allowed: 'ok' } }), {
    token: '[redacted]', nested: { apiKey: '[redacted]', allowed: 'ok' },
  });
  assert.equal(maskPhone('5551999991234'), '***1234');
});

test('privacy.manage fica restrita ao perfil administrativo por padrao', () => {
  assert.equal(PROFILE_PERMISSIONS.admin.includes('privacy.manage'), true);
  for (const profile of ['supervisor', 'agent', 'financeiro', 'tecnico']) {
    assert.equal(PROFILE_PERMISSIONS[profile].includes('privacy.manage'), false);
  }
});

test('politica padrao possui versao e finalidade obrigatoria', () => {
  const policy = defaultPolicy();
  assert.ok(policy.version);
  assert.equal(policy.purposes.some((item) => item.required), true);
});

test('acesso de midia consulta mensagem no tenant e nunca confia apenas no nome', { concurrency: false }, async () => {
  const originalMessage = prisma.message.findFirst;
  const originalRecord = prisma.externalSyncRecord.findFirst;
  prisma.message.findFirst = async ({ where }) => where.ticket.tenantId === 'tenant-ok' ? { id: 'message-1' } : null;
  prisma.externalSyncRecord.findFirst = async () => null;
  try {
    assert.deepEqual(await canAccessMedia('tenant-ok', '/uploads/media/file.pdf'), { resourceType: 'message_media', resourceId: 'message-1' });
    assert.equal(await canAccessMedia('tenant-other', '/uploads/media/file.pdf'), null);
  } finally {
    prisma.message.findFirst = originalMessage;
    prisma.externalSyncRecord.findFirst = originalRecord;
  }
});

test('aceite rejeita versao antiga e exige escopo obrigatorio', { concurrency: false }, async () => {
  const originalPolicy = prisma.privacyPolicy.findFirst;
  const originalAcceptance = prisma.privacyAcceptance.upsert;
  prisma.privacyPolicy.findFirst = async () => null;
  prisma.privacyAcceptance.upsert = async () => assert.fail('nao deveria persistir aceite invalido');
  const req = {
    user: { tenantId: 'tenant', userId: 'user' }, ip: '127.0.0.1', get: () => 'test',
    body: { policyVersion: 'versao-antiga', scopes: [] },
  };
  try {
    const oldVersion = responseRecorder();
    await privacyController.acceptPolicy(req, oldVersion);
    assert.equal(oldVersion.statusCode, 409);

    req.body = { policyVersion: defaultPolicy().version, scopes: [] };
    const missingScope = responseRecorder();
    await privacyController.acceptPolicy(req, missingScope);
    assert.equal(missingScope.statusCode, 400);
  } finally {
    prisma.privacyPolicy.findFirst = originalPolicy;
    prisma.privacyAcceptance.upsert = originalAcceptance;
  }
});
