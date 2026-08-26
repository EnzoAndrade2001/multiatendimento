const test = require('node:test');
const assert = require('node:assert/strict');
const {
  guardBotReply,
  isUnsafeOperationalClaim,
  selectCurrentSessionHistory,
} = require('../src/services/botSafetyService');

test('bloqueia número de O.S. inventado e substitui por encaminhamento seguro', () => {
  const result = guardBotReply('Sua O.S. foi aberta com sucesso. Número da O.S.: 91640');
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes('service_order_number'));
  assert.match(result.reply, /confirmados por um atendente/i);
  assert.doesNotMatch(result.reply, /91640/);
});

test('bloqueia prazo ou SLA numérico não verificado', () => {
  const result = guardBotReply('O atendimento técnico ocorrerá dentro de 4 horas.');
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.includes('unverified_deadline'));
});

test('permite informar apenas a intenção futura de abrir chamado', () => {
  assert.equal(isUnsafeOperationalClaim('Entendido! Iremos abrir um chamado para você e nosso time seguirá com o atendimento.'), false);
});

test('histórico da IA fica restrito à sessão corrente', () => {
  const messages = [
    { id: 'recent-2', createdAt: new Date('2026-08-25T21:00:00Z') },
    { id: 'recent-1', createdAt: new Date('2026-08-25T20:00:00Z') },
    { id: 'old', createdAt: new Date('2026-08-21T20:00:00Z') },
  ];
  const selected = selectCurrentSessionHistory(messages, new Date('2026-08-25T21:30:00Z'));
  assert.deepEqual(selected.map((message) => message.id), ['recent-1', 'recent-2']);
});

test('identifica confirmações antigas que não devem alimentar a IA', () => {
  assert.equal(isUnsafeOperationalClaim('Sua ordem de serviço foi aberta com sucesso.'), true);
  assert.equal(isUnsafeOperationalClaim('O chamado está em atendimento.'), true);
});
