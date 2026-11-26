const test = require('node:test');
const assert = require('node:assert/strict');

const prisma = require('../src/lib/prisma');
const evolution = require('../src/services/evolutionService');
const { __testing } = require('../src/controllers/webhookController');

function patch(context, { direct = null, ownerJid = null, instances = [] } = {}) {
  const og = {
    findFirst: prisma.waInstance.findFirst,
    findMany: prisma.waInstance.findMany,
    findUnique: prisma.waInstance.findUnique,
    settings: prisma.tenantSettings.findMany,
    info: evolution.fetchInstanceInfo,
  };
  const infoCalls = [];
  prisma.waInstance.findFirst = async () => direct;
  prisma.waInstance.findMany = async () => instances;
  prisma.waInstance.findUnique = async ({ where }) => instances.find((i) => i.id === where.id) || null;
  prisma.tenantSettings.findMany = async () => [{ tenantId: 't-1', evolutionUrl: 'http://evo', evolutionKey: 'k' }];
  evolution.fetchInstanceInfo = async (url, key, name) => { infoCalls.push(name); return ownerJid ? { ownerJid } : null; };
  context.after(() => {
    prisma.waInstance.findFirst = og.findFirst;
    prisma.waInstance.findMany = og.findMany;
    prisma.waInstance.findUnique = og.findUnique;
    prisma.tenantSettings.findMany = og.settings;
    evolution.fetchInstanceInfo = og.info;
  });
  return infoCalls;
}

const FIN = { id: 'wa-fin', tenantId: 't-1', instanceName: 't-1_lcd-financeiro', phone: '555193896363' };
const ATD = { id: 'wa-atd', tenantId: 't-1', instanceName: 't-1_atendimento', phone: '555194412679' };

test('espelhamento externo: nome conhecido usa a própria conexão', async (context) => {
  const calls = patch(context, { direct: FIN });
  const got = await __testing.resolveExternalMessageInstance('t-1_lcd-financeiro');
  assert.equal(got.id, 'wa-fin');
  assert.equal(calls.length, 0);
});

test('espelhamento externo: sessão própria da LCDWEB no mesmo número cai na conexão do CRM', async (context) => {
  patch(context, { ownerJid: '555193896363@s.whatsapp.net', instances: [ATD, FIN] });
  const got = await __testing.resolveExternalMessageInstance('lcd-financeiro-lcd-teste1');
  assert.equal(got.id, 'wa-fin');
});

test('espelhamento externo: número sem conexão no CRM continua 404', async (context) => {
  patch(context, { ownerJid: '555199999999@s.whatsapp.net', instances: [ATD, FIN] });
  assert.equal(await __testing.resolveExternalMessageInstance('lcd-outro-teste2'), null);
});
