const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { pushBatch } = require('../src/controllers/firebirdSyncController');

const TOKEN = 'stmt-push-token';
const TENANT = { id: 't-stmt', slug: 'empresa', settings: { firebirdClientToken: TOKEN }, instances: [] };

function makeReq(body) {
  return {
    body: { tenantSlug: TENANT.slug, ...body },
    header: (n) => (String(n).toLowerCase() === 'x-firebird-token' ? TOKEN : undefined),
  };
}
function makeRes() {
  const res = { statusCode: 200, body: undefined, status(c) { res.statusCode = c; return res; }, json(p) { res.body = p; return res; } };
  return res;
}

function patch(context) {
  const calls = { upsert: [], deleteMany: [], createMany: [] };
  const og = {
    find: prisma.tenant.findUnique,
    settingsUpd: prisma.tenantSettings.update,
    upsert: prisma.crmBillingStatement.upsert,
    del: prisma.crmBillingStatementLine.deleteMany,
    create: prisma.crmBillingStatementLine.createMany,
    tx: prisma.$transaction,
    agent: prisma.firebirdAgent.upsert,
  };
  context.after(() => {
    prisma.tenant.findUnique = og.find;
    prisma.tenantSettings.update = og.settingsUpd;
    prisma.crmBillingStatement.upsert = og.upsert;
    prisma.crmBillingStatementLine.deleteMany = og.del;
    prisma.crmBillingStatementLine.createMany = og.create;
    prisma.$transaction = og.tx;
    prisma.firebirdAgent.upsert = og.agent;
  });
  prisma.tenant.findUnique = async () => ({ ...TENANT });
  prisma.tenantSettings.update = async () => ({});
  prisma.firebirdAgent.upsert = async () => ({});
  prisma.crmBillingStatement.upsert = async (args) => { calls.upsert.push(args); return { id: 'stmt-row-1' }; };
  prisma.crmBillingStatementLine.deleteMany = async (args) => { calls.deleteMany.push(args); return { count: 0 }; };
  prisma.crmBillingStatementLine.createMany = async (args) => { calls.createMany.push(args); return { count: args.data.length }; };
  prisma.$transaction = async (ops) => Promise.all(ops);
  return calls;
}

const RECORD = {
  externalId: '14893',
  period: '2026/08',
  statementDate: '2026-09-04T00:00:00',
  dueDate: '2026-09-22T00:00:00',
  customerExternalId: '107',
  receivableExternalId: '19217',
  invoiceNumber: '14894',
  totalValue: 2075.35,
  fixedValue: 1080,
  excessValue: 995.35,
  lineCount: 2,
  lines: [
    { lineNo: 0, contractExternalId: '585', equipmentExternalId: '333', meterCode: 'PBA4',
      qtyProduction: 4389, franchiseCharged: 405, excessCharged: 0, excessValue: 45, isProrated: false },
    { lineNo: 1, contractExternalId: '585', equipmentExternalId: '335', meterCode: 'CORA4',
      qtyProduction: 1500, franchiseCharged: 135, excessCharged: 150, excessValue: 150, isProrated: true },
  ],
};

test('pushBatch billingStatement: upsert do header + recria as linhas', async (context) => {
  const calls = patch(context);
  const res = makeRes();
  await pushBatch(makeReq({ entity: 'billingStatement', records: [RECORD] }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.upsert.length, 1);
  const up = calls.upsert[0];
  assert.equal(up.where.tenantId_externalSource_externalId.externalId, '14893');
  assert.equal(up.create.tenantId, TENANT.id);
  assert.equal(up.update.totalValue, 2075.35);
  // parseNum destruiria 995.35 -> 99535; plainNum preserva
  assert.equal(up.update.excessValue, 995.35);
  assert.equal(up.update.receivableExternalId, '19217');
  assert.ok(up.update.statementDate instanceof Date);

  assert.equal(calls.deleteMany.length, 1);
  assert.equal(calls.deleteMany[0].where.statementId, 'stmt-row-1');
  assert.equal(calls.createMany.length, 1);
  assert.equal(calls.createMany[0].data.length, 2);
  const line1 = calls.createMany[0].data[1];
  assert.equal(line1.statementId, 'stmt-row-1');
  assert.equal(line1.lineNo, 1);
  assert.equal(line1.excessCharged, 150);
  assert.equal(line1.isProrated, true);
  assert.equal(line1.meterCode, 'CORA4');
});

test('pushBatch billingStatement: sem externalId -> skipped, sem upsert', async (context) => {
  const calls = patch(context);
  const res = makeRes();
  await pushBatch(makeReq({ entity: 'billingStatement', records: [{ period: '2026/08', lines: [] }] }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.upsert.length, 0);
  assert.equal(res.body.stats.skipped, 1);
});

test('pushBatch billingStatement: header-only nao chama createMany', async (context) => {
  const calls = patch(context);
  const res = makeRes();
  await pushBatch(makeReq({ entity: 'billingStatement', records: [{ ...RECORD, lines: [] }] }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.upsert.length, 1);
  assert.equal(calls.deleteMany.length, 1);
  assert.equal(calls.createMany.length, 0);
});
