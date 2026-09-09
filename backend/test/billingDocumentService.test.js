const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/services/billingDocumentService');
const { _private } = service;
const prisma = require('../src/lib/prisma');

test('identifica a disponibilidade dos tres documentos pelo vinculo do titulo', () => {
  const receivable = {
    invoiceExternalId: '15894',
    invoiceNumber: '14494',
    statementExternalId: '14466',
    hasBoleto: true,
  };
  assert.equal(_private.documentAvailability(receivable, 'invoice'), true);
  assert.equal(_private.documentAvailability(receivable, 'statement'), true);
  assert.equal(_private.documentAvailability(receivable, 'boleto'), true);
});

test('nao anuncia boleto ausente como disponivel', () => {
  assert.equal(_private.documentAvailability({ invoiceNumber: '100', hasBoleto: false }, 'boleto'), false);
});

test('sourceLabel traduz a origem do documento', () => {
  assert.equal(service.sourceLabel('crm-rerender'), 'gerado pelo CRM');
  assert.equal(service.sourceLabel('ilux-export-folder'), 'arquivo da pasta');
  assert.equal(service.sourceLabel('plugboleto'), 'API do banco');
  assert.equal(service.sourceLabel('outra-coisa'), null);
  assert.equal(service.sourceLabel(null), null);
});

test('completeDocumentRequest grava a origem (source) no registro do documento', async (context) => {
  const fs = require('fs');
  const ogWrite = fs.promises.writeFile;
  const ogUpdate = prisma.externalSyncRecord.update;
  context.after(() => { fs.promises.writeFile = ogWrite; prisma.externalSyncRecord.update = ogUpdate; });

  fs.promises.writeFile = async () => {};
  let saved = null;
  prisma.externalSyncRecord.update = async (args) => { saved = args.data.payload; return {}; };

  await service.completeDocumentRequest({
    request: { id: 'req-1', payload: { documentType: 'statement', fileName: 'd.pdf' } },
    success: true,
    result: {
      documentType: 'statement',
      pdfBase64: Buffer.from('%PDF-1.4 teste').toString('base64'),
      fileName: 'DEMONSTRATIVO.pdf',
      mimeType: 'application/pdf',
      source: 'crm-rerender',
    },
  });

  assert.equal(saved.status, 'success');
  assert.equal(saved.source, 'crm-rerender');
  assert.match(saved.mediaUrl, /^\/uploads\/media\//);
});

test('gera chaves independentes por titulo e tipo de documento', () => {
  assert.equal(_private.requestExternalId('18741', 'invoice'), 'official-v1:18741:invoice');
  assert.equal(_private.requestExternalId('18741', 'statement'), 'official-v1:18741:statement');
  assert.equal(_private.requestExternalId('18741', 'boleto'), 'official-v1:18741:boleto');
});

test('gera nomes legiveis e seguros para envio no WhatsApp', () => {
  const receivable = { externalId: '18741', invoiceNumber: '14494', billingPeriod: '07/2026' };
  assert.equal(_private.defaultFileName('invoice', receivable, 'Postál Digital'), 'NF 14494 - POSTAL DIGITAL.pdf');
  assert.equal(_private.defaultFileName('statement', receivable, 'Postál Digital'), 'DEMONSTRATIVO 07 2026 - POSTAL DIGITAL.pdf');
  assert.equal(_private.defaultFileName('boleto', receivable, 'Postál Digital'), 'BOLETO NF 14494 - POSTAL DIGITAL.pdf');
});

test('rejeita tipos de documento fora da lista permitida', () => {
  assert.throws(() => _private.assertDocumentType('contrato'), /Tipo de documento financeiro invalido/);
});

test('nao habilita reenvio por uma instancia desconectada', async (context) => {
  const original = prisma.ticket.findFirst;
  context.after(() => { prisma.ticket.findFirst = original; });
  prisma.ticket.findFirst = async () => ({
    id: 'ticket-1',
    contactId: 'contact-1',
    instanceId: 'instance-1',
    contact: { name: 'Cliente', phone: '51999999999' },
    instance: { instanceName: 'atendimento', status: 'disconnected' },
  });
  const delivery = await service.resolveDelivery({ tenantId: 'tenant-1', customerId: 'customer-1' });
  assert.equal(delivery.available, false);
  assert.match(delivery.unavailableReason, /desconectada/);
});
