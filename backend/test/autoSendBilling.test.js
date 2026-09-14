const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const billingDocuments = require('../src/services/billingDocumentService');
const evolutionService = require('../src/services/evolutionService');
const { autoSendBilling } = require('../src/controllers/billingController');

const TOKEN = 'agente-token-teste';

function fakeReq(body) {
  return {
    body,
    header(name) {
      return name.toLowerCase() === 'x-firebird-token' ? TOKEN : undefined;
    },
  };
}

function fakeRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const TENANT = {
  id: 'tenant-1',
  slug: 'lcd',
  settings: { firebirdClientToken: TOKEN, evolutionUrl: 'https://evolution.example', evolutionKey: 'evo-key' },
  instances: [{ id: 'instance-1', instanceName: 'atendimento', status: 'connected' }],
};

test('valida campos obrigatorios antes de qualquer acesso ao banco', async () => {
  const res1 = fakeRes();
  await autoSendBilling(fakeReq({}), res1);
  assert.equal(res1.statusCode, 400);

  const res2 = fakeRes();
  await autoSendBilling(fakeReq({ tenantSlug: 'lcd' }), res2);
  assert.equal(res2.statusCode, 400);

  const res3 = fakeRes();
  await autoSendBilling(fakeReq({ tenantSlug: 'lcd', receivableExternalId: '18741' }), res3);
  assert.equal(res3.statusCode, 400);
});

test('404 quando o tenant nao existe', async (context) => {
  const original = prisma.tenant.findUnique;
  context.after(() => { prisma.tenant.findUnique = original; });
  prisma.tenant.findUnique = async () => null;

  const res = fakeRes();
  await autoSendBilling(fakeReq({
    tenantSlug: 'inexistente',
    receivableExternalId: '18741',
    documents: [{ documentType: 'boleto', pdfBase64: 'AA==', fileName: 'a.pdf' }],
  }), res);
  assert.equal(res.statusCode, 404);
});

test('404 quando o titulo nao foi sincronizado do Firebird', async (context) => {
  const originalTenant = prisma.tenant.findUnique;
  const originalRecord = prisma.externalSyncRecord.findFirst;
  context.after(() => {
    prisma.tenant.findUnique = originalTenant;
    prisma.externalSyncRecord.findFirst = originalRecord;
  });
  prisma.tenant.findUnique = async () => TENANT;
  prisma.externalSyncRecord.findFirst = async () => null;

  const res = fakeRes();
  await autoSendBilling(fakeReq({
    tenantSlug: 'lcd',
    receivableExternalId: '99999',
    documents: [{ documentType: 'boleto', pdfBase64: 'AA==', fileName: 'a.pdf' }],
  }), res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.error, /não encontrado/);
});

