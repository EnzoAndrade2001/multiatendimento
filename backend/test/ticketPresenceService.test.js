const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { heartbeat, leave, validateSession } = require('../src/services/ticketPresenceService');

const USER = { tenantId: 't1', userId: 'u1' };
const SESSION = 'abcdefghijklmnop';

function patch(context, { rows = [] } = {}) {
  const originals = {
    upsert: prisma.ticketPresence.upsert,
    deleteMany: prisma.ticketPresence.deleteMany,
    findMany: prisma.ticketPresence.findMany,
  };
  const calls = { upsert: [], deleteMany: [], findMany: [] };
  context.after(() => {
    prisma.ticketPresence.upsert = originals.upsert;
    prisma.ticketPresence.deleteMany = originals.deleteMany;
    prisma.ticketPresence.findMany = originals.findMany;
  });
  prisma.ticketPresence.upsert = async (args) => { calls.upsert.push(args); return { id: 'p1' }; };
  prisma.ticketPresence.deleteMany = async (args) => { calls.deleteMany.push(args); return { count: 0 }; };
  prisma.ticketPresence.findMany = async (args) => { calls.findMany.push(args); return rows; };
  return calls;
}

test('validateSession rejeita sessao mal formada', () => {
  assert.throws(() => validateSession({ sessionId: 'curta' }), /inválida/);
  assert.throws(() => validateSession({}), /inválida/);
  assert.doesNotThrow(() => validateSession({ sessionId: SESSION }));
});

test('heartbeat grava presenca por (userId, sessionId) e varre linhas velhas do tenant', async (context) => {
  const now = new Date('2026-09-12T12:00:00-03:00');
  const calls = patch(context, { rows: [] });
  const result = await heartbeat(prisma, USER, 'ticket1', { sessionId: SESSION }, now);
  assert.equal(calls.upsert[0].where.userId_sessionId.userId, 'u1');
  assert.equal(calls.upsert[0].where.userId_sessionId.sessionId, SESSION);
  assert.equal(calls.upsert[0].create.ticketId, 'ticket1');
  assert.deepEqual(calls.deleteMany[0].where.tenantId, 't1');
  assert.ok(calls.deleteMany[0].where.lastSeenAt.lt < now);
  assert.deepEqual(result.viewers, []);
});

test('heartbeat nunca inclui a propria sessao entre os viewers', async (context) => {
  patch(context, { rows: [] });
  await heartbeat(prisma, USER, 'ticket1', { sessionId: SESSION });
  // A query de leitura exclui explicitamente o proprio usuario - garantido pelo filtro enviado ao banco.
  const calls = patch(context, { rows: [] });
  await heartbeat(prisma, USER, 'ticket1', { sessionId: SESSION });
  assert.equal(calls.findMany[0].where.userId.not, 'u1');
  assert.equal(calls.findMany[0].where.user.active, true);
});

test('heartbeat marca typing/sending so quando ainda nao expirou, e agrega por usuario', async (context) => {
  const now = new Date('2026-09-12T12:00:00-03:00');
  patch(context, {
    rows: [
      { userId: 'u2', typingUntil: new Date(now.getTime() + 1000), sendingUntil: null, user: { name: 'Ana' } },
      { userId: 'u2', typingUntil: null, sendingUntil: new Date(now.getTime() - 1000), user: { name: 'Ana' } }, // sessao velha do mesmo usuario, ja expirada
      { userId: 'u3', typingUntil: null, sendingUntil: null, user: { name: 'Bia' } },
    ],
  });
  const result = await heartbeat(prisma, USER, 'ticket1', { sessionId: SESSION }, now);
  const ana = result.viewers.find((v) => v.id === 'u2');
  const bia = result.viewers.find((v) => v.id === 'u3');
  assert.equal(ana.typing, true);
  assert.equal(ana.sending, false); // a sessao com sendingUntil ja expirou
  assert.equal(bia.typing, false);
  assert.equal(bia.sending, false);
});

test('leave remove somente a sessao do proprio usuario, escopada ao tenant e ticket', async (context) => {
  const calls = patch(context);
  await leave(prisma, USER, 'ticket1', { sessionId: SESSION });
  assert.deepEqual(calls.deleteMany[0].where, { tenantId: 't1', userId: 'u1', ticketId: 'ticket1', sessionId: SESSION });
});
