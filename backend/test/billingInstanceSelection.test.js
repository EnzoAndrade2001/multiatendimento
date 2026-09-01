const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../src/controllers/billingController');
const { resolveBillingInstance } = _private;

const qr = { id: 'qr1', instanceName: 't_lcd-financeiro', status: 'connected', provider: 'evolution_qr' };
const official = { id: 'of1', instanceName: 't_oficial', status: 'connected', provider: 'evolution_official' };
const disconnectedQr = { id: 'qr2', instanceName: 't_qr2', status: 'disconnected', provider: 'evolution_qr' };
const deleted = { id: 'del', instanceName: 'DELETED_123_t_old', status: 'disconnected', provider: 'evolution_qr' };

test('usa a instancia configurada em billingInstanceId', () => {
  const tenant = { instances: [official, qr], settings: { billingInstanceId: 'qr1' } };
  assert.equal(resolveBillingInstance(tenant)?.id, 'qr1');
});

test('configurada tem prioridade mesmo sobre a primeira conectada', () => {
  const tenant = { instances: [official, qr], settings: { billingInstanceId: 'qr1' } };
  assert.equal(resolveBillingInstance(tenant)?.id, 'qr1');
});

test('sem configuracao nunca escolhe a API oficial silenciosamente', () => {
  const tenant = { instances: [disconnectedQr, official], settings: {} };
  assert.equal(resolveBillingInstance(tenant), null);
});

test('configurada inexistente nao usa outra conexao como fallback', () => {
  const tenant = { instances: [qr], settings: { billingInstanceId: 'sumiu' } };
  assert.equal(resolveBillingInstance(tenant), null);
});

test('sem configuracao nao escolhe nem QR conectado', () => {
  const tenant = { instances: [official, qr], settings: {} };
  assert.equal(resolveBillingInstance(tenant), null);
});

test('ignora instancias DELETED_', () => {
  const tenant = { instances: [deleted, qr], settings: { billingInstanceId: 'del' } };
  assert.equal(resolveBillingInstance(tenant), null);
});

test('sem instancias retorna null', () => {
  assert.equal(resolveBillingInstance({ instances: [], settings: {} }), null);
});
