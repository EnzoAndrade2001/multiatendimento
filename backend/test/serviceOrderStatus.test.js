const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isCancelledServiceOrderStatus,
  isServiceOrderClosed,
  normalizeServiceOrderStatus,
  rawServiceOrderStatus,
} = require('../src/utils/serviceOrderStatus');

test('normaliza todas as grafias usuais de cancelamento sem transforma-las em pendente', () => {
  for (const value of ['CANCELADA', 'cancelado', 'Cancelled', 'CANCELED', 'O.S. cancelada']) {
    assert.equal(normalizeServiceOrderStatus(value), 'CANCELADA');
    assert.equal(isCancelledServiceOrderStatus(value), true);
  }
});

test('cancelada e finalizada sao encerradas; pendente e atendimento permanecem abertas', () => {
  assert.equal(isServiceOrderClosed({ status: 'CANCELADA' }), true);
  assert.equal(isServiceOrderClosed({ status: 'CANCELADO' }), true);
  assert.equal(isServiceOrderClosed({ status: 'FINALIZADA' }), true);
  assert.equal(isServiceOrderClosed({ status: 'PENDENTE' }), false);
  assert.equal(isServiceOrderClosed({ status: 'EM_ATENDIMENTO' }), false);
});

test('preserva as demais classificacoes canonicas do iLux', () => {
  assert.equal(normalizeServiceOrderStatus('Concluída'), 'FINALIZADA');
  assert.equal(normalizeServiceOrderStatus('Aguardando retorno'), 'AGUARDANDO_RETORNO');
  assert.equal(normalizeServiceOrderStatus('Em atendimento'), 'EM_ATENDIMENTO');
  assert.equal(normalizeServiceOrderStatus('Aberto'), 'PENDENTE');
  assert.equal(normalizeServiceOrderStatus('', { closedAt: new Date() }), 'FINALIZADA');
});

test('le status tanto do payload canonico quanto do raw legado', () => {
  assert.equal(rawServiceOrderStatus({ status: 'CANCELADA' }), 'CANCELADA');
  assert.equal(rawServiceOrderStatus({ raw: { nmstatus: 'Cancelado' } }), 'Cancelado');
  assert.equal(rawServiceOrderStatus({ raw: { tffaturar: 'S' } }), 'S');
});
