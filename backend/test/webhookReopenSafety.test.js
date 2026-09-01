const test = require('node:test');
const assert = require('node:assert/strict');

const { __testing } = require('../src/controllers/webhookController');
const {
  claimWebhookMessage,
  getWebhookMessageIdentity,
  isHistoricalMessage,
  messageOccurredAt,
  shouldReopenResolvedTicket,
} = __testing;

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

test('webhook exige id, jid e direcao explicita antes de processar', () => {
  assert.equal(getWebhookMessageIdentity({ key: { id: 'wamid.1', remoteJid: '5551999999999@s.whatsapp.net', fromMe: false } }).valid, true);
  assert.equal(getWebhookMessageIdentity({ key: { id: 'wamid.2', remoteJid: '5551999999999@s.whatsapp.net' } }).valid, false);
  assert.equal(getWebhookMessageIdentity({ key: { remoteJid: '5551999999999@s.whatsapp.net', fromMe: false } }).valid, false);
});

test('redelivery concorrente da API Oficial e aceita uma unica vez', () => {
  const now = Date.now();
  assert.equal(claimWebhookMessage('tenant-dedup', 'wamid.duplicada', now), true);
  assert.equal(claimWebhookMessage('tenant-dedup', 'wamid.duplicada', now + 1000), false);
  assert.equal(claimWebhookMessage('tenant-dedup', 'wamid.duplicada', now + 5 * 60 * 1000), true);
});
