const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveEquipmentMirrorContactId } = require('../src/services/crmSyncService');

test('reassocia espelho do equipamento quando o contato legado nao pertence ao cliente CRM', () => {
  assert.equal(
    resolveEquipmentMirrorContactId(
      { contactId: 'contato-legado' },
      ['contato-atual', 'outro-contato-crm'],
      'contato-atual',
    ),
    'contato-atual',
  );
});

test('preserva contato relacionado ao mesmo cliente CRM', () => {
  assert.equal(
    resolveEquipmentMirrorContactId(
      { contactId: 'outro-contato-crm' },
      ['contato-atual', 'outro-contato-crm'],
      'contato-atual',
    ),
    'outro-contato-crm',
  );
});

test('usa o contato da conversa quando o espelho nao possui contato', () => {
  assert.equal(
    resolveEquipmentMirrorContactId(null, ['contato-atual'], 'contato-atual'),
    'contato-atual',
  );
});
