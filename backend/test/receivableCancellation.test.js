const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { normalizeReceivable } = require('../src/controllers/crmController');
const { reconcileReceivablesSnapshot } = require('../src/controllers/firebirdSyncController');

test('titulo cancelado ou removido da origem nunca permanece em aberto', () => {
  const cancelledInvoice = normalizeReceivable({
    externalId: '19107',
    payload: { value: 2499.2, openValue: 2499.2, invoiceCancelled: true },
  });
  const removedAtSource = normalizeReceivable({
    externalId: '19108',
    payload: { value: 120, openValue: 120, sourceDeleted: true },
  });
  const cancelledStatus = normalizeReceivable({
    externalId: '19109',
    payload: { value: 80, openValue: 80, statusLabel: 'Cancelado no iLux' },
  });

  assert.equal(cancelledInvoice.isCancelled, true);
  assert.equal(cancelledInvoice.status, 'cancelled');
  assert.equal(removedAtSource.isCancelled, true);
  assert.equal(removedAtSource.status, 'cancelled');
  assert.equal(cancelledStatus.isCancelled, true);
  assert.equal(cancelledStatus.status, 'cancelled');
});

test('snapshot marca apenas titulos ausentes dentro da janela autoritativa', async (context) => {
  const originalFindMany = prisma.externalSyncRecord.findMany;
  const originalUpdate = prisma.externalSyncRecord.update;
  context.after(() => {
    prisma.externalSyncRecord.findMany = originalFindMany;
    prisma.externalSyncRecord.update = originalUpdate;
  });

  prisma.externalSyncRecord.findMany = async () => ([
    { id: 'before', externalId: '19099', payload: { invoiceNumber: '14799' } },
    { id: 'present', externalId: '19100', payload: { invoiceNumber: '14800' } },
    { id: 'removed', externalId: '19107', payload: { invoiceNumber: '14815' } },
    { id: 'after', externalId: '19121', payload: { invoiceNumber: '14826' } },
  ]);
  const updates = [];
  prisma.externalSyncRecord.update = async (args) => { updates.push(args); return args.data; };

  const reconciled = await reconcileReceivablesSnapshot('tenant-1', {
    completeWindow: true,
    count: 2,
    minExternalId: 19100,
    maxExternalId: 19120,
    externalIds: ['19100', '19120'],
    capturedAt: '2026-08-27T17:00:00',
  });

  assert.equal(reconciled, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, 'removed');
  assert.equal(updates[0].data.payload.sourceDeleted, true);
  assert.equal(updates[0].data.payload.invoiceNumber, '14815');
});

test('snapshot incompleto nao altera o cache financeiro', async () => {
  await assert.rejects(
    reconcileReceivablesSnapshot('tenant-1', {
      completeWindow: false,
      count: 1,
      minExternalId: 19100,
      maxExternalId: 19100,
      externalIds: ['19100'],
    }),
    /invalido ou incompleto/,
  );
});
