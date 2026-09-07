const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const agentController = require('../src/controllers/agentController');
const {
  agentIdentityFromPing,
  agentPing,
} = require('../src/controllers/firebirdSyncController');

const TOKEN = 'inventory-token';
const TENANT = {
  id: 'tenant-inv-1',
  slug: 'empresa-inv',
  settings: { firebirdClientToken: TOKEN },
  instances: [{ id: 'instance-1', status: 'connected' }],
};

function makeReq({ body = {}, headers = {}, ip = '203.0.113.9' } = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    body,
    ip,
    header: (name) => lower[String(name).toLowerCase()],
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

test('agentIdentityFromPing prioriza o corpo, cai para o header e normaliza', () => {
  const identity = agentIdentityFromPing(
    makeReq({
      body: {
        version: '1.1.2',
        capabilities: ['sync.contacts', 'sync.contracts', '', ' commands.create-os '],
        health: {
          status: 'online',
          processId: '4321',
          runtime: 'executable',
          installId: 'abc123',
        },
      },
      headers: {
        'x-ilux-agent-version': '9.9.9',
        'x-ilux-agent-protocol': '1',
        'x-ilux-agent-id': 'header-id',
      },
    }),
  );

  assert.equal(identity.version, '1.1.2'); // corpo vence o header
  assert.equal(identity.protocolVersion, '1'); // sem no corpo -> header
  assert.equal(identity.installId, 'abc123'); // health.installId vence o header
  assert.equal(identity.runtime, 'executable');
  assert.equal(identity.processId, 4321);
  assert.equal(identity.healthStatus, 'online');
  assert.deepEqual(identity.capabilities, ['sync.contacts', 'sync.contracts', 'commands.create-os']);
  assert.equal(identity.ip, '203.0.113.9');
});

test('agentIdentityFromPing sem installId retorna null (nao da pra deduplicar)', () => {
  const identity = agentIdentityFromPing(makeReq({ body: { version: '1.0.0' } }));
  assert.equal(identity.installId, null);
  assert.equal(identity.capabilities, null);
  assert.equal(identity.processId, null);
});

// Substitui as dependencias que o agentPing toca (resolucao de tenant, escrita
// de status, upsert de inventario e leitura do manifesto) e restaura tudo no
// fim do teste. `firebirdAgent` e `readReleaseManifest` sao sobrescreviveis por
// teste.
function patchAgentPingDeps(context, { firebirdAgent, readReleaseManifest } = {}) {
  const original = {
    findUnique: prisma.tenant.findUnique,
    update: prisma.tenantSettings.update,
    hadFirebirdAgent: Object.prototype.hasOwnProperty.call(prisma, 'firebirdAgent'),
    firebirdAgent: prisma.firebirdAgent,
    readReleaseManifest: agentController.readReleaseManifest,
  };
  context.after(() => {
    prisma.tenant.findUnique = original.findUnique;
    prisma.tenantSettings.update = original.update;
    if (original.hadFirebirdAgent) prisma.firebirdAgent = original.firebirdAgent;
    else delete prisma.firebirdAgent;
    agentController.readReleaseManifest = original.readReleaseManifest;
  });

  const calls = { settingsUpdated: false, upsertArgs: null, upsertCalled: false };
  prisma.tenant.findUnique = async () => ({ ...TENANT });
  prisma.tenantSettings.update = async () => {
    calls.settingsUpdated = true;
    return {};
  };
  prisma.firebirdAgent = firebirdAgent || {
    upsert: async (args) => {
      calls.upsertCalled = true;
      calls.upsertArgs = args;
      return {};
    },
  };
  agentController.readReleaseManifest = readReleaseManifest || (() => null);
  return calls;
}

test('agentPing faz upsert do inventario alem de marcar o tenant online', async (context) => {
  const calls = patchAgentPingDeps(context);

  const res = makeRes();
  await agentPing(
    makeReq({
      body: {
        tenantSlug: TENANT.slug,
        version: '1.1.2',
        protocolVersion: '1',
        capabilities: ['sync.contacts'],
        health: { status: 'online', runtime: 'executable', processId: 10, installId: 'inst-42' },
      },
      headers: { 'x-firebird-token': TOKEN, 'x-ilux-agent-id': 'inst-42' },
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true }); // sem manifesto: so ok
  assert.equal(calls.settingsUpdated, true);
  assert.ok(calls.upsertArgs, 'firebirdAgent.upsert deve ser chamado');
  assert.deepEqual(calls.upsertArgs.where, {
    tenantId_installId: { tenantId: TENANT.id, installId: 'inst-42' },
  });
  assert.equal(calls.upsertArgs.create.tenantId, TENANT.id);
  assert.equal(calls.upsertArgs.create.version, '1.1.2');
  assert.equal(calls.upsertArgs.update.version, '1.1.2');
  assert.ok(calls.upsertArgs.update.lastSeenAt instanceof Date);
});

test('agentPing sinaliza updateAvailable quando o agente esta atras do release publicado', async (context) => {
  patchAgentPingDeps(context, { readReleaseManifest: () => ({ version: '1.2.0' }) });

  const res = makeRes();
  await agentPing(
    makeReq({
      body: { tenantSlug: TENANT.slug, version: '1.1.2', health: { installId: 'inst-42' } },
      headers: { 'x-firebird-token': TOKEN },
    }),
    res,
  );

  assert.deepEqual(res.body, { ok: true, latestVersion: '1.2.0', updateAvailable: true });
});

test('agentPing nao sinaliza update quando o agente ja esta na versao publicada', async (context) => {
  patchAgentPingDeps(context, { readReleaseManifest: () => ({ version: '1.2.0' }) });

  const res = makeRes();
  await agentPing(
    makeReq({
      body: { tenantSlug: TENANT.slug, version: '1.2.0', health: { installId: 'inst-42' } },
      headers: { 'x-firebird-token': TOKEN },
    }),
    res,
  );

  assert.deepEqual(res.body, { ok: true, latestVersion: '1.2.0', updateAvailable: false });
});

test('agentPing responde ok mesmo se o registro de inventario falhar', async (context) => {
  patchAgentPingDeps(context, {
    firebirdAgent: {
      upsert: async () => {
        throw new Error('coluna inexistente');
      },
    },
  });

  const res = makeRes();
  await agentPing(
    makeReq({
      body: { tenantSlug: TENANT.slug, health: { installId: 'inst-99' } },
      headers: { 'x-firebird-token': TOKEN },
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('agentPing sem installId nao chama firebirdAgent.upsert', async (context) => {
  const calls = patchAgentPingDeps(context);

  const res = makeRes();
  await agentPing(
    makeReq({
      body: { tenantSlug: TENANT.slug, version: '1.1.2' },
      headers: { 'x-firebird-token': TOKEN },
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(calls.upsertCalled, false);
});
