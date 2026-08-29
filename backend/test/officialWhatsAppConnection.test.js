const test = require('node:test');
const assert = require('node:assert/strict');
const evolutionService = require('../src/services/evolutionService');

test('existing QR connections keep the Baileys payload', () => {
  const payload = evolutionService.__testing.buildCreateInstancePayload('tenant_atendimento');
  assert.deepEqual(payload, {
    instanceName: 'tenant_atendimento',
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  });
});

test('official connections use Evolution WhatsApp Business integration', () => {
  const payload = evolutionService.__testing.buildCreateInstancePayload('tenant_oficial', {
    provider: 'evolution_official',
    phoneNumberId: '123456789',
    businessId: '987654321',
    accessToken: 'meta-permanent-token',
  });
  assert.deepEqual(payload, {
    instanceName: 'tenant_oficial',
    qrcode: false,
    integration: 'WHATSAPP-BUSINESS',
    number: '123456789',
    businessId: '987654321',
    token: 'meta-permanent-token',
  });
});
