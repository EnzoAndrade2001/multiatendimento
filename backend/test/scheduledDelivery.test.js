const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduledDeliveryService } = require('../src/services/scheduledDeliveryService');

function fixture(options = {}) {
  const clock = new Date('2026-09-12T12:00:00Z');
  const row = { id: 'schedule', tenantId: 'tenant', contactId: 'contact', instanceId: 'selected', status: 'queued', attempts: 0, sendAt: new Date(clock - 1000), body: 'Hello', ...options.row };
  let sends = 0;
  const matches = (where) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(matches);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('lt' in value) return row[key] && row[key] < value.lt;
      if ('lte' in value) return row[key] && row[key] <= value.lte;
    }
    return value === null ? row[key] == null : row[key] === value;
  });
  const prisma = {
    scheduledMessage: {
      async findMany({ where }) { return matches(where) ? [{ ...row }] : []; },
      async updateMany({ where, data }) {
        if (!matches(where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) row[key] = value?.increment ? row[key] + value.increment : value;
        return { count: 1 };
      },
    },
    contact: { async findFirst({ where }) { assert.equal(where.tenantId, 'tenant'); return { id: 'contact', phone: '5511999999999' }; } },
    waInstance: { async findFirst({ where }) { assert.deepEqual(where, { id: 'selected', tenantId: 'tenant' }); return options.missingInstance ? null : { id: 'selected', instanceName: 'chosen-provider', provider: options.provider || 'evolution_qr' }; } },
    tenantSettings: { async findUnique() { return { evolutionUrl: 'url', evolutionKey: 'secret' }; } },
    ticket: { async findFirst({ where }) { assert.equal(where.tenantId, 'tenant'); assert.equal(where.instanceId, 'selected'); return { id: 'ticket' }; } },
    message: { async create() { if (options.historyError) throw new Error('db unavailable'); } },
  };
  const service = createScheduledDeliveryService({ prisma, now: () => clock, logger: { error() {} },
    compliance: { async canAutomatedSend() { return options.blocked ? { allowed: false, code: 'WINDOW_CLOSED' } : { allowed: true }; } },
    async sendText(url, key, instanceName) { sends++; assert.equal(instanceName, 'chosen-provider'); if (options.sendError) throw options.sendError; return { key: { id: 'provider-id' } }; },
  });
  return { service, row, sends: () => sends };
}

test('concurrent workers claim and deliver a schedule exactly once', async () => {
  const f = fixture(); await Promise.all([f.service.process(), f.service.process()]);
  assert.equal(f.sends(), 1); assert.equal(f.row.status, 'sent'); assert.equal(f.row.providerMessageId, 'provider-id');
});
test('official connection respects automated sending gate', async () => {
  const f = fixture({ blocked: true, provider: 'evolution_official' }); await f.service.process();
  assert.equal(f.sends(), 0); assert.equal(f.row.status, 'blocked'); assert.match(f.row.lastError, /WINDOW_CLOSED/);
});
test('missing selected connection blocks instead of using another instance', async () => {
  const f = fixture({ missingInstance: true }); await f.service.process(); assert.equal(f.sends(), 0); assert.equal(f.row.status, 'blocked');
});
test('rate limits back off and stop after the maximum attempts', async () => {
  const f = fixture({ sendError: { response: { status: 429 } } }); await f.service.process();
  assert.equal(f.row.status, 'queued'); assert.ok(f.row.nextAttemptAt > f.row.sendAt);
  await f.service.process(); assert.equal(f.sends(), 1);
  const exhausted = fixture({ sendError: { response: { status: 429 } }, row: { attempts: 4 } });
  await exhausted.service.process(); assert.equal(exhausted.row.status, 'failed');
});
test('timeout and provider server errors are uncertain and never automatically resent', async () => {
  for (const sendError of [{ code: 'ETIMEDOUT' }, { response: { status: 500 } }]) {
    const f = fixture({ sendError }); await f.service.process(); await f.service.process();
    assert.equal(f.row.status, 'blocked'); assert.equal(f.row.deliveryUncertain, true); assert.equal(f.sends(), 1);
  }
});
test('expired durable claim blocks ambiguous delivery after worker restart', async () => {
  const f = fixture({ row: { status: 'sending', claimedAt: new Date('2026-09-12T11:00:00Z'), claimToken: 'dead-worker' } });
  await f.service.process(); assert.equal(f.row.status, 'blocked'); assert.equal(f.row.deliveryUncertain, true); assert.equal(f.sends(), 0);
});
test('local history failure does not cause external resend', async () => {
  const f = fixture({ historyError: true }); await f.service.process(); await f.service.process();
  assert.equal(f.row.status, 'sent'); assert.equal(f.sends(), 1);
});
