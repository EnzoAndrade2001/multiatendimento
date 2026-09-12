const test = require('node:test');
const assert = require('node:assert/strict');
const prismaPath = require.resolve('../src/lib/prisma');
const prisma = {};
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: prisma };
const controller = require('../src/controllers/scheduledMessageController');
function response() { return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, sendStatus(n) { this.statusCode = n; return this; } }; }
test('creation rejects foreign tenant contact and never inserts', async () => {
  prisma.contact = { async findFirst({ where }) { assert.equal(where.tenantId, 'ours'); return null; } };
  prisma.waInstance = { async findFirst({ where }) { assert.equal(where.tenantId, 'ours'); return { provider: 'evolution_qr', instanceName: 'ours' }; } };
  prisma.scheduledMessage = { async create() { assert.fail('must not insert'); } };
  const res = response();
  await controller.schedule({ user: { tenantId: 'ours' }, body: { contactId: 'foreign', instanceId: 'instance', body: 'hello', sendAt: '2099-01-01T12:00:00Z' } }, res);
  assert.equal(res.statusCode, 404);
});
test('uncertain retry needs explicit acknowledgement', async () => {
  prisma.scheduledMessage = { async findFirst({ where }) { assert.equal(where.tenantId, 'ours'); return { id: 'id', deliveryUncertain: true }; }, async updateMany() { assert.fail('must not requeue'); } };
  const res = response(); await controller.retry({ user: { tenantId: 'ours' }, params: { id: 'id' }, body: {} }, res);
  assert.equal(res.statusCode, 409); assert.equal(res.body.requiresConfirmation, true);
});
test('cancellation atomically excludes messages being sent and keeps audit history', async () => {
  prisma.scheduledMessage = { async updateMany({ where, data }) { assert.equal(where.tenantId, 'ours'); assert.ok(!where.status.in.includes('sending')); assert.equal(data.status, 'cancelled'); return { count: 0 }; } };
  const res = response(); await controller.remove({ user: { tenantId: 'ours' }, params: { id: 'id' } }, res); assert.equal(res.statusCode, 409);
});
