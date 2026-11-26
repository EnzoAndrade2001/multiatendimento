const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const evolution = require('../src/services/evolutionService');
const probe = require('../src/services/inboundProbeService');
const instanceHealth = require('../src/services/instanceHealthService');

const { __testing: t } = probe;
const MIN = 60 * 1000;

const INST = (over = {}) => ({
  id: 'wa-a', tenantId: 't-1', instanceName: 't-1_atendimento', phone: '555194412679',
  provider: 'evolution_qr', lastConnectionState: 'open', status: 'connected', healthStatus: 'healthy',
  probeToken: null, probeSentAt: null, probeOkAt: null, probeFailures: 0, lastInboundAt: null,
  tenant: { settings: { evolutionUrl: 'https://evo.example', evolutionKey: 'k' } },
  ...over,
});

test('reconhece o token da mensagem de verificação (texto simples, extended e efêmera)', () => {
  const text = t.buildProbeText('abc123def456');
  assert.equal(t.extractProbeToken({ message: { conversation: text } }), 'abc123def456');
  assert.equal(t.extractProbeToken({ message: { extendedTextMessage: { text } } }), 'abc123def456');
  assert.equal(t.extractProbeToken({ message: { ephemeralMessage: { message: { conversation: text } } } }), 'abc123def456');
  assert.equal(t.extractProbeToken({ message: { conversation: 'oi, tudo bem?' } }), null);
  assert.equal(t.extractProbeToken({ message: { imageMessage: { caption: text } } }), null);
});

test('agenda a verificação: primeira vez, intervalo, silêncio e confirmação de falha', () => {
  const now = Date.now();
  assert.equal(t.isProbeDue(INST(), now), true, 'nunca verificada');
  assert.equal(t.isProbeDue(INST({ probeToken: 'x', probeSentAt: new Date(now - 2 * MIN) }), now), false, 'sonda pendente');
  const recentOk = { probeSentAt: new Date(now - 20 * MIN), probeOkAt: new Date(now - 19 * MIN), lastInboundAt: new Date(now - 5 * MIN) };
  assert.equal(t.isProbeDue(INST(recentOk), now), false, 'dentro do intervalo e com tráfego');
  assert.equal(t.isProbeDue(INST({ ...recentOk, probeSentAt: new Date(now - t.PROBE_INTERVAL_MS) }), now), true, 'intervalo vencido');
  const silent = { probeSentAt: new Date(now - 20 * MIN), probeOkAt: new Date(now - 60 * MIN), lastInboundAt: new Date(now - 60 * MIN) };
  assert.equal(t.isProbeDue(INST(silent), now), true, 'silêncio de recebimento antecipa a verificação');
  assert.equal(t.isProbeDue(INST({ probeFailures: 1, probeSentAt: new Date(now - t.PROBE_TIMEOUT_MS) }), now), true, 'confirma falha logo');
});

test('expira a sonda só depois do prazo', () => {
  const now = Date.now();
  assert.equal(t.isProbeExpired(INST({ probeToken: 'x', probeSentAt: new Date(now - t.PROBE_TIMEOUT_MS + MIN) }), now), false);
  assert.equal(t.isProbeExpired(INST({ probeToken: 'x', probeSentAt: new Date(now - t.PROBE_TIMEOUT_MS) }), now), true);
  assert.equal(t.isProbeExpired(INST({ probeToken: null, probeSentAt: new Date(0) }), now), false);
});

test('escolhe outra conexão (com número diferente) para enviar a sonda', () => {
  const a = INST();
  const b = INST({ id: 'wa-b', instanceName: 't-1_financeiro', phone: '555193896363', probeFailures: 2 });
  const c = INST({ id: 'wa-c', instanceName: 't-1_outro', phone: '555190000000' });
  const dupe = INST({ id: 'wa-d', instanceName: 't-1_dup', phone: '5551994412679' });
  assert.equal(t.pickSender(a, [a, b, c, dupe]).id, 'wa-c', 'prefere quem não tem falhas e ignora mesmo número');
  assert.equal(t.pickSender(a, [a]), null);
  assert.equal(t.isEligible(INST({ lastConnectionState: 'close' })), false);
  assert.equal(t.isEligible(INST({ instanceName: 'DELETED_1_x' })), false);
  assert.equal(t.isEligible(INST({ provider: 'evolution_official' })), false);
});

test('sinaliza "não recebe" mantendo status connected só após falhas seguidas', () => {
  const ok = { status: 'connected', healthStatus: 'healthy' };
  assert.deepEqual(instanceHealth.applyReceiveHealth(INST({ probeFailures: 1 }), 'open', ok).health, ok);
  const failing = instanceHealth.applyReceiveHealth(INST({ probeFailures: probe.FAILURES_TO_ALERT, lastInboundAt: new Date() }), 'open', ok);
  assert.deepEqual(failing.health, { status: 'connected', healthStatus: 'not_receiving' });
  assert.match(failing.healthError, /NÃO está recebendo/);
  // Desconectada: o estado da conexão manda.
  const off = { status: 'disconnected', healthStatus: 'offline' };
  assert.deepEqual(instanceHealth.applyReceiveHealth(INST({ probeFailures: 5 }), 'close', off).health, off);
});

