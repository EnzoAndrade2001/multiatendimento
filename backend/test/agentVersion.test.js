const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVersion, compareVersions, isOutdated } = require('../src/utils/agentVersion');

test('parseVersion aceita formatos toleraveis e rejeita lixo', () => {
  assert.deepEqual(parseVersion('1.1.3'), [1, 1, 3]);
  assert.deepEqual(parseVersion('v2.0'), [2, 0]);
  assert.deepEqual(parseVersion(' 1.2.4-rc1 '), [1, 2, 4]);
  assert.deepEqual(parseVersion('1.2.3+build9'), [1, 2, 3]);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
  assert.equal(parseVersion('desconhecida'), null);
  assert.equal(parseVersion('1.x.0'), null);
});

test('compareVersions ordena por segmento numerico', () => {
  assert.equal(compareVersions('1.1.3', '1.1.2'), 1);
  assert.equal(compareVersions('1.1.2', '1.1.3'), -1);
  assert.equal(compareVersions('1.1.3', '1.1.3'), 0);
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1); // numerico, nao lexical
  assert.equal(compareVersions('1.1', '1.1.0'), 0); // padding com zero
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.1.3', 'nao-sei'), null);
});

test('isOutdated so afirma "desatualizado" quando da para comparar e a publicada e maior', () => {
  assert.equal(isOutdated('1.1.2', '1.1.3'), true);
  assert.equal(isOutdated('1.1.3', '1.1.3'), false);
  assert.equal(isOutdated('1.2.0', '1.1.3'), false); // agente a frente
  assert.equal(isOutdated(null, '1.1.3'), false); // versao atual ausente
  assert.equal(isOutdated('1.1.2', null), false); // sem manifesto
  assert.equal(isOutdated('', ''), false);
});
