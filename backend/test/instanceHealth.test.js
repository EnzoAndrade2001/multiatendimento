const test = require('node:test');
const assert = require('node:assert/strict');

const { __testing } = require('../src/services/instanceHealthService');
const { __testing: syncTesting } = require('../src/services/syncMissedMessagesService');

test('normaliza os formatos de estado retornados pela Evolution', () => {
  assert.equal(__testing.parseConnectionState({ instance: { state: 'open' } }), 'open');
  assert.equal(__testing.parseConnectionState({ state: 'connecting' }), 'connecting');
  assert.equal(__testing.parseConnectionState({ connectionStatus: 'close' }), 'close');
  assert.equal(__testing.parseConnectionState({ instance: { connectionStatus: 'connected' } }), 'open');
  assert.equal(__testing.parseConnectionState({}), null);
});

test('mapeia estado para status operacional e saúde visível', () => {
  assert.deepEqual(__testing.healthForState('open'), { status: 'connected', healthStatus: 'healthy' });
  assert.deepEqual(__testing.healthForState('connecting'), { status: 'connecting', healthStatus: 'unstable' });
  assert.deepEqual(__testing.healthForState('close'), { status: 'disconnected', healthStatus: 'offline' });
  assert.deepEqual(__testing.healthForState('unknown'), { status: 'degraded', healthStatus: 'degraded' });
});

test('limita a janela de recuperação para evitar carga acidental', () => {
  assert.deepEqual(syncTesting.normalizeOptions({ hours: 0, limitPerChat: 1, maxChats: 0 }), { hours: 1, limitPerChat: 10, maxChats: 1 });
  assert.deepEqual(syncTesting.normalizeOptions({ hours: 999, limitPerChat: 999, maxChats: 999 }), { hours: 168, limitPerChat: 100, maxChats: 500 });
});
