const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { listFlaggedBillingDocuments } = require('../src/controllers/crmController');
const billingDocuments = require('../src/services/billingDocumentService');

function fakeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('lista documentos financeiros marcados como falha, com o cliente CRM resolvido', async (context) => {
  const originalExternalFindMany = prisma.externalSyncRecord.findMany;
  const originalCustomerFindMany = prisma.crmCustomer.findMany;
  const originalSettings = prisma.tenantSettings.findUnique;
  context.after(() => {
    prisma.externalSyncRecord.findMany = originalExternalFindMany;
    prisma.crmCustomer.findMany = originalCustomerFindMany;
    prisma.tenantSettings.findUnique = originalSettings;
  });
  prisma.tenantSettings.findUnique = async () => ({ billingScanStatus: null });

  prisma.externalSyncRecord.findMany = async ({ where }) => {
    if (where.entity === billingDocuments.REQUEST_ENTITY && where.payload?.equals === 'pending') return [];
    if (where.entity === billingDocuments.REQUEST_ENTITY) {
      return [{
        id: 'req-1',
        payload: {
          status: 'failed',
          documentType: 'boleto',
          receivableExternalId: '18741',
          invoiceNumber: '14494',
          error: 'Mais de um Boleto oficial corresponde ao titulo. Revise a pasta monitorada.',
          requestedAt: '2026-08-17T10:00:00',
          completedAt: '2026-08-17T10:00:05',
          customerName: 'POSTAL DIGITAL (nome salvo no pedido)',
        },
      }];
    }
    if (where.entity === 'receivables') {
      return [{ externalId: '18741', payload: { clientExternalId: '326', invoiceNumber: '14494' } }];
    }
    return [];
  };
  prisma.crmCustomer.findMany = async () => ([
    { id: 'crm-customer-1', externalId: '326', name: 'Postal Digital LTDA', fantasyName: 'POSTAL DIGITAL' },
  ]);

  const req = { user: { tenantId: 'tenant-1', role: 'admin' } };
  const res = fakeRes();
  await listFlaggedBillingDocuments(req, res);

  assert.equal(res.body.items.length, 1);
  const [item] = res.body.items;
  assert.equal(item.customerId, 'crm-customer-1');
  assert.equal(item.customerName, 'POSTAL DIGITAL');
  assert.equal(item.documentType, 'boleto');
  assert.equal(item.receivableExternalId, '18741');
  assert.match(item.error, /Mais de um Boleto/);
});

test('nao resolve o cliente quando o titulo nao e encontrado, mas ainda assim lista o item', async (context) => {
  const originalExternalFindMany = prisma.externalSyncRecord.findMany;
  const originalSettings = prisma.tenantSettings.findUnique;
  context.after(() => {
    prisma.externalSyncRecord.findMany = originalExternalFindMany;
    prisma.tenantSettings.findUnique = originalSettings;
  });
  prisma.tenantSettings.findUnique = async () => null;

  prisma.externalSyncRecord.findMany = async ({ where }) => {
    if (where.entity === billingDocuments.REQUEST_ENTITY && where.payload?.equals === 'pending') return [];
    if (where.entity === billingDocuments.REQUEST_ENTITY) {
      return [{
        id: 'req-2',
        payload: {
          status: 'failed',
          documentType: 'invoice',
          receivableExternalId: '99999',
          error: 'Nota fiscal nao vinculada a este titulo no iLux.',
          customerName: 'Cliente sem titulo localizado',
        },
      }];
    }
    return [];
  };

  const req = { user: { tenantId: 'tenant-1', role: 'admin' } };
  const res = fakeRes();
  await listFlaggedBillingDocuments(req, res);

  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].customerId, null);
  assert.equal(res.body.items[0].customerName, 'Cliente sem titulo localizado');
});

test('bloqueia usuarios sem permissao financeira', async () => {
  const req = { user: { tenantId: 'tenant-1', role: 'agent' } };
  const res = fakeRes();
  await listFlaggedBillingDocuments(req, res);
  assert.equal(res.statusCode, 403);
});
