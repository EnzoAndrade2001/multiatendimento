'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const recovery = require('./timeoutRecovery.cjs');
function fixture() {
  const writes = [], events = [], timers = [];
  let connections = 0;
  const channel = {
    instanceId: 'test', instance: { name: 'test' }, logger: { warn() {} },
    prismaRepository: { instance: { async update(data) { writes.push(data); } } },
    sendDataWebhook(event, data) { events.push(data); },
    async connectToWhatsapp() { connections++; },
  };
  const schedule = (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; };
  return { channel, writes, events, timers, schedule, connections: () => connections };
}
test('timeout retries are progressive, bounded and preserve credentials', async () => {
  const f = fixture();
  for (let i = 0; i < 6; i++) { await recovery.handle(f.channel, f.schedule); await f.timers[i].fn(); }
  await recovery.handle(f.channel, f.schedule);
  assert.deepEqual(f.timers.map(t => t.delay), [15000, 30000, 60000, 120000, 240000, 300000]);
  assert.equal(f.connections(), 6);
  assert.equal(f.events.at(-1).recovery, 'exhausted');
  assert.ok(f.events.every(e => e.credentialsPreserved));
  assert.ok(f.writes.every(w => Object.keys(w.data).every(k => ['connectionStatus', 'disconnectionReasonCode', 'disconnectionAt'].includes(k))));
});
test('duplicate close events schedule once; successful open invalidates queued retry', async () => {
  const f = fixture();
  await recovery.handle(f.channel, f.schedule); await recovery.handle(f.channel, f.schedule);
  assert.equal(f.timers.length, 1);
  recovery.reset(f.channel); await f.timers[0].fn(); assert.equal(f.connections(), 0);
  await recovery.handle(f.channel, f.schedule); assert.equal(f.timers[1].delay, 15000);
});
test('deletion prevents reconnect and rejected connections retry within the limit', async () => {
  const f = fixture(); await recovery.handle(f.channel, f.schedule);
  f.channel.endSession = true; await f.timers[0].fn(); assert.equal(f.connections(), 0);
  const g = fixture(); g.channel.connectToWhatsapp = async () => { throw Error('offline'); };
  await recovery.handle(g.channel, g.schedule); await g.timers[0].fn();
  assert.equal(g.timers.length, 2); assert.equal(g.timers[1].delay, 30000);
});
