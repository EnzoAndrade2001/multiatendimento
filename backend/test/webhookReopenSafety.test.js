const test = require('node:test');
const assert = require('node:assert/strict');

const { __testing } = require('../src/controllers/webhookController');
const { isHistoricalMessage, messageOccurredAt, shouldReopenResolvedTicket } = __testing;

test('mensagem historica recebida nao reabre ticket encerrado', () => {
  assert.equal(shouldReopenResolvedTicket({ isHistorical: true, fromMe: false }), false);
});

test('eco fromMe de CSAT ou bot nao reabre ticket encerrado', () => {
  assert.equal(shouldReopenResolvedTicket({ isHistorical: false, fromMe: true }), false);
  assert.equal(shouldReopenResolvedTicket({ isHistorical: true, fromMe: true }), false);
});

test('somente mensagem atual do cliente reabre ticket encerrado', () => {
  assert.equal(shouldReopenResolvedTicket({ isHistorical: false, fromMe: false }), true);
});

test('timestamp original em segundos e milissegundos e preservado', () => {
  const expected = new Date('2026-08-31T15:53:00.000Z');
  assert.equal(messageOccurredAt({ messageTimestamp: expected.getTime() / 1000 }).toISOString(), expected.toISOString());
  assert.equal(messageOccurredAt({ timestamp: expected.getTime() }).toISOString(), expected.toISOString());
  assert.equal(messageOccurredAt({ timestamp: expected.toISOString() }).toISOString(), expected.toISOString());
});

test('timestamp da API Oficial classifica replay atrasado como historico', () => {
  const now = new Date('2026-08-31T16:30:00.000Z');
  assert.equal(isHistoricalMessage({ timestamp: '2026-08-31T15:53:00.000Z' }, 'messages.upsert', now.getTime()), true);
  assert.equal(isHistoricalMessage({ timestamp: '2026-08-31T16:29:00.000Z' }, 'messages.upsert', now.getTime()), false);
  assert.equal(isHistoricalMessage({ timestamp: now.toISOString() }, 'messages.set', now.getTime()), true);
});
