const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeDurations,
  durationMinutes,
  summarizeSessionRetention,
} = require('../src/controllers/dashboardController');

test('TMA usa sessionStartedAt quando presente', () => {
  const row = {
    createdAt: new Date('2026-01-01T00:00:00Z'), // primeiro contato historico
    sessionStartedAt: new Date('2026-08-20T09:00:00Z'),
    resolvedAt: new Date('2026-08-20T11:30:00Z'),
  };
  assert.equal(durationMinutes(row), 150);
});

test('TMA volta para createdAt quando sessionStartedAt e nulo (ticket pre-backfill)', () => {
  const row = {
    createdAt: new Date('2026-08-20T09:00:00Z'),
    sessionStartedAt: null,
    resolvedAt: new Date('2026-08-20T10:00:00Z'),
  };
  assert.equal(durationMinutes(row), 60);
});

test('summarizeDurations agrega media/mediana/p90 pela sessao, nao pelo createdAt antigo', () => {
  const base = new Date('2026-08-25T00:00:00Z').getTime();
  const rows = [60, 120, 180].map((minutes) => ({
    createdAt: new Date('2025-01-01T00:00:00Z'), // sem a correcao isso explodiria o TMA
    sessionStartedAt: new Date(base),
    resolvedAt: new Date(base + minutes * 60000),
  }));
  const summary = summarizeDurations(rows);
  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.median, 120);
  assert.equal(summary.average, 120);
  assert.ok(summary.p90 < 200);
});

test('retencao IA nao exclui ticket cujo unico atendimento humano precede a sessao', () => {
  const sessionStart = new Date('2026-08-26T10:00:00Z');
  const candidates = [
    { id: 't-retido', sessionStartedAt: sessionStart, createdAt: new Date('2026-01-01T00:00:00Z') },
    { id: 't-humano-agora', sessionStartedAt: sessionStart, createdAt: new Date('2026-01-01T00:00:00Z') },
  ];
  const humanReplyGroups = [
    // conversa ANTERIOR na mesma linha: humano falou antes do inicio da sessao -> nao desqualifica
    { ticketId: 't-retido', _max: { createdAt: new Date('2026-05-10T12:00:00Z') } },
    // humano respondeu DEPOIS do inicio da sessao -> desqualifica
    { ticketId: 't-humano-agora', _max: { createdAt: new Date('2026-08-26T10:30:00Z') } },
  ];
  const botMessageGroups = [
    { ticketId: 't-retido', _max: { createdAt: new Date('2026-08-26T10:05:00Z') } },
    { ticketId: 't-humano-agora', _max: { createdAt: new Date('2026-08-26T10:05:00Z') } },
  ];

  const result = summarizeSessionRetention(candidates, humanReplyGroups, botMessageGroups);
  assert.equal(result.retainedByIA, 1);
  assert.equal(result.engagedSampleSize, 2);
  assert.equal(result.retainedByIAEngaged, 1);
});

test('denominador engajado ignora conversas onde o bot nao atuou nesta sessao', () => {
  const sessionStart = new Date('2026-08-26T10:00:00Z');
  const candidates = [
    { id: 'a', sessionStartedAt: sessionStart, createdAt: sessionStart },
    { id: 'b', sessionStartedAt: sessionStart, createdAt: sessionStart },
  ];
  const botMessageGroups = [
    { ticketId: 'a', _max: { createdAt: new Date('2026-07-01T00:00:00Z') } }, // bot so atuou antes da sessao
    { ticketId: 'b', _max: { createdAt: new Date('2026-08-26T10:02:00Z') } },
  ];

  const result = summarizeSessionRetention(candidates, [], botMessageGroups);
  assert.equal(result.retainedByIA, 2); // nenhum humano -> ambos retidos no recorte amplo
  assert.equal(result.engagedSampleSize, 1); // so 'b' teve bot nesta sessao
  assert.equal(result.retainedByIAEngaged, 1);
});