test('nunca chama o WhatsApp quando o opt-in do contato esta desligado', async (context) => {
  const originalTenant = prisma.tenant.findUnique;
  const originalExternalFindFirst = prisma.externalSyncRecord.findFirst;
  const originalExternalFindUnique = prisma.externalSyncRecord.findUnique;
  const originalCustomerFindFirst = prisma.crmCustomer.findFirst;
  const originalContactFindMany = prisma.contact.findMany;
  const originalBillingLogCreate = prisma.billingLog.create;
  const originalBillingLogFindFirst = prisma.billingLog.findFirst;
  const originalQueue = billingDocuments.queueDocumentRequest;
  const originalComplete = billingDocuments.completeDocumentRequest;
  const originalSendMedia = evolutionService.sendMedia;
  const originalSendText = evolutionService.sendText;
  context.after(() => {
    prisma.tenant.findUnique = originalTenant;
    prisma.externalSyncRecord.findFirst = originalExternalFindFirst;
    prisma.externalSyncRecord.findUnique = originalExternalFindUnique;
    prisma.crmCustomer.findFirst = originalCustomerFindFirst;
    prisma.contact.findMany = originalContactFindMany;
    prisma.billingLog.create = originalBillingLogCreate;
    prisma.billingLog.findFirst = originalBillingLogFindFirst;
    billingDocuments.queueDocumentRequest = originalQueue;
    billingDocuments.completeDocumentRequest = originalComplete;
    evolutionService.sendMedia = originalSendMedia;
    evolutionService.sendText = originalSendText;
  });

  prisma.tenant.findUnique = async () => TENANT;
  prisma.externalSyncRecord.findFirst = async ({ where }) => {
    if (where.entity === 'receivables') {
      return { payload: { clientExternalId: '326' } };
    }
    return null;
  };
  prisma.crmCustomer.findFirst = async ({ where, include }) => {
    if (where.externalId === '326') {
      return {
        id: 'crm-customer-1', externalId: '326', name: 'Postal Digital LTDA', fantasyName: 'POSTAL DIGITAL', cpfCnpj: '01971259000142',
      };
    }
    if (include?.whatsappContacts) {
      // findContactByCpfCnpj's first lookup path.
      return {
        whatsappContacts: [{ id: 'contact-1', name: 'Postal Digital', enableWhatsAppBilling: false, whatsapp: '5551999999999', externalSource: null }],
      };
    }
    return null;
  };
  prisma.contact.findMany = async () => [];
  let queuedDocument = false;
  billingDocuments.queueDocumentRequest = async ({ documentType }) => {
    queuedDocument = true;
    return { id: `req-${documentType}`, externalId: `x:${documentType}`, payload: { documentType } };
  };
  billingDocuments.completeDocumentRequest = async () => {};
  prisma.externalSyncRecord.findUnique = async ({ where }) => ({
    payload: { fileName: 'BOLETO NF 14494 - POSTAL DIGITAL.pdf', mediaUrl: '/uploads/media/fake.pdf', mimeType: 'application/pdf', documentType: 'boleto' },
  });
  let billingLogged = null;
  prisma.billingLog.create = async ({ data }) => { billingLogged = data; return data; };
  prisma.billingLog.findFirst = async () => null; // nenhum SKIPPED recente para este cliente
  let mediaSent = false;
  let textSent = false;
  evolutionService.sendMedia = async () => { mediaSent = true; return {}; };
  evolutionService.sendText = async () => { textSent = true; return {}; };

  const res = fakeRes();
  await autoSendBilling(fakeReq({
    tenantSlug: 'lcd',
    receivableExternalId: '18741',
    sendPolicy: 'Somente Marcados',
    documents: [{ documentType: 'boleto', pdfBase64: 'AA==', fileName: 'a.pdf', mimeType: 'application/pdf' }],
  }), res);

  assert.equal(res.statusCode, undefined); // 200 default
  assert.equal(res.body.success, true);
  assert.equal(res.body.skipped, true);
  assert.equal(mediaSent, false, 'nao deveria ter enviado midia com opt-in desligado');
  assert.equal(textSent, false, 'nao deveria ter enviado texto com opt-in desligado');
  // O endpoint deve validar o opt-in antes de persistir/cachar os PDFs.
  assert.equal(queuedDocument, false);
  assert.equal(billingLogged.status, 'SKIPPED');
  assert.match(billingLogged.errorMessage, /desativado para este contato/);
});

test('nao regrava SKIPPED quando ja existe um recente para o mesmo cliente (evita ruido diario)', async (context) => {
  const originals = {
    tenant: prisma.tenant.findUnique,
    externalFindFirst: prisma.externalSyncRecord.findFirst,
    externalFindUnique: prisma.externalSyncRecord.findUnique,
    customerFindFirst: prisma.crmCustomer.findFirst,
    contactFindMany: prisma.contact.findMany,
    billingLogCreate: prisma.billingLog.create,
    billingLogFindFirst: prisma.billingLog.findFirst,
    queue: billingDocuments.queueDocumentRequest,
    sendMedia: evolutionService.sendMedia,
    sendText: evolutionService.sendText,
  };
  context.after(() => {
    prisma.tenant.findUnique = originals.tenant;
    prisma.externalSyncRecord.findFirst = originals.externalFindFirst;
    prisma.externalSyncRecord.findUnique = originals.externalFindUnique;
    prisma.crmCustomer.findFirst = originals.customerFindFirst;
    prisma.contact.findMany = originals.contactFindMany;
    prisma.billingLog.create = originals.billingLogCreate;
    prisma.billingLog.findFirst = originals.billingLogFindFirst;
    billingDocuments.queueDocumentRequest = originals.queue;
    evolutionService.sendMedia = originals.sendMedia;
    evolutionService.sendText = originals.sendText;
  });

  prisma.tenant.findUnique = async () => TENANT;
  prisma.externalSyncRecord.findFirst = async ({ where }) => (
    where.entity === 'receivables' ? { payload: { clientExternalId: '326' } } : null
  );
  prisma.crmCustomer.findFirst = async ({ where, include }) => {
    if (where.externalId === '326') {
      return { id: 'crm-customer-1', externalId: '326', name: 'Postal Digital LTDA', fantasyName: 'POSTAL DIGITAL', cpfCnpj: '01971259000142' };
    }
    if (include?.whatsappContacts) {
      return { whatsappContacts: [{ id: 'contact-1', name: 'Postal Digital', enableWhatsAppBilling: false, whatsapp: '5551999999999', externalSource: null }] };
    }
    return null;
  };
  prisma.contact.findMany = async () => [];
  let queuedDocument = false;
  billingDocuments.queueDocumentRequest = async () => { queuedDocument = true; return {}; };
  let billingCreateCalls = 0;
  prisma.billingLog.create = async ({ data }) => { billingCreateCalls += 1; return data; };
  prisma.billingLog.findFirst = async ({ where }) => {
    assert.ok(where.sentAt?.gte instanceof Date);
    if (where.status === 'SUCCESS') {
      assert.equal(where.receivableExternalId, '18741');
      return null; // ainda nao enviado neste mes
    }
    assert.equal(where.cpfCnpj, '01971259000142');
    assert.equal(where.status, 'SKIPPED');
    return { id: 'skip-recente' }; // ja existe um SKIPPED recente
  };
  let mediaSent = false;
  let textSent = false;
  evolutionService.sendMedia = async () => { mediaSent = true; return {}; };
  evolutionService.sendText = async () => { textSent = true; return {}; };

  const res = fakeRes();
  await autoSendBilling(fakeReq({
    tenantSlug: 'lcd',
    receivableExternalId: '18741',
    sendPolicy: 'Somente Marcados',
    documents: [{ documentType: 'boleto', pdfBase64: 'AA==', fileName: 'a.pdf', mimeType: 'application/pdf' }],
  }), res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.skipped, true);
  assert.equal(billingCreateCalls, 0, 'nao deveria gravar outro SKIPPED com um recente ja registrado');
  assert.equal(queuedDocument, false);
  assert.equal(mediaSent, false);
  assert.equal(textSent, false);
});

