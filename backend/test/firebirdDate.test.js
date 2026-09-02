const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFirebirdDate } = require('../src/utils/firebirdDate');

test('interpreta data Firebird ISO sem fuso no horario de Sao Paulo', () => {
  assert.equal(parseFirebirdDate('2026-08-27T08:32:26').toISOString(), '2026-08-27T11:32:26.000Z');
  assert.equal(parseFirebirdDate('2023-10-18T00:00:00').toISOString(), '2023-10-18T03:00:00.000Z');
});

test('interpreta data brasileira e combina data/hora separadas', () => {
  assert.equal(parseFirebirdDate('27/08/2026 08:32:26').toISOString(), '2026-08-27T11:32:26.000Z');
  assert.equal(parseFirebirdDate('2026-08-27', '08:32:26').toISOString(), '2026-08-27T11:32:26.000Z');
});

test('preserva offset explicito recebido da API', () => {
  assert.equal(parseFirebirdDate('2026-08-27T08:32:26Z').toISOString(), '2026-08-27T08:32:26.000Z');
});
