const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const svc = require('../src/services/billingStatementService');

function patch(context, overrides = {}) {
  const targets = {
    'tenantSettings.findUnique': overrides.settings,
    'crmBillingStatement.findFirst': overrides.statement,
    'crmCustomer.findFirst': overrides.customer ?? (async () => null),
    'externalSyncRecord.findFirst': overrides.company ?? (async () => null),
  };
  const restore = [];
  for (const [pathKey, impl] of Object.entries(targets)) {
    if (impl === undefined) continue;
    const [model, method] = pathKey.split('.');
    const original = prisma[model][method];
    restore.push(() => { prisma[model][method] = original; });
    prisma[model][method] = typeof impl === 'function' ? impl : async () => impl;
  }
  context.after(() => restore.forEach((fn) => fn()));
}

const STATEMENT = {
  externalId: '14893',
  period: '2026/08',
  statementDate: new Date('2026-09-04T00:00:00-03:00'),
  dueDate: new Date('2026-09-22T00:00:00-03:00'),
  invoiceNumber: '14894',
  customerExternalId: '107',
  totalValue: 2075.35, fixedValue: 1080, excessValue: 995.35, discountValue: 0, surchargeValue: 0,
  notes: null,
  lines: [
    { lineNo: 0, contractExternalId: '585', equipmentName: 'XEROX', meterCode: 'PBA4',
      franchiseCharged: 405, excessCharged: 0, invoiceValue: 0, qtyProduction: 4389 },
  ],
};

const RECEIVABLE = { externalId: '19217', statementExternalId: '14893', billingPeriod: '2026/08' };

test('renderStatementPdf: flag desligada -> 501', async (context) => {
  patch(context, { settings: async () => ({ statementRerenderEnabled: false, osAccentColor: null }) });
  await assert.rejects(
    () => svc.renderStatementPdf({ tenantId: 't1', receivable: RECEIVABLE, customerName: 'ACME' }),
    (err) => err.statusCode === 501,
  );
});

test('renderStatementPdf: sem demonstrativo sincronizado -> 501', async (context) => {
  patch(context, {
    settings: async () => ({ statementRerenderEnabled: true, osAccentColor: '#D62828' }),
    statement: async () => null,
  });
  await assert.rejects(
    () => svc.renderStatementPdf({ tenantId: 't1', receivable: RECEIVABLE, customerName: 'ACME' }),
    (err) => err.statusCode === 501,
  );
});

test('renderStatementPdf: caminho feliz -> PDF base64 do demonstrativo', async (context) => {
  patch(context, {
    settings: async () => ({
      statementRerenderEnabled: true, osAccentColor: '#1D4ED8',
      companyName: 'EMPRESA X', companyCnpj: '12.345.678/0001-90',
    }),
    statement: async () => STATEMENT,
  });
  const result = await svc.renderStatementPdf({ tenantId: 't1', receivable: RECEIVABLE, customerName: 'ACME LTDA' });
  assert.equal(result.documentType, 'statement');
  assert.equal(result.source, 'crm-rerender');
  assert.equal(result.mimeType, 'application/pdf');
  assert.match(result.fileName, /DEMONSTRATIVO 2026.?08 - ACME LTDA\.pdf/);
  const pdf = Buffer.from(result.pdfBase64, 'base64');
  assert.ok(pdf.subarray(0, 4).equals(Buffer.from('%PDF')), 'deve comecar com %PDF');
  assert.ok(pdf.length > 800);
});

test('isStatementRerenderable: true so com flag ligada e demonstrativo presente', async (context) => {
  patch(context, {
    settings: async () => ({ statementRerenderEnabled: true }),
    statement: async () => STATEMENT,
  });
  assert.equal(await svc.isStatementRerenderable('t1', RECEIVABLE), true);
});

test('isStatementRerenderable: false com flag desligada', async (context) => {
  patch(context, { settings: async () => ({ statementRerenderEnabled: false }) });
  assert.equal(await svc.isStatementRerenderable('t1', RECEIVABLE), false);
});