test('D4: titulo emitido em mes anterior nao dispara envio automatico', async (context) => {
  const og = { tenant: prisma.tenant.findUnique, ff: prisma.externalSyncRecord.findFirst };
  context.after(() => { prisma.tenant.findUnique = og.tenant; prisma.externalSyncRecord.findFirst = og.ff; });
  prisma.tenant.findUnique = async () => TENANT;
  prisma.externalSyncRecord.findFirst = async ({ where }) => (where.entity === 'receivables'
    ? { payload: { clientExternalId: '326', issuedAt: '2026-07-15T00:00:00.000Z' } }
    : null);

  const res = fakeRes();
  await autoSendBilling(fakeReq({
    tenantSlug: 'lcd',
    receivableExternalId: '18741',
    documents: [{ documentType: 'boleto', boletoRef: { chaveIntegracao: 'C1', situacao: 'EMITIDO' }, fileName: 'b.pdf' }],
  }), res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.skipped, true);
  assert.match(res.body.message, /per[ií]odo anterior/i);
});

test('nao envia duas vezes o mesmo titulo financeiro dentro do mesmo mes', async (context) => {
  const originals = {
    tenant: prisma.tenant.findUnique,
    externalFindFirst: prisma.externalSyncRecord.findFirst,
    customerFindFirst: prisma.crmCustomer.findFirst,
    billingLogFindFirst: prisma.billingLog.findFirst,
    sendText: evolutionService.sendText,
    sendMedia: evolutionService.sendMedia,
  };
  context.after(() => {
    prisma.tenant.findUnique = originals.tenant;
    prisma.externalSyncRecord.findFirst = originals.externalFindFirst;
    prisma.crmCustomer.findFirst = originals.customerFindFirst;
    prisma.billingLog.findFirst = originals.billingLogFindFirst;
    evolutionService.sendText = originals.sendText;
    evolutionService.sendMedia = originals.sendMedia;
  });

  prisma.tenant.findUnique = async () => TENANT;
  prisma.externalSyncRecord.findFirst = async () => ({
    payload: { clientExternalId: '326', issuedAt: new Date().toISOString() },
  });
  prisma.crmCustomer.findFirst = async () => ({
    id: 'crm-customer-1', externalId: '326', name: 'Cliente', cpfCnpj: '01971259000142',
  });
  prisma.billingLog.findFirst = async ({ where }) => {
    assert.equal(where.tenantId, TENANT.id);
    assert.equal(where.receivableExternalId, '18741');
    assert.equal(where.status, 'SUCCESS');
    assert.ok(where.sentAt.gte instanceof Date);
    assert.ok(where.sentAt.lt instanceof Date);
    assert.equal(where.sentAt.gte.getDate(), 1);
    return { id: 'envio-anterior-no-mes' };
  };
  let whatsappCalls = 0;
  evolutionService.sendText = async () => { whatsappCalls += 1; };
  evolutionService.sendMedia = async () => { whatsappCalls += 1; };

  const res = fakeRes();
  await autoSendBilling(fakeReq({
    tenantSlug: 'lcd',
    receivableExternalId: '18741',
    sendPolicy: 'Somente Marcados',
    documents: [{ documentType: 'boleto', pdfBase64: 'AA==', fileName: 'a.pdf' }],
  }), res);

  assert.equal(res.body.success, true);
  assert.equal(res.body.duplicate, true);
  assert.match(res.body.message, /ja enviado automaticamente neste mes/i);
  assert.equal(whatsappCalls, 0);
});
