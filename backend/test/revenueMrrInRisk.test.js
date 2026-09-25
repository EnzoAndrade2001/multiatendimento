const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { getRevenueDashboard } = require('../src/controllers/revenueController');
const crmController = require('../src/controllers/crmController');

function fakeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('MRR usa LCDDIGITALWEB, depois mensalidade do CRM e por fim fallback manual', async (context) => {
  const originalSettingsFindUnique = prisma.tenantSettings.findUnique;
  const originalExternalFindMany = prisma.externalSyncRecord.findMany;
  const originalCustomerFindMany = prisma.crmCustomer.findMany;
  const originalTicketCount = prisma.ticket.count;
  const originalSnapshotUpsert = prisma.revenueSnapshot.upsert;
  const originalSnapshotFindFirst = prisma.revenueSnapshot.findFirst;
  const originalLoadContracts = crmController.loadContracts;

  context.after(() => {
    prisma.tenantSettings.findUnique = originalSettingsFindUnique;
    prisma.externalSyncRecord.findMany = originalExternalFindMany;
    prisma.crmCustomer.findMany = originalCustomerFindMany;
    prisma.ticket.count = originalTicketCount;
    prisma.revenueSnapshot.upsert = originalSnapshotUpsert;
    prisma.revenueSnapshot.findFirst = originalSnapshotFindFirst;
    crmController.loadContracts = originalLoadContracts;
  });

  prisma.tenantSettings.findUnique = async () => ({
    kpiContractValue: 1200,
    kpiServiceValue: 350,
    kpiSlaLimitHours: 24,
    kpiReincidentThreshold: 2,
  });

  const openedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  prisma.externalSyncRecord.findMany = async ({ where }) => {
    if (where?.entity !== 'serviceOrders') return [];
    return [
      { externalId: 'os-1', receivedAt: new Date(), payload: { raw: { status: 'E', dtinclusao: openedAt, cdcliente: 'ext-1', nmcliente: 'Contrato Firebird', cdequipamento: 'eq-1' } } },
      { externalId: 'os-2', receivedAt: new Date(), payload: { raw: { status: 'E', dtinclusao: openedAt, cdcliente: 'ext-2', nmcliente: 'Mensalidade CRM', cdequipamento: 'eq-2' } } },
      { externalId: 'os-3', receivedAt: new Date(), payload: { raw: { status: 'E', dtinclusao: openedAt, cdcliente: 'ext-3', nmcliente: 'Fallback manual', cdequipamento: 'eq-3' } } },
    ];
  };

  prisma.crmCustomer.findMany = async () => [
    { externalId: 'ext-1', raw: { total_mensalidade: '999,99' } },
    { externalId: 'ext-2', raw: { total_mensalidade: '850,00' } },
    { externalId: 'ext-3', raw: {} },
  ];
  prisma.ticket.count = async () => 0;
  prisma.revenueSnapshot.upsert = async () => ({});
  prisma.revenueSnapshot.findFirst = async () => null;

  crmController.loadContracts = async (_tenantId, externalId) => {
    if (externalId === 'ext-1') {
      return [
        { isActive: true, monthlyValue: 500 },
        { isActive: true, monthlyValue: 300 },
        { isActive: false, monthlyValue: 10000 },
      ];
    }
    return [];
  };

  const res = fakeRes();
  await getRevenueDashboard({ user: { tenantId: 'tenant-1' } }, res);

  assert.equal(res.body.mrrInRisk, 800 + 850 + 1200);
  assert.deepEqual(res.body.dataQuality.mrr.valueSources, {
      ilux_web: 1,
    crm: 1,
    manual_estimate: 1,
    missing: 0,
  });
  assert.equal(res.body.rankingClientsAtRisk.find((item) => item.clientExternalId === 'ext-1').valueSource, 'ilux_web');
  assert.equal(res.body.rankingClientsAtRisk.find((item) => item.clientExternalId === 'ext-2').valueSource, 'crm');
  assert.equal(res.body.rankingClientsAtRisk.find((item) => item.clientExternalId === 'ext-3').valueSource, 'manual_estimate');
  assert.equal(res.body.synchronization.source, 'ilux_web');
});

test('reincidência respeita o limite configurado no detalhamento', async (context) => {
  const originalSettingsFindUnique = prisma.tenantSettings.findUnique;
  const originalExternalFindMany = prisma.externalSyncRecord.findMany;
  const originalCustomerFindMany = prisma.crmCustomer.findMany;
  context.after(() => {
    prisma.tenantSettings.findUnique = originalSettingsFindUnique;
    prisma.externalSyncRecord.findMany = originalExternalFindMany;
    prisma.crmCustomer.findMany = originalCustomerFindMany;
  });

  prisma.tenantSettings.findUnique = async () => ({ kpiSlaLimitHours: 8, kpiReincidentThreshold: 3 });
  const openedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  prisma.externalSyncRecord.findMany = async ({ where }) => where?.entity === 'serviceOrders'
    ? [1, 2, 3].map((id) => ({ externalId: `os-${id}`, payload: { raw: { status: 'E', dtinclusao: openedAt, cdcliente: 'ext-1', cdequipamento: 'eq-1', modelo: 'Laser' } } }))
    : [];
  prisma.crmCustomer.findMany = async () => [{ externalId: 'ext-1', fantasyName: 'Cliente', name: 'Cliente' }];

  const res = fakeRes();
  await require('../src/controllers/revenueController').getDrilldown({
    user: { tenantId: 'tenant-1' },
    params: { type: 'reincident_equipments' },
  }, res);

  assert.deepEqual(res.body, []);
});
