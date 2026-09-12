const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskService } = require('../src/services/attendanceTaskService');
const user = { tenantId: 'tenant-a', userId: 'agent-a', permissions: ['inbox.view', 'inbox.assign', 'crm.view'] };
function mockDb() {
  const calls = {};
  return {
    calls,
    $queryRaw: async query => { calls.raw = query; return []; },
    team: { findMany: async args => { calls.teams = args; return [{ id: 'team-a' }]; } },
    teamMember: { findFirst: async () => ({ id: 'membership' }) },
    user: { findFirst: async args => { calls.assignee = args; return { id: 'agent-a' }; }, findMany: async () => [] },
    contact: { findFirst: async args => { calls.contact = args; return null; }, findMany: async () => [] },
    ticket: { findFirst: async args => { calls.ticket = args; return null; }, findMany: async args => { calls.waiting = args; return []; } },
    serviceOrder: { findFirst: async () => null, findMany: async () => [] },
    attendanceTask: {
      create: async args => { calls.create = args; return { id: 'task-a', ...args.data }; },
      findMany: async args => { calls.list = args; return []; },
      count: async () => 0,
      findFirst: async args => { calls.find = args; return null; },
      updateMany: async args => { calls.update = args; return { count: 1 }; },
    },
  };
}
test('personal tasks constrain tenant and assignee; team scope constrains memberships', async () => {
  const db = mockDb(), service = createTaskService(db);
  await service.list(user);
  assert.equal(db.calls.list.where.tenantId, user.tenantId);
  assert.equal(db.calls.list.where.assigneeId, user.userId);
  await service.list(user, { scope: 'team' });
  assert.deepEqual(db.calls.list.where.OR, [{ assigneeId: 'agent-a' }, { createdById: 'agent-a' }, { teamId: { in: ['team-a'] } }]);
  assert.equal(db.calls.teams.where.tenantId, 'tenant-a');
});
test('callbacks require valid dates and assignment cannot escape tenant/team', async () => {
  const db = mockDb(), service = createTaskService(db);
  await assert.rejects(service.create(user, { title: 'Retornar', kind: 'callback' }), /prazo/);
  await assert.rejects(service.create(user, { title: 'Retornar', dueAt: 'invalid' }), /Prazo/);
  await assert.rejects(service.create(user, { title: 'Retornar', teamId: 'other-team' }), { statusCode: 403 });
  await service.create(user, { title: 'Retornar', assigneeId: 'agent-b' });
  assert.equal(db.calls.assignee.where.tenantId, 'tenant-a');
  assert.deepEqual(db.calls.assignee.where.teamMembers, { some: { teamId: { in: ['team-a'] } } });
});
test('assignment requires permission and membership in selected team', async () => {
  const db = mockDb(), service = createTaskService(db);
  await assert.rejects(service.create({ ...user, permissions: ['inbox.view'] }, { title: 'Retornar', assigneeId: 'agent-b' }), { statusCode: 403 });
  db.teamMember.findFirst = async () => null;
  await assert.rejects(service.create(user, { title: 'Retornar', teamId: 'team-a' }), /pertencer/);
});
test('cross tenant links are rejected and protected ticket visibility is applied', async () => {
  const db = mockDb(), service = createTaskService(db);
  await assert.rejects(service.create(user, { title: 'Retornar', contactId: 'foreign' }), { statusCode: 404 });
  assert.equal(db.calls.contact.where.tenantId, 'tenant-a');
  await assert.rejects(service.create(user, { title: 'Retornar', ticketId: 'private' }), { statusCode: 404 });
  assert.ok(db.calls.ticket.where.OR.length);
  assert.equal(db.calls.create, undefined);
});
test('inconsistent client, conversation and OS relations are rejected', async () => {
  const db = mockDb(), service = createTaskService(db);
  db.contact.findFirst = async () => ({ id: 'contact-a' });
  db.ticket.findFirst = async () => ({ id: 'ticket-a', contactId: 'contact-b' });
  await assert.rejects(service.create(user, { title: 'Retornar', contactId: 'contact-a', ticketId: 'ticket-a' }), /cliente/);
});
test('creation whitelists fields; completion timestamps are persisted and cleared on reopening', async () => {
  const db = mockDb(), service = createTaskService(db);
  const created = await service.create(user, { title: '  Retornar  ', tenantId: 'foreign', createdById: 'foreign', status: 'done' });
  assert.equal(created.title, 'Retornar');
  assert.equal(created.tenantId, 'tenant-a');
  assert.equal(created.createdById, 'agent-a');
  assert.ok(created.completedAt instanceof Date);
  db.attendanceTask.findFirst = async () => created;
  await service.update(user, 'task-a', { status: 'open' });
  assert.equal(db.calls.update.data.completedAt, null);
  assert.equal(db.calls.update.where.tenantId, 'tenant-a');
  assert.ok(db.calls.update.where.OR);
});
test('inaccessible task cannot be updated', async () => {
  const db = mockDb(), service = createTaskService(db);
  await assert.rejects(service.update(user, 'foreign-task', { status: 'done' }), { statusCode: 404 });
  assert.equal(db.calls.update, undefined);
});
test('overdue filter excludes completed tasks and pagination is bounded', async () => {
  const db = mockDb(), service = createTaskService(db);
  await service.list(user, { overdue: 'true', status: 'all', page: '-1' });
  assert.deepEqual(db.calls.list.where.status, { in: ['open', 'in_progress'] });
  assert.ok(db.calls.list.where.dueAt.lt instanceof Date);
  assert.equal(db.calls.list.skip, 0);
  assert.equal(db.calls.list.take, 50);
});
test('waiting list filters the latest message before LIMIT and exposes no message bodies', async () => {
  const db = mockDb(), service = createTaskService(db);
  db.$queryRaw = async query => { db.calls.raw = query; return [{ id: 'waiting', waitingSince: new Date() }]; };
  db.ticket.findMany = async args => { db.calls.waiting = args; return [{ id: 'waiting' }]; };
  const result = await service.waiting(user);
  assert.deepEqual(result.items.map(t => t.id), ['waiting']);
  assert.equal(result.items[0].messages, undefined);
  assert.equal(db.calls.waiting.where.tenantId, 'tenant-a');
  assert.ok(db.calls.raw.values.includes('agent-a'));
  assert.ok(db.calls.raw.values.includes('tenant-a'));
  assert.match(db.calls.raw.sql, /latest\."fromMe" = false[\s\S]*LIMIT 101/);
  assert.match(db.calls.raw.sql, /JOIN LATERAL/);
});
