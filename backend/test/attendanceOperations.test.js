const test = require('node:test');
const assert = require('node:assert/strict');
const { dueAt, selectRule, chooseAgent, processTenant } = require('../src/services/attendanceOperationsService');

test('SLA counts only business hours over a weekend in Sao Paulo', () => {
  const hours = [1,2,3,4,5].map(dayOfWeek => ({ dayOfWeek, active: true, start: '09:00', end: '18:00' }));
  assert.equal(dueAt('2026-09-11T20:30:00Z', 60, hours, true).toISOString(), '2026-09-14T12:30:00.000Z');
  assert.equal(dueAt('2026-09-11T20:30:00Z', 60, [], true), null);
});
test('SLA chooses team and priority before fallbacks', () => {
  const rules = [{ minutes: 60 }, { teamId: 'a', minutes: 40 }, { teamId: 'a', priority: 'urgent', minutes: 10 }];
  assert.equal(selectRule(rules, { teamId: 'a', priority: 'urgent' }).minutes, 10);
  assert.equal(selectRule(rules, { teamId: 'b', priority: 'urgent' }).minutes, 60);
});
test('assignment excludes stale, unavailable, other-team, unauthorized and full users', () => {
  const now = new Date();
  const user = id => ({ id, active: true, attendanceAvailable: true, attendanceHeartbeatAt: now, role: 'agent', teamMembers: [{ teamId: 'a' }] });
  const users = [ { ...user('stale'), attendanceHeartbeatAt: new Date(now - 180000) }, { ...user('away'), attendanceAvailable: false }, { ...user('other'), teamMembers: [] }, { ...user('unauthorized'), accessProfile: 'personalizado', permissions: [] }, user('full'), user('eligible') ];
  assert.equal(chooseAgent(users, { teamId: 'a' }, new Map([['full', 2]]), { maxActiveTickets: 2 }, now).id, 'eligible');
});
test('tenant processing clears fulfilled SLA and does not alert after response', async () => {
  const now = new Date('2026-09-12T15:00:00Z');
  const writes = []; const events = [];
  const ticket = { id: 't', tenantId: 'tenant', status: 'open', createdAt: new Date(now - 600000), sessionStartedAt: new Date(now - 600000), firstResponseAt: new Date(now - 300000), slaDueAt: new Date(now - 60000), slaBreachedAt: new Date(now - 400000), updatedAt: now };
  const tx = {
    $queryRaw: async () => [],
    attendancePolicy: { findUnique: async () => ({ slaEnabled: true, assignmentEnabled: false, rules: [{ minutes: 1, warningMinutes: 0, businessHours: false }] }) },
    ticket: { findMany: async () => [ticket], updateMany: async args => { writes.push(args); return { count: 1 }; } },
    businessHour: { findMany: async () => [] },
    ticketEvent: { create: async args => events.push(args) },
  };
  await processTenant('tenant', null, { $transaction: fn => fn(tx) }, now);
  assert.equal(writes[0].data.slaDueAt, null);
  assert.equal(writes[0].where.tenantId, 'tenant');
  assert.equal(Object.hasOwn(writes[0].data, 'slaBreachedAt'), false, 'preserve historical breach after reply or policy edits');
  assert.equal(events.length, 0);
});

test('allocator reserves capacity within a batch and ignores contested writes', async () => {
  const now = new Date(); const events = []; const writes = [];
  const tickets = ['one', 'two'].map(id => ({ id, tenantId: 'tenant', status: 'pending', createdAt: now, updatedAt: now, firstResponseAt: null, agentId: null }));
  const tx = {
    $queryRaw: async () => [],
    attendancePolicy: { findUnique: async () => ({ assignmentEnabled: true, maxActiveTickets: 1 }) },
    user: { findMany: async () => [{ id: 'agent', active: true, role: 'agent', attendanceAvailable: true, attendanceHeartbeatAt: now, teamMembers: [] }] },
    ticket: { findMany: async () => tickets, updateMany: async args => { writes.push(args); return { count: 1 }; } },
    ticketEvent: { create: async args => events.push(args) },
  };
  await processTenant('tenant', null, { $transaction: fn => fn(tx) }, now);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].data.agentId, 'agent');
  assert.equal(events[0].data.type, 'auto_assigned');
  assert.equal(writes[0].where.updatedAt, now);
});

test('SLA warning and breach emit once across repeated scans', async () => {
  const now = new Date('2026-09-12T15:00:00Z'); const events = [];
  const ticket = { id: 'ticket', tenantId: 'tenant', status: 'pending', createdAt: new Date(now - 55 * 60000), updatedAt: now, firstResponseAt: null };
  const tx = {
    $queryRaw: async () => [],
    attendancePolicy: { findUnique: async () => ({ slaEnabled: true, rules: [{ minutes: 60, warningMinutes: 10, businessHours: false }] }) },
    businessHour: { findMany: async () => [] },
    ticket: { findMany: async () => [{ ...ticket }], updateMany: async ({ data }) => { Object.assign(ticket, data); return { count: 1 }; } },
    ticketEvent: { create: async ({ data }) => events.push(data.type) },
  };
  const db = { $transaction: fn => fn(tx) };
  await processTenant('tenant', null, db, now);
  await processTenant('tenant', null, db, now);
  await processTenant('tenant', null, db, new Date(now.getTime() + 6 * 60000));
  await processTenant('tenant', null, db, new Date(now.getTime() + 7 * 60000));
  assert.deepEqual(events, ['sla_warning', 'sla_breached']);
});
