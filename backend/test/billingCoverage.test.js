const test = require('node:test');
const assert = require('node:assert/strict');
const { _private } = require('../src/controllers/billingController');

test('compara clientes com opt-in e envios por cliente, sem duplicar contatos', () => {
  const contacts = [
    { id: 'c1', name: 'Cliente A', cpfCnpj: '12.345.678/0001-90', phone: '5551999990001', whatsapp: null },
    { id: 'c1-duplicado', name: 'Cliente A - outra instancia', cpfCnpj: '12345678000190', phone: '5551999990002', whatsapp: null },
    { id: 'c2', name: 'Cliente B', cpfCnpj: '98.765.432/0001-10', phone: '', whatsapp: null },
    { id: 'c3', name: 'Cliente C', cpfCnpj: '11.222.333/0001-44', phone: '5551999990003', whatsapp: null },
  ];
  const logs = [
    { cpfCnpj: '12345678000190', status: 'SUCCESS', sentAt: '2026-08-21T10:00:00Z' },
    { cpfCnpj: '11222333000144', status: 'FAILED', sentAt: '2026-08-21T10:05:00Z', errorMessage: 'Falha técnica' },
  ];

  const report = _private.buildBillingCoverageReport(contacts, logs);
  assert.deepEqual(report.coverageSummary, {
    expected: 3,
    received: 1,
    notReceived: 2,
    notSent: 0,
    noPhone: 1,
    failed: 1,
    skipped: 0,
    rate: 33,
  });
  assert.equal(report.coverageAnalysis.find((item) => item.name === 'Cliente A').status, 'RECEIVED');
  assert.equal(report.coverageAnalysis.find((item) => item.name === 'Cliente B').status, 'NO_PHONE');
  assert.equal(report.coverageAnalysis.find((item) => item.name === 'Cliente C').status, 'FAILED');
});

test('aceita periodo personalizado e rejeita datas invertidas', () => {
  const custom = _private.resolveBillingDateRange({ startDate: '2026-08-01', endDate: '2026-08-21' });
  assert.equal(custom.custom, true);
  assert.equal(custom.startDate.toISOString().slice(0, 10), '2026-08-01');
  assert.equal(custom.endDate.toISOString().slice(0, 10), '2026-08-21');

  const fallback = _private.resolveBillingDateRange({ startDate: '2026-08-21', endDate: '2026-08-01', period: '7' });
  assert.equal(fallback.custom, false);
  assert.equal(fallback.period, 7);
});

test('periodo "hoje" vai da meia-noite ate agora, nao ultimas 24h', () => {
  const range = _private.resolveBillingDateRange({ period: 'today' });
  assert.equal(range.custom, false);
  assert.equal(range.period, 'today');
  const now = new Date();
  assert.equal(range.startDate.getHours(), 0);
  assert.equal(range.startDate.getMinutes(), 0);
  assert.equal(range.startDate.toDateString(), now.toDateString());
  assert.ok(range.endDate <= new Date(Date.now() + 1000));
});

test('descreve a falha de envio automatico com uma frase util, nao o erro cru da lib', () => {
  const { describeAutoSendFailure } = _private;

  // Caso real: Evolution 400 quando a instancia esta reconectando e a checagem
  // "existe no WhatsApp?" volta vazia no meio do envio.
  const evoNumberRejected = {
    message: 'Request failed with status code 400',
    response: { data: { status: 400, error: 'Bad Request', response: { message: [{ jid: '5551999@s.whatsapp.net', exists: false, number: '5551999' }] } } },
  };
  const described = describeAutoSendFailure(evoNumberRejected);
  assert.match(described, /WhatsApp recusou o numero 5551999/);
  assert.match(described, /reconect/i);
  assert.doesNotMatch(described, /status code 400/);

  // Evolution devolvendo uma mensagem textual: repassa a mensagem.
  assert.equal(
    describeAutoSendFailure({ message: 'x', response: { data: { message: 'Instance not connected' } } }),
    'Instance not connected',
  );

  // Erro comum (sem response HTTP): cai no proprio message.
  assert.equal(describeAutoSendFailure(new Error('ECONNREFUSED')), 'ECONNREFUSED');
});

test('rejeita telefone curto do iLux e prioriza o contato WhatsApp válido', () => {
  assert.equal(_private.normalizeBillingPhone('05101'), '');
  assert.equal(_private.normalizeBillingPhone('5551999990001'), '5551999990001');

  const selected = _private.selectBillingContact([
    {
      id: 'firebird',
      externalSource: 'firebird',
      phone: '5505101',
      whatsapp: null,
      enableWhatsAppBilling: true,
    },
    {
      id: 'whatsapp',
      externalSource: 'whatsapp',
      phone: '5551999990001',
      whatsapp: '5551999990001',
      enableWhatsAppBilling: true,
    },
  ]);

  assert.equal(selected.id, 'whatsapp');
  assert.equal(_private.getBillingContactPhone(selected), '5551999990001');
});
