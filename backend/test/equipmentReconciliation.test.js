const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { reconcileEquipmentsSnapshot } = require('../src/controllers/firebirdSyncController');

test('snapshot desativa apenas equipamentos ausentes dentro da janela autoritativa', async (context) => {
  const originalFindMany = prisma.crmEquipment.findMany;
  const originalUpdateMany = prisma.crmEquipment.updateMany;
  context.after(() => {
    prisma.crmEquipment.findMany = originalFindMany;
    prisma.crmEquipment.updateMany = originalUpdateMany;
  });

  prisma.crmEquipment.findMany = async () => ([
    { id: 'antes', externalId: '10' },   // fora da janela (abaixo do min)
    { id: 'presente', externalId: '826' },
    { id: 'sumiu', externalId: '1543' },  // dentro da janela e ausente do snapshot
    { id: 'depois', externalId: '9999' }, // fora da janela (acima do max)
  ]);
  const updates = [];
  prisma.crmEquipment.updateMany = async (args) => { updates.push(args); return { count: args.where.id.in.length }; };

  const deactivated = await reconcileEquipmentsSnapshot('tenant-1', {
    completeWindow: true,
    count: 2,
    minExternalId: 800,
    maxExternalId: 2100,
    externalIds: ['826', '2080'],
    capturedAt: '2026-08-27T17:00:00',
  });

  assert.equal(deactivated, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where.id.in, ['sumiu']);
  assert.equal(updates[0].data.isActive, false);
});

test('snapshot sem nenhum equipamento ausente nao dispara update', async (context) => {
  const originalFindMany = prisma.crmEquipment.findMany;
  const originalUpdateMany = prisma.crmEquipment.updateMany;
  context.after(() => {
    prisma.crmEquipment.findMany = originalFindMany;
    prisma.crmEquipment.updateMany = originalUpdateMany;
  });
  prisma.crmEquipment.findMany = async () => ([{ id: 'a', externalId: '826' }]);
  let called = false;
  prisma.crmEquipment.updateMany = async () => { called = true; return { count: 0 }; };

  const deactivated = await reconcileEquipmentsSnapshot('tenant-1', {
    completeWindow: true, count: 1, minExternalId: 800, maxExternalId: 900,
    externalIds: ['826'],
  });

  assert.equal(deactivated, 0);
  assert.equal(called, false);
});

test('snapshot incompleto nao mexe nos equipamentos', async () => {
  await assert.rejects(
    reconcileEquipmentsSnapshot('tenant-1', {
      completeWindow: false, count: 1, minExternalId: 1, maxExternalId: 1, externalIds: ['1'],
    }),
    /invalido ou incompleto/,
  );
});

test('snapshot contratado vazio desativa equipamentos sem SEQCONTRATO antigos', async (context) => {
  const originalFindMany = prisma.crmEquipment.findMany;
  const originalUpdateMany = prisma.crmEquipment.updateMany;
  context.after(() => {
    prisma.crmEquipment.findMany = originalFindMany;
    prisma.crmEquipment.updateMany = originalUpdateMany;
  });
  prisma.crmEquipment.findMany = async () => ([{ id: 'sem-contrato', externalId: '1543' }]);
  const updates = [];
  prisma.crmEquipment.updateMany = async (args) => {
    updates.push(args);
    return { count: args.where.id.in.length };
  };

  const deactivated = await reconcileEquipmentsSnapshot('tenant-1', {
    completeWindow: true,
    scope: 'contracted',
    count: 0,
    externalIds: [],
  });

  assert.equal(deactivated, 1);
  assert.deepEqual(updates[0].where.id.in, ['sem-contrato']);
});
