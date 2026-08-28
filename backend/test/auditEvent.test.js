const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const {
  MAX_METADATA_BYTES,
  buildAuditData,
  recordAuditEvent,
  sanitizeAuditMetadata,
} = require('../src/services/auditEventService');

test('auditoria central deriva contexto da requisição e redige segredos', () => {
  const req = {
    user: { tenantId: 'tenant-1', userId: 'user-1' },
    ip: '127.0.0.1',
    path: '/api/contacts/1',
    get: (name) => name === 'user-agent' ? 'test-agent' : null,
  };
  const data = buildAuditData(req, {
    action: 'CONTACT_UPDATE',
    resourceType: 'contact',
    resourceId: 'contact-1',
    metadata: { changed: ['name'], token: 'must-not-be-stored' },
  });

  assert.equal(data.tenantId, 'tenant-1');
  assert.equal(data.actorId, 'user-1');
  assert.equal(data.ipAddress, '127.0.0.1');
  assert.equal(data.userAgent, 'test-agent');
  assert.match(data.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(data.metadata, { changed: ['name'], token: '[redacted]' });
});

test('auditoria rejeita contexto incompleto sem lançar excecao', () => {
  assert.equal(buildAuditData({}, { action: 'ANYTHING', resourceType: 'thing' }), null);
  assert.equal(buildAuditData({ user: { tenantId: 'tenant-1' } }, { resourceType: 'thing' }), null);
});

test('metadata da auditoria permanece limitada e serializavel', () => {
  const oversized = sanitizeAuditMetadata({ payload: Array.from({ length: 50 }, () => ({ value: Array.from({ length: 50 }, () => 'x'.repeat(500)) })) });
  assert.equal(oversized.truncated, true);
  assert.equal(oversized.reason, 'metadata_size_limit');
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), 'utf8') < MAX_METADATA_BYTES);
});

test('falha ao gravar auditoria nao propaga erro para o fluxo', { concurrency: false }, async () => {
  const originalCreate = prisma.auditEvent.create;
  prisma.auditEvent.create = async () => { throw new Error('database unavailable'); };
  try {
    const result = await recordAuditEvent({ user: { tenantId: 'tenant-1', userId: 'user-1' } }, {
      action: 'TEST', resourceType: 'test',
    });
    assert.equal(result, null);
  } finally {
    prisma.auditEvent.create = originalCreate;
  }
});
