const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePhone,
  renderCounterMessage,
  buildCounterAudience,
} = require('../src/services/counterCampaignService');

test('normaliza telefone nacional e rejeita números incompletos', () => {
  assert.equal(normalizePhone('(51) 99999-1234'), '5551999991234');
  assert.equal(normalizePhone('5551999991234'), '5551999991234');
  assert.equal(normalizePhone('123'), null);
});

test('renderiza solicitação com todos os equipamentos e localização', () => {
  const contact = { name: 'Maria', equipments: [
    { id: 'eq-1', model: 'Xerox 7830', serialNumber: 'ABC', sector: 'Recepção', isActive: true },
    { id: 'eq-2', model: 'Ricoh 377', serialNumber: 'DEF', installLocation: 'Financeiro', isActive: true },
  ] };
  const output = renderCounterMessage(
    'Olá [nome], envie [equipamentos]. Principal: [modelo] [serie] [local].',
    contact,
    contact.equipments,
  );
  assert.match(output, /Olá Maria/);
  assert.match(output, /Xerox 7830/);
  assert.match(output, /Ricoh 377/);
  assert.match(output, /Recepção/);
  assert.match(output, /ABC/);
});

test('prévia exige aceite, equipamento ativo, telefone e elimina duplicatas', () => {
  const base = {
    name: 'Cliente', phone: '51999991234', enableWhatsAppCounters: true,
    equipments: [{ id: 'eq-1', model: 'Brother 8085', serialNumber: 'S1', isActive: true }],
  };
  const result = buildCounterAudience([
    { id: 'ok', ...base },
    { id: 'without-optin', ...base, enableWhatsAppCounters: false },
    { id: 'without-equipment', ...base, phone: '51999991235', equipments: [] },
    { id: 'without-phone', ...base, phone: '' },
    { id: 'duplicate', ...base },
  ]);
  assert.equal(result.recipients.length, 1);
  assert.deepEqual(result.recipients[0].equipmentIds, ['eq-1']);
  assert.deepEqual(result.skipped.map((item) => item.reason), [
    'counter_opt_in_required', 'no_active_equipment', 'invalid_phone', 'duplicate_phone',
  ]);
});

test('prioriza WhatsApp cadastrado e respeita opt-out global', () => {
  const result = buildCounterAudience([
    {
      id: 'whatsapp-preferido', phone: '51999990000', whatsapp: '(51) 98888-7777',
      enableWhatsAppCounters: true,
      equipments: [{ id: 'eq-2', model: 'Xerox 7830', isActive: true }],
    },
    {
      id: 'opted-out', phone: '51999991111', whatsappOptOutAt: new Date(),
      enableWhatsAppCounters: true,
      equipments: [{ id: 'eq-3', model: 'Ricoh 377', isActive: true }],
    },
  ]);
  assert.equal(result.recipients[0].phone, '5551988887777');
  assert.equal(result.skipped[0].reason, 'whatsapp_opt_out');
});
