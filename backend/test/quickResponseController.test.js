const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeShortcut,
  normalizeCategory,
  normalizeScope,
} = require('../src/controllers/quickResponseController');

test('normaliza atalhos preservando a compatibilidade da barra', () => {
  assert.equal(normalizeShortcut('/saudacao'), '/saudacao');
  assert.equal(normalizeShortcut('///SAUDACAO'), '/saudacao');
  assert.equal(normalizeShortcut('os_urgente.v2'), '/os_urgente.v2');
  assert.equal(normalizeShortcut(''), null);
  assert.equal(normalizeShortcut('/com espaco'), null);
  assert.equal(normalizeShortcut('/-nao-pode-comecar-com-hifen'), null);
});

test('aceita apenas categorias e escopos suportados', () => {
  assert.equal(normalizeCategory('suporte'), 'SUPPORT');
  assert.equal(normalizeCategory('billing'), 'BILLING');
  assert.equal(normalizeCategory(undefined), 'GENERAL');
  assert.equal(normalizeCategory('marketing'), null);

  assert.equal(normalizeScope('global'), 'GLOBAL');
  assert.equal(normalizeScope('team'), 'TEAM');
  assert.equal(normalizeScope('personal'), 'PERSONAL');
  assert.equal(normalizeScope('tenant'), null);
});
