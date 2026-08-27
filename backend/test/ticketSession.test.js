const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activityStartsNewSession,
  buildHistoricalSessions,
} = require('../src/services/ticketSessionService');

test('reabertura de ticket resolvido sempre inicia nova sessao', () => {
  const at = new Date('2026-08-27T10:00:00Z');
  const decision = activityStartsNewSession({ status: 'resolved', createdAt: new Date('2026-01-01T00:00:00Z') }, at);
  assert.equal(decision.startsNew, true);
  assert.equal(decision.trigger, 'REOPENED');
  assert.equal(decision.startedAt.getTime(), at.getTime());
});

test('inatividade de 24 horas separa conversas no mesmo ticket', () => {
  const decision = activityStartsNewSession({
    status: 'open',
    lastMessageAt: new Date('2026-08-25T09:00:00Z'),
    sessionStartedAt: new Date('2026-08-25T09:00:00Z'),
  }, new Date('2026-08-26T09:00:00Z'));
  assert.equal(decision.startsNew, true);
  assert.equal(decision.trigger, 'INACTIVITY');
});

test('reconstrucao historica divide mensagens separadas por mais de 24 horas', () => {
  const ticket = {
    id: 'ticket-1', tenantId: 'tenant-1', agentId: 'agent-1', status: 'resolved',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    resolvedAt: new Date('2026-08-26T12:00:00Z'),
  };
  const messages = [
    { createdAt: new Date('2026-08-20T10:00:00Z') },
    { createdAt: new Date('2026-08-20T11:00:00Z') },
    { createdAt: new Date('2026-08-25T10:00:00Z') },
    { createdAt: new Date('2026-08-25T11:00:00Z') },
  ];
  const sessions = buildHistoricalSessions(ticket, messages, []);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].status, 'INACTIVE');
  assert.equal(sessions[1].status, 'RESOLVED');
  assert.equal(sessions[1].reconstructed, true);
});

test('ticket historico sem atividade confiavel nao entra no TMA', () => {
  const sessions = buildHistoricalSessions({
    id: 'ticket-1', tenantId: 'tenant-1', status: 'resolved',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    resolvedAt: new Date('2026-08-26T12:00:00Z'),
  }, [], []);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, 'INACTIVE');
});