test('webhook: sonda recebida confirma a verificação e é descartada; mensagem normal passa', async (context) => {
  const og = prisma.waInstance.updateMany;
  const calls = [];
  prisma.waInstance.updateMany = async (args) => { calls.push(args); return { count: 1 }; };
  context.after(() => { prisma.waInstance.updateMany = og; });

  const inst = INST();
  const probeMsg = { message: { conversation: t.buildProbeText('feedc0de1234') } };
  assert.equal(await probe.consumeProbeMessage(inst, probeMsg, false), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { id: 'wa-a', probeToken: 'feedc0de1234' });
  assert.equal(calls[0].data.probeFailures, 0);

  assert.equal(await probe.consumeProbeMessage(inst, probeMsg, true), true, 'eco do envio também é descartado');
  assert.equal(calls.length, 1, 'eco não confirma a sonda');
  assert.equal(await probe.consumeProbeMessage(inst, { message: { conversation: 'bom dia' } }, false), false);
});

test('ciclo: expira sonda vencida e envia nova pela outra conexão', async (context) => {
  const og = {
    updateMany: prisma.waInstance.updateMany,
    update: prisma.waInstance.update,
    bh: prisma.businessHour.findUnique,
    sendText: evolution.sendText,
  };
  const updates = [];
  const sent = [];
  prisma.waInstance.updateMany = async (args) => { updates.push(args); return { count: 1 }; };
  prisma.waInstance.update = async (args) => { updates.push(args); return {}; };
  prisma.businessHour.findUnique = async () => ({ active: true, start: '00:00', end: '23:59' });
  evolution.sendText = async (url, key, instanceName, phone, text) => { sent.push({ instanceName, phone, text }); return { key: { id: 'X' } }; };
  context.after(() => {
    prisma.waInstance.updateMany = og.updateMany;
    prisma.waInstance.update = og.update;
    prisma.businessHour.findUnique = og.bh;
    evolution.sendText = og.sendText;
  });

  const now = Date.now();
  const atendimento = INST({ probeToken: 'old', probeSentAt: new Date(now - t.PROBE_TIMEOUT_MS - MIN) });
  const financeiro = INST({
    id: 'wa-b', instanceName: 't-1_financeiro', phone: '555193896363',
    probeSentAt: new Date(now - 5 * MIN), probeOkAt: new Date(now - 4 * MIN), lastInboundAt: new Date(now - MIN),
  });
  await probe.runProbeCycle([atendimento, financeiro], now);

  const expire = updates.find((u) => u.where?.probeToken === 'old');
  assert.ok(expire, 'sonda vencida expirada');
  assert.deepEqual(expire.data.probeFailures, { increment: 1 });
  assert.equal(sent.length, 1, 'só o atendimento precisa de nova verificação');
  assert.equal(sent[0].instanceName, 't-1_financeiro');
  assert.equal(sent[0].phone, '555194412679');
  assert.ok(t.extractProbeToken({ message: { conversation: sent[0].text } }));
});

test('mensagem entregue com atraso (fila liberada no reinício) aparece para o atendente; sync de histórico não', () => {
  const { __testing: w } = require('../src/controllers/webhookController');
  const now = Date.now();
  const at = (minAgo) => ({ messageTimestamp: Math.floor((now - minAgo * MIN) / 1000) });
  assert.equal(w.isLateDelivery(at(1), 'messages.upsert', now), false, 'tempo real');
  assert.equal(w.isLateDelivery(at(120), 'messages.upsert', now), true, 'atrasada 2h');
  assert.equal(w.isLateDelivery(at(120), 'messages.set', now), false, 'histórico');
  assert.equal(w.isLateDelivery(at(49 * 60), 'messages.upsert', now), false, 'antiga demais');
});

test('cada verificação que falha aciona o tratamento (reinício automático)', async (context) => {
  const og = { updateMany: prisma.waInstance.updateMany, bh: prisma.businessHour.findUnique };
  prisma.waInstance.updateMany = async () => ({ count: 1 });
  prisma.businessHour.findUnique = async () => ({ active: false, start: '00:00', end: '00:01' });
  const failed = [];
  probe.onProbeFailed((inst) => { failed.push(inst.id); });
  context.after(() => {
    prisma.waInstance.updateMany = og.updateMany;
    prisma.businessHour.findUnique = og.bh;
    probe.onProbeFailed(null);
  });
  const now = Date.now();
  await probe.runProbeCycle([INST({ probeToken: 'old', probeSentAt: new Date(now - t.PROBE_TIMEOUT_MS - MIN) })], now);
  assert.deepEqual(failed, ['wa-a']);
});
