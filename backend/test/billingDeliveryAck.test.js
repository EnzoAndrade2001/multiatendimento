const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { handleWebhook, __testing } = require('../src/controllers/webhookController');

const { mapWhatsappAck } = __testing;

test('mapWhatsappAck: numeros e enums do WhatsApp', () => {
  assert.equal(mapWhatsappAck(3), 'delivered');
  assert.equal(mapWhatsappAck('DELIVERY_ACK'), 'delivered');
  assert.equal(mapWhatsappAck(4), 'read');
  assert.equal(mapWhatsappAck('READ'), 'read');
  assert.equal(mapWhatsappAck('PLAYED'), 'read');
  assert.equal(mapWhatsappAck(0), 'failed');
  assert.equal(mapWhatsappAck(2), null); // server ack, nao interessa
  assert.equal(mapWhatsappAck(1), null); // pending
  assert.equal(mapWhatsappAck(null), null);
});

function fakeRes() { return { sendStatus() {} }; }

test('messages.update com ACK de entrega atualiza o BillingLog e NAO marca deletado', async (context) => {
  const og = {
    updateMany: prisma.billingLog.updateMany,
    findFirst: prisma.billingLog.findFirst,
    msgFindFirst: prisma.message.findFirst,
    msgUpdate: prisma.message.update,
  };
  context.after(() => {
    prisma.billingLog.updateMany = og.updateMany;
    prisma.billingLog.findFirst = og.findFirst;
    prisma.message.findFirst = og.msgFindFirst;
    prisma.message.update = og.msgUpdate;
  });

  let updateArgs = null;
  prisma.billingLog.updateMany = async (args) => { updateArgs = args; return { count: 1 }; };
  prisma.billingLog.findFirst = async () => ({ id: 'log-1', tenantId: 't-1' });
  let markedDeleted = false;
  prisma.message.findFirst = async () => { markedDeleted = true; return null; };
  prisma.message.update = async () => { markedDeleted = true; return {}; };

  await handleWebhook({ body: {
    event: 'messages.update',
    instance: 'inst',
    data: [{ key: { id: 'WA-MSG-1', remoteJid: '5551@s.whatsapp.net' }, update: { status: 4 } }],
  } }, fakeRes());
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(updateArgs, 'chamou billingLog.updateMany');
  assert.equal(updateArgs.where.messageId, 'WA-MSG-1');
  assert.equal(updateArgs.data.deliveryStatus, 'read');
  assert.ok(updateArgs.data.deliveryUpdatedAt instanceof Date);
  assert.equal(markedDeleted, false, 'um ACK nunca pode marcar a mensagem como deletada');
});

test('messages.update sem status (exclusao real) continua marcando deletado', async (context) => {
  const og = { msgFindFirst: prisma.message.findFirst, msgUpdate: prisma.message.update, updateMany: prisma.billingLog.updateMany };
  context.after(() => {
    prisma.message.findFirst = og.msgFindFirst;
    prisma.message.update = og.msgUpdate;
    prisma.billingLog.updateMany = og.updateMany;
  });
  let deleted = false;
  let billingTouched = false;
  prisma.billingLog.updateMany = async () => { billingTouched = true; return { count: 0 }; };
  prisma.message.findFirst = async () => ({ id: 'm1', ticket: { tenantId: 't-1' } });
  prisma.message.update = async (args) => { deleted = args.data.isDeleted === true; return { id: 'm1' }; };

  await handleWebhook({ body: {
    event: 'messages.update',
    instance: 'inst',
    data: { key: { id: 'WA-DEL-1' }, update: { message: null } },
  } }, fakeRes());
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(billingTouched, false, 'sem ACK, nao mexe em BillingLog');
  assert.equal(deleted, true, 'exclusao real ainda marca isDeleted');
});
