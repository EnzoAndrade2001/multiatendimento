const test = require('node:test');
const assert = require('node:assert/strict');
const evolutionService = require('../src/services/evolutionService');
const { isOptOutMessage } = require('../src/services/whatsappComplianceService');

test('isOptOutMessage reconhece pedidos curtos de descadastramento', () => {
  for (const value of ['PARAR', 'parar', 'sair', 'cancelar', 'STOP', 'descadastrar', 'não quero mais receber mensagens', 'nao quero receber']) {
    assert.equal(isOptOutMessage(value), true, `esperado opt-out para: ${value}`);
  }
});

test('isOptOutMessage nao dispara em frases comuns que contem as palavras', () => {
  for (const value of ['ok pode parar de enviar amanha', 'obrigado', '5', 'vou cancelar minha visita tecnica de sexta', 'quero sair mais cedo hoje do trabalho']) {
    assert.equal(isOptOutMessage(value), false, `nao deveria ser opt-out: ${value}`);
  }
});

test('buildPhoneLookupCandidates cobre o 9o digito do celular BR nos dois sentidos', () => {
  const semNove = evolutionService.buildPhoneLookupCandidates('555186876737');
  assert.ok(semNove.includes('5551986876737'), 'deveria gerar a forma com o 9');

  const comNove = evolutionService.buildPhoneLookupCandidates('5551986876737');
  assert.ok(comNove.includes('555186876737'), 'deveria gerar a forma sem o 9');
});

test('buildPhoneLookupCandidates nao inventa 9o digito para telefone fixo', () => {
  // 55 + 11 + 3xxxxxxx (fixo de SP, comeca com 3) -> nao pode virar 9 3xxxxxxx
  const fixo = evolutionService.buildPhoneLookupCandidates('551133224455');
  assert.ok(!fixo.includes('5511933224455'), 'nao deveria adicionar 9 a numero fixo');
});
