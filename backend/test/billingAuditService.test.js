const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { auditBillingDocuments } = require('../src/services/billingAuditService');

function patch(context, { requests = [], statements = [] } = {}) {
  const ogReq = prisma.externalSyncRecord.findMany;
  const ogStmt = prisma.crmBillingStatement.findMany;
  context.after(() => {
    prisma.externalSyncRecord.findMany = ogReq;
    prisma.crmBillingStatement.findMany = ogStmt;
  });
  prisma.externalSyncRecord.findMany = async () => requests.map((payload) => ({ payload }));
  prisma.crmBillingStatement.findMany = async () => statements;
}

test('value_mismatch: amountOk=false vira alerta de valor', async (context) => {
  patch(context, {
    requests: [
      { status: 'success', source: 'ilux-export-folder', documentType: 'boleto', receivableExternalId: '18741', amountOk: false, receivableValue: 141.3, sha256: 'a' },
      { status: 'success', source: 'ilux-export-folder', documentType: 'invoice', receivableExternalId: '18742', amountOk: true, sha256: 'b' },
      // re-render do CRM nao entra na auditoria de pasta
      { status: 'success', source: 'crm-rerender', documentType: 'statement', receivableExternalId: '18743', amountOk: false, sha256: 'c' },
    ],
  });
  const { items, summary } = await auditBillingDocuments('t1');
  assert.equal(summary.value_mismatch, 1);
  const mm = items.find((i) => i.kind === 'value_mismatch');
  assert.equal(mm.receivableExternalId, '18741');
  assert.match(mm.detail, /141\.30/);
});

test('duplicate_file: mesmo sha256 em titulos diferentes', async (context) => {
  patch(context, {
    requests: [
      { status: 'success', source: 'ilux-export-folder', documentType: 'boleto', receivableExternalId: '100', amountOk: true, sha256: 'dup' },
      { status: 'success', source: 'ilux-export-folder', documentType: 'boleto', receivableExternalId: '200', amountOk: true, sha256: 'dup' },
      { status: 'success', source: 'ilux-export-folder', documentType: 'boleto', receivableExternalId: '300', amountOk: true, sha256: 'unico' },
    ],
  });
  const { items, summary } = await auditBillingDocuments('t1');
  assert.equal(summary.duplicate_file, 1);
  const dup = items.find((i) => i.kind === 'duplicate_file');
  assert.deepEqual(new Set(dup.receivableExternalIds), new Set(['100', '200']));
});

test('mesmo arquivo no mesmo titulo (copia em 2 pastas) NAO e duplicidade', async (context) => {
  patch(context, {
    requests: [
      { status: 'success', source: 'ilux-export-folder', documentType: 'boleto', receivableExternalId: '100', amountOk: true, sha256: 'x' },
      { status: 'success', source: 'ilux-export-folder', documentType: 'statement', receivableExternalId: '100', amountOk: true, sha256: 'x' },
    ],
  });
  const { summary } = await auditBillingDocuments('t1');
  assert.equal(summary.duplicate_file, 0);
});

test('statement_inconsistent: fixo+excedente != total', async (context) => {
  patch(context, {
    statements: [
      { externalId: '14890', period: '2026/08', receivableExternalId: '19220', totalValue: 5375.93, fixedValue: 358.33, excessValue: 5017.6 }, // fecha
      { externalId: '14999', period: '2026/08', receivableExternalId: '19999', totalValue: 1000, fixedValue: 400, excessValue: 300 }, // 700 != 1000
    ],
  });
  const { items, summary } = await auditBillingDocuments('t1');
  assert.equal(summary.statement_inconsistent, 1);
  assert.equal(items[0].statementExternalId, '14999');
});

test('tudo certo -> sem itens', async (context) => {
  patch(context, {
    requests: [{ status: 'success', source: 'ilux-export-folder', documentType: 'boleto', receivableExternalId: '1', amountOk: true, sha256: 'z' }],
    statements: [{ externalId: '1', totalValue: 100, fixedValue: 100, excessValue: 0 }],
  });
  const { items, summary } = await auditBillingDocuments('t1');
  assert.equal(items.length, 0);
  assert.equal(summary.total, 0);
});
