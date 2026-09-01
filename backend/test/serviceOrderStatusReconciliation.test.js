const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { reconcileServiceOrderStatuses } = require('../src/services/serviceOrderStatusReconciliationService');

test('reconcilia O.S. antiga marcada como PENDENTE quando o espelho diz CANCELADA', { concurrency: false }, async () => {
  const originals = {
    orderFindMany: prisma.serviceOrder.findMany,
    recordFindMany: prisma.externalSyncRecord.findMany,
    orderUpdate: prisma.serviceOrder.update,
  };
  const updates = [];
  prisma.serviceOrder.findMany = async () => [{ id: 'local-5293', externalId: '5293', status: 'PENDENTE' }];
  prisma.externalSyncRecord.findMany = async () => [{ externalId: '5293', payload: { raw: { nmstatus: 'Cancelado' } } }];
  prisma.serviceOrder.update = async (args) => { updates.push(args); return args.data; };
  try {
    const result = await reconcileServiceOrderStatuses('tenant-1', { equipmentId: 'equipment-1' });
    assert.deepEqual(result, { checked: 1, updated: 1 });
    assert.equal(updates[0].where.id, 'local-5293');
    assert.equal(updates[0].data.status, 'CANCELADA');
  } finally {
    prisma.serviceOrder.findMany = originals.orderFindMany;
    prisma.externalSyncRecord.findMany = originals.recordFindMany;
    prisma.serviceOrder.update = originals.orderUpdate;
  }
});

test('nao rebaixa status quando o espelho legado nao informa situacao', { concurrency: false }, async () => {
  const originals = {
    orderFindMany: prisma.serviceOrder.findMany,
    recordFindMany: prisma.externalSyncRecord.findMany,
    orderUpdate: prisma.serviceOrder.update,
  };
  let updates = 0;
  prisma.serviceOrder.findMany = async () => [{ id: 'local-1', externalId: '1', status: 'EM_ATENDIMENTO' }];
  prisma.externalSyncRecord.findMany = async () => [{ externalId: '1', payload: { raw: {} } }];
  prisma.serviceOrder.update = async () => { updates += 1; };
  try {
    const result = await reconcileServiceOrderStatuses('tenant-1');
    assert.deepEqual(result, { checked: 1, updated: 0 });
    assert.equal(updates, 0);
  } finally {
    prisma.serviceOrder.findMany = originals.orderFindMany;
    prisma.externalSyncRecord.findMany = originals.recordFindMany;
    prisma.serviceOrder.update = originals.orderUpdate;
  }
});
