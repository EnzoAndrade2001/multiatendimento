const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const {
  isImportedServiceOrderMirror,
} = require('../src/controllers/firebirdSyncController');
const {
  resolveServiceOrderForPdf,
  generatePdf,
} = require('../src/controllers/osController');

test('reconhece somente espelho recente importado sem vinculos do CRM', () => {
  const pending = {
    id: 'original', externalId: null, equipmentId: 'eq-1', defect: 'Sem imprimir',
    createdAt: new Date('2026-08-25T12:00:00Z'),
  };
  const mirror = {
    id: 'mirror', externalId: '91703', externalSource: 'firebird',
    requestKey: null, ticketId: null, userId: null, equipmentId: 'eq-1',
    defect: 'SEM IMPRIMIR', createdAt: new Date('2026-08-25T12:00:04Z'),
  };
  assert.equal(isImportedServiceOrderMirror(pending, mirror, '91703'), true);
  assert.equal(isImportedServiceOrderMirror(pending, { ...mirror, ticketId: 'ticket-2' }, '91703'), false);
  assert.equal(isImportedServiceOrderMirror(pending, { ...mirror, equipmentId: 'eq-2' }, '91703'), false);
  assert.equal(isImportedServiceOrderMirror(pending, { ...mirror, defect: 'Outro defeito' }, '91703'), false);
});

test('não resolve O.S. histórica de fonte legada quando ServiceOrder não existe', async (context) => {
  const originals = {
    serviceOrderFindFirst: prisma.serviceOrder.findFirst,
    externalSyncRecordFindUnique: prisma.externalSyncRecord.findUnique,
    crmCustomerFindFirst: prisma.crmCustomer.findFirst,
    crmEquipmentFindFirst: prisma.crmEquipment.findFirst,
    tenantFindUnique: prisma.tenant.findUnique,
  };
  context.after(() => {
    prisma.serviceOrder.findFirst = originals.serviceOrderFindFirst;
    prisma.externalSyncRecord.findUnique = originals.externalSyncRecordFindUnique;
    prisma.crmCustomer.findFirst = originals.crmCustomerFindFirst;
    prisma.crmEquipment.findFirst = originals.crmEquipmentFindFirst;
    prisma.tenant.findUnique = originals.tenantFindUnique;
  });

  prisma.serviceOrder.findFirst = async () => null;
  prisma.externalSyncRecord.findUnique = async () => ({
    externalId: '91535',
    receivedAt: new Date('2026-08-17T18:38:56Z'),
    syncedAt: new Date('2026-08-19T13:15:11Z'),
    payload: {
      externalId: '91535', clientExternalId: '451', clientName: 'ESCOLA AFONSO',
      equipmentExternalId: '950', equipmentModel: 'BROTHER 8952DW', status: 'CONCLUIDO',
      defect: 'PAPEL PRESO', raw: { seqos: 91535, cdcliente: 451, cdequipamento: 950 },
    },
  });
  prisma.crmCustomer.findFirst = async () => ({ id: 'customer-451', externalId: '451', name: 'ESCOLA AFONSO', phone: '5551999999999' });
  prisma.crmEquipment.findFirst = async () => ({ id: 'equipment-950', externalId: '950', model: 'BROTHER 8952DW', isActive: true });
  prisma.tenant.findUnique = async () => ({ id: 'tenant-1', settings: {} });

  const resolved = await resolveServiceOrderForPdf('tenant-1', '91535');
  assert.equal(resolved, null);
});

test('bloqueia impressao de O.S. provisoria ou em erro', async (context) => {
  const original = prisma.serviceOrder.findFirst;
  context.after(() => { prisma.serviceOrder.findFirst = original; });
  prisma.serviceOrder.findFirst = async () => ({
    id: 'provisoria', externalId: null, status: 'ERRO_INTEGRACAO',
    contact: { id: 'contact-1', name: 'Cliente', crmCustomer: null },
    equipment: { id: 'equipment-1', model: 'Impressora' },
    tenant: { id: 'tenant-1', settings: {} }, user: null,
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await generatePdf({ params: { id: 'provisoria' }, user: { tenantId: 'tenant-1' } }, response);
  assert.equal(response.statusCode, 409);
  assert.match(response.body.error, /nao foi confirmada/i);
});
