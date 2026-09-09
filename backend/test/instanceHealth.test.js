const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const evolution = require('../src/services/evolutionService');
const instanceHealth = require('../src/services/instanceHealthService');
const { __testing } = instanceHealth;
const { __testing: syncTesting } = require('../src/services/syncMissedMessagesService');

const INSTANCE = (over = {}) => ({
  id: 'wa-1', tenantId: 't-1', instanceName: 'lcd-atendimento',
  status: 'connected', healthStatus: 'healthy', lastConnectionState: 'open',
  lastWebhookAt: new Date(),
  tenant: { settings: { evolutionUrl: 'https://evo.example', evolutionKey: 'k' } },
  ...over,
});

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

function patchHealth(context, { state, hasTraffic = true } = {}) {
  const og = {
    getState: evolution.getConnectionState,
    update: prisma.waInstance.update,
    eventCreate: prisma.waInstanceHealthEvent.create,
    eventFind: prisma.waInstanceHealthEvent.findFirst,
    msgFind: prisma.message.findFirst,
  };
  context.after(() => {
    evolution.getConnectionState = og.getState;
    prisma.waInstance.update = og.update;
    prisma.waInstanceHealthEvent.create = og.eventCreate;
    prisma.waInstanceHealthEvent.findFirst = og.eventFind;
    prisma.message.findFirst = og.msgFind;
  });
  evolution.getConnectionState = async () => ({ instance: { state } });
  let saved = null;
  prisma.waInstance.update = async ({ data }) => { saved = data; return { ...INSTANCE(), ...data }; };
  const events = [];
  prisma.waInstanceHealthEvent.create = async ({ data }) => { events.push(data); return data; };
  prisma.waInstanceHealthEvent.findFirst = async () => null;
  prisma.message.findFirst = async () => (hasTraffic ? { id: 'm1' } : null);
  return { get saved() { return saved; }, events };
}

test('D: instância "open" mas sem webhook há muito tempo vira "silent" + grava histórico', async (context) => {
  const stale = new Date(Date.now() - 40 * 60 * 1000); // 40 min
  const spy = patchHealth(context, { state: 'open', lastWebhookAt: stale });
  await instanceHealth.checkInstance(INSTANCE({ lastWebhookAt: stale }));

  assert.equal(spy.saved.healthStatus, 'silent');
  assert.equal(spy.saved.status, 'degraded');
  assert.match(spy.saved.lastHealthError, /sem receber eventos da Evolution/i);
  assert.equal(spy.events.length, 1);
  assert.equal(spy.events[0].healthStatus, 'silent');
  assert.equal(spy.events[0].connectionState, 'open');
  assert.equal(typeof spy.events[0].webhookAgeSec, 'number');
});

test('D: instância "open" com webhook recente permanece "healthy" e não gera evento', async (context) => {
  const spy = patchHealth(context, { state: 'open' });
  await instanceHealth.checkInstance(INSTANCE({ lastWebhookAt: new Date() }));

  assert.equal(spy.saved.healthStatus, 'healthy');
  assert.equal(spy.saved.status, 'connected');
  assert.equal(spy.events.length, 0, 'sem transição -> sem linha de histórico');
});

test('D: instância PARADA (sem tráfego 48h) NÃO vira "silent" mesmo sem webhook', async (context) => {
  const stale = new Date(Date.now() - 60 * 60 * 1000);
  const spy = patchHealth(context, { state: 'open', hasTraffic: false });
  await instanceHealth.checkInstance(INSTANCE({ id: `wa-parada-${Date.now()}`, lastWebhookAt: stale }));

  assert.equal(spy.saved.healthStatus, 'healthy', 'instância de teste/parada não é incidente');
  assert.equal(spy.events.length, 0);
});

test('E: uma queda de conexão (open -> close) grava um evento de histórico', async (context) => {
  const spy = patchHealth(context, { state: 'close' });
  await instanceHealth.checkInstance(INSTANCE({ status: 'connected', healthStatus: 'healthy', lastConnectionState: 'open' }));

  assert.equal(spy.saved.status, 'disconnected');
  assert.equal(spy.events.length, 1);
  assert.equal(spy.events[0].status, 'disconnected');
});
