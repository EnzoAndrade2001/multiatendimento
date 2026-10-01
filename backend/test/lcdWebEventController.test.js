const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const controller = require('../src/controllers/lcdWebEventController');

function makeRequest(body, secret, timestamp = Math.floor(Date.now() / 1000), signatureOverride = null) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = signatureOverride || `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex')}`;
  const headers = {
    'x-lcd-web-signature': signature,
    'x-lcd-web-timestamp': String(timestamp),
    'x-lcd-web-tenant': 'lcddigital',
    'x-lcd-web-event-id': body.eventId,
  };
  return {
    body,
    rawBody,
    headers,
    header(name) { return headers[String(name).toLowerCase()]; },
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('rejeita evento LCD WEB com assinatura invalida', async () => {
  const previous = process.env.LCD_WEB_EVENTS_SECRET;
  process.env.LCD_WEB_EVENTS_SECRET = 'event-secret';
  try {
    const req = makeRequest({ eventId: 'evt-invalid', eventType: 'receivable.updated' }, 'wrong-secret');
    const res = makeResponse();
    await controller.handleLcdWebEvent(req, res);
    assert.equal(res.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.LCD_WEB_EVENTS_SECRET;
    else process.env.LCD_WEB_EVENTS_SECRET = previous;
  }
});

test('processa evento LCD WEB uma vez e emite atualização idempotente', async (context) => {
  const previous = process.env.LCD_WEB_EVENTS_SECRET;
  process.env.LCD_WEB_EVENTS_SECRET = 'event-secret';
  const original = {
    tenant: prisma.tenant.findFirst,
    syncFind: prisma.externalSyncRecord.findFirst,
    syncCreate: prisma.externalSyncRecord.create,
    syncUpsert: prisma.externalSyncRecord.upsert,
    syncUpdate: prisma.externalSyncRecord.update,
  };
  context.after(() => {
    prisma.tenant.findFirst = original.tenant;
    prisma.externalSyncRecord.findFirst = original.syncFind;
    prisma.externalSyncRecord.create = original.syncCreate;
    prisma.externalSyncRecord.upsert = original.syncUpsert;
    prisma.externalSyncRecord.update = original.syncUpdate;
    if (previous === undefined) delete process.env.LCD_WEB_EVENTS_SECRET;
    else process.env.LCD_WEB_EVENTS_SECRET = previous;
  });

  let claimed = false;
  let emitted = null;
  prisma.tenant.findFirst = async () => ({ id: 'tenant-1', slug: 'lcddigital', active: true });
  prisma.externalSyncRecord.findFirst = async ({ where }) => (
    where.entity === 'events' && claimed
      ? { id: 'event-row', payload: { status: 'success' } }
      : null
  );
  prisma.externalSyncRecord.create = async ({ data }) => {
    claimed = true;
    return { id: 'event-row', payload: data.payload };
  };
  prisma.externalSyncRecord.upsert = async () => ({});
  prisma.externalSyncRecord.update = async () => ({});
  controller.setIo({ to() { return { emit(_name, payload) { emitted = payload; } }; } });

  const body = {
    eventId: 'evt-1',
    eventType: 'receivable.updated',
    entity: 'receivables',
    entityId: 'receivable-1',
    customerExternalId: 'customer-1',
    data: { externalId: 'receivable-1', status: 'PENDENTE' },
  };
  const firstResponse = makeResponse();
  await controller.handleLcdWebEvent(makeRequest(body, 'event-secret'), firstResponse);
  assert.equal(firstResponse.statusCode, 202);
  assert.equal(firstResponse.body.ok, true);
  assert.equal(emitted.eventType, 'receivable.updated');

  const duplicateResponse = makeResponse();
  await controller.handleLcdWebEvent(makeRequest(body, 'event-secret'), duplicateResponse);
  assert.equal(duplicateResponse.statusCode, 200);
  assert.equal(duplicateResponse.body.duplicate, true);
});
