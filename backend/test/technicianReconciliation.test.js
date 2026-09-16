const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { reconcileTechniciansSnapshot } = require('../src/controllers/firebirdSyncController');

test('snapshot de tecnicos desativa usuarios que nao sao mais TIPO=S', async (context) => {
  const originalFindMany = prisma.crmTechnician.findMany;
  const originalUpdateMany = prisma.crmTechnician.updateMany;
  context.after(() => {
    prisma.crmTechnician.findMany = originalFindMany;
    prisma.crmTechnician.updateMany = originalUpdateMany;
  });

  prisma.crmTechnician.findMany = async () => ([
    { id: 'tecnico', name: 'Rodrigo' },
    { id: 'atendente', name: 'Luciano' },
  ]);
  const updates = [];
  prisma.crmTechnician.updateMany = async (args) => {
    updates.push(args);
    return { count: args.where.id.in.length };
  };

  const deactivated = await reconcileTechniciansSnapshot('tenant-1', {
    completeWindow: true,
    count: 1,
    externalIds: ['RODRIGO'],
  });

  assert.equal(deactivated, 1);
  assert.deepEqual(updates[0].where.id.in, ['atendente']);
  assert.equal(updates[0].data.isActive, false);
});

test('snapshot de tecnicos incompleto nao altera o espelho', async () => {
  await assert.rejects(
    reconcileTechniciansSnapshot('tenant-1', {
      completeWindow: false,
      count: 1,
      externalIds: ['RODRIGO'],
    }),
    /invalido ou incompleto/,
  );
});
