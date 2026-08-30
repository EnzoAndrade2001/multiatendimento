const test = require('node:test');
const assert = require('node:assert/strict');
const { __testing } = require('../src/services/parkService');
const { computeHealth, healthBucket, pickOsType, tonerLevelFromPayload, severityRank } = __testing;

test('computeHealth: penaliza chamados recentes e equipamento inativo', () => {
  assert.equal(computeHealth({ callCount90d: 0, ageMinutes: 0, equipmentActive: true }), 100);
  assert.equal(computeHealth({ callCount90d: 3, ageMinutes: 0, equipmentActive: true }), 73);
  assert.equal(computeHealth({ callCount90d: 10, ageMinutes: 0, equipmentActive: true }), 40); // cap -60
  assert.equal(computeHealth({ callCount90d: 0, ageMinutes: 0, equipmentActive: false }), 75);
});

test('healthBucket: faixas', () => {
  assert.equal(healthBucket(90), 'ok');
  assert.equal(healthBucket(60), 'warn');
  assert.equal(healthBucket(30), 'bad');
  assert.equal(healthBucket(null), 'unknown');
});

test('severityRank: ordena CRITICAL > WARNING > INFO', () => {
  assert.ok(severityRank('CRITICAL') > severityRank('WARNING'));
  assert.ok(severityRank('WARNING') > severityRank('INFO'));
  assert.equal(severityRank('qualquer'), 0);
});

test('tonerLevelFromPayload: le percentual de varios campos', () => {
  assert.equal(tonerLevelFromPayload({ level: 35 }), 35);
  assert.equal(tonerLevelFromPayload({ toner: { overall: 12 } }), 12);
  assert.equal(tonerLevelFromPayload({ levelPct: 8 }), 8);
  assert.equal(tonerLevelFromPayload({ level: 120 }), null); // fora de 0-100
  assert.equal(tonerLevelFromPayload({}), null);
});

test('pickOsType: escolhe tipo de suprimento para toner e tecnico para erro', () => {
  const types = [
    { code: '1', name: 'Manutencao Corretiva' },
    { code: '2', name: 'Entrega de Suprimento' },
    { code: '3', name: 'Instalacao' },
  ];
  assert.equal(pickOsType(types, 'toner.low')?.code, '2');
  assert.equal(pickOsType(types, 'hardware.error')?.code, '1');
  assert.equal(pickOsType(types, 'evento.desconhecido'), null);
  assert.equal(pickOsType([], 'toner.low'), null);
});
