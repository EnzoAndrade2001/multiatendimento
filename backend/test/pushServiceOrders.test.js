const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { pushBatch } = require('../src/controllers/firebirdSyncController');

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
  settings: { firebirdClientToken: TOKEN },
  instances: [{ id: 'instance-1', instanceName: 'atendimento', status: 'connected' }],
};

test('push de serviceOrders grava em ServiceOrder, nao so no log bruto (regressao: o.s. nao encontrada ao reimprimir)', async (context) => {
  const originals = {
    tenantFindUnique: prisma.tenant.findUnique,
    tenantSettingsUpdate: prisma.tenantSettings.update,
    externalSyncRecordUpsert: prisma.externalSyncRecord.upsert,
    contactFindFirst: prisma.contact.findFirst,
    contactCreate: prisma.contact.create,
    equipmentFindFirst: prisma.equipment.findFirst,
    equipmentCreate: prisma.equipment.create,
    serviceOrderFindFirst: prisma.serviceOrder.findFirst,
    serviceOrderCreate: prisma.serviceOrder.create,
  };
  context.after(() => {
    prisma.tenant.findUnique = originals.tenantFindUnique;
    prisma.tenantSettings.update = originals.tenantSettingsUpdate;
    prisma.externalSyncRecord.upsert = originals.externalSyncRecordUpsert;
    prisma.contact.findFirst = originals.contactFindFirst;
    prisma.contact.create = originals.contactCreate;
    prisma.equipment.findFirst = originals.equipmentFindFirst;
    prisma.equipment.create = originals.equipmentCreate;
    prisma.serviceOrder.findFirst = originals.serviceOrderFindFirst;
    prisma.serviceOrder.create = originals.serviceOrderCreate;
  });

  prisma.tenant.findUnique = async () => TENANT;
  prisma.tenantSettings.update = async () => ({});
  prisma.externalSyncRecord.upsert = async () => ({});
  prisma.contact.findFirst = async () => null;
  prisma.contact.create = async () => ({ id: 'contact-1' });
  prisma.equipment.findFirst = async () => null;
  prisma.equipment.create = async () => ({ id: 'equipment-1' });
  prisma.serviceOrder.findFirst = async () => null;
  let createdServiceOrder = null;
  prisma.serviceOrder.create = async ({ data }) => {
    createdServiceOrder = data;
    return { id: 'os-1', ...data };
  };

  const req = fakeReq({
    tenantSlug: 'lcd',
    entity: 'serviceOrders',
    records: [{
      externalId: '78844',
      seqOs: '78844',
      clientExternalId: '141',
      nmCliente: 'GRAFICA SANTOS',
      cdequipamento: '314',
      status: 'FINALIZADA',
      dtinclusao: '2026-08-24T00:00:00',
      dtatendimento: '2026-08-26T00:00:00',
      hratendimento: '09:45:06',
      dtfechamento: '2026-08-26T09:45:06',
    }],
  });
  const res = fakeRes();
  await pushBatch(req, res);

  assert.equal(res.body?.ok, true, JSON.stringify(res.body));
  assert.equal(res.body.stats.serviceOrders, 1, 'deveria ter processado 1 service order, nao pulado');
  assert.equal(res.body.stats.skipped, 0);
  assert.ok(createdServiceOrder, 'prisma.serviceOrder.create deveria ter sido chamado');
  assert.equal(createdServiceOrder.externalId, '78844');
  assert.equal(createdServiceOrder.externalSource, 'firebird');
  assert.equal(createdServiceOrder.createdAt.toISOString(), '2026-08-24T03:00:00.000Z');
  assert.equal(createdServiceOrder.closedAt.toISOString(), '2026-08-26T12:45:06.000Z');
});
