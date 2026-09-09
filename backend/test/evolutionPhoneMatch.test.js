const test = require('node:test');
const assert = require('node:assert/strict');

const { samePhoneNumber } = require('../src/services/evolutionService');

test('samePhoneNumber: número idêntico', () => {
  assert.equal(samePhoneNumber('555193896363', '555193896363'), true);
  assert.equal(samePhoneNumber('555193896363@s.whatsapp.net', '+55 51 9389-6363'), true);
});

test('samePhoneNumber: mesmo número com/sem 9º dígito', () => {
  assert.equal(samePhoneNumber('554899998888', '5548999998888'), true);
  assert.equal(samePhoneNumber('5548999998888', '554899998888'), true);
});

test('samePhoneNumber: lado faltando -> não aponta divergência', () => {
  assert.equal(samePhoneNumber('', '555193896363'), true);
  assert.equal(samePhoneNumber('555193896363', null), true);
});

test('samePhoneNumber: números diferentes de verdade -> false', () => {
  // o caso do incidente: financeiro conectou no número do atendimento
  assert.equal(samePhoneNumber('555194412679', '555193896363'), false);
  assert.equal(samePhoneNumber('555194412679@s.whatsapp.net', '555193896363'), false);
  assert.equal(samePhoneNumber('554830281346', '555193896363'), false);
});
