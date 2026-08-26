const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLeadPhone,
  renderLeadMessage,
  normalizeMedia,
} = require('../src/controllers/leadController');

test('prospecção normaliza telefone e rejeita entrada curta', () => {
  assert.equal(normalizeLeadPhone('(51) 99999-1234'), '5551999991234');
  assert.equal(normalizeLeadPhone('123'), '');
  assert.equal(normalizeLeadPhone('5511999999999'), '5511999999999');
});

test('prospecção renderiza variáveis do lead sem inventar dados', () => {
  const lead = { name: 'Empresa Exemplo', phone: '5551999991234', city: 'Viamão', state: 'RS', category: 'Gráfica' };
  assert.equal(renderLeadMessage('Olá [nome], contato [telefone] em [cidade]/[estado]: [categoria].', lead), 'Olá Empresa Exemplo, contato 5551999991234 em Viamão/RS: Gráfica.');
  assert.equal(renderLeadMessage('[campo_desconhecido]', lead), '');
});

test('prospecção bloqueia mídia fora de uploads ou extensão não permitida', () => {
  assert.throws(() => normalizeMedia('https://site.exemplo/arquivo.pdf', 'document'), /Anexo inválido/);
  assert.throws(() => normalizeMedia('/uploads/../segredo.pdf', 'document'), /Anexo inválido/);
  assert.throws(() => normalizeMedia('/uploads/arquivo.exe', 'document'), /Tipo de anexo não permitido/);
});
