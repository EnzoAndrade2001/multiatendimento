const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prisma = require('../src/lib/prisma');
const { listFirebirdAgents } = require('../src/controllers/superAdminController');

function withReleaseDir(context, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-fb-agents-'));
  const prev = process.env.FIREBIRD_AGENT_RELEASE_DIR;
  context.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.FIREBIRD_AGENT_RELEASE_DIR;
    else process.env.FIREBIRD_AGENT_RELEASE_DIR = prev;
  });
  process.env.FIREBIRD_AGENT_RELEASE_DIR = dir;
  if (version) {
    fs.writeFileSync(path.join(dir, 'FirebirdCRMClient.exe'), 'bin');
    fs.writeFileSync(
      path.join(dir, 'release.json'),
      JSON.stringify({ version, fileName: 'FirebirdCRMClient.exe', sha256: 'x', releasedAt: '2026-09-06T10:00:00-03:00' }),
    );
  }
}

function patchFindMany(context, impl) {
  const had = Object.prototype.hasOwnProperty.call(prisma, 'firebirdAgent');
  const originalObj = prisma.firebirdAgent;
  const originalFn = prisma.firebirdAgent?.findMany;
  context.after(() => {
    if (had) prisma.firebirdAgent = originalObj;
    else delete prisma.firebirdAgent;
    if (originalObj && originalFn) originalObj.findMany = originalFn;
  });
  prisma.firebirdAgent = { ...(originalObj || {}), findMany: impl };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

test('listFirebirdAgents nega quem nao e superadmin', async () => {
  const res = makeRes();
  await listFirebirdAgents({ user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 403);
});

test('listFirebirdAgents agrega instalacoes de todos os tenants', async (context) => {
  withReleaseDir(context, '1.2.0');
  const recent = new Date(Date.now() - 30 * 1000);
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  patchFindMany(context, async () => [
    { id: 'r1', installId: 'i1', hostname: 'SRV-A', version: '1.1.2', runtime: 'executable', firstSeenAt: stale, lastSeenAt: recent, lastPingIp: '10.0.0.1', tenant: { slug: 'empresa-a', name: 'Empresa A' } },
    { id: 'r2', installId: 'i2', hostname: 'SRV-B', version: '1.2.0', runtime: 'executable', firstSeenAt: stale, lastSeenAt: stale, lastPingIp: '10.0.0.2', tenant: { slug: 'empresa-b', name: 'Empresa B' } },
    { id: 'r3', installId: 'i3', hostname: 'SRV-A2', version: '1.1.0', runtime: 'python', firstSeenAt: stale, lastSeenAt: recent, lastPingIp: '10.0.0.3', tenant: { slug: 'empresa-a', name: 'Empresa A' } },
  ]);

  const res = makeRes();
  await listFirebirdAgents({ user: { role: 'superadmin' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.latestVersion, '1.2.0');
  assert.equal(res.body.agentCount, 3);
  assert.equal(res.body.tenantCount, 2); // empresa-a e empresa-b
  assert.equal(res.body.onlineCount, 2); // r1 e r3
  assert.equal(res.body.outdatedCount, 2); // r1 (1.1.2) e r3 (1.1.0)
  assert.equal(res.body.agents[0].tenantSlug, 'empresa-a');
  assert.equal(res.body.agents[1].updateAvailable, false); // r2 ja na 1.2.0
});

test('listFirebirdAgents e best-effort: erro de banco vira lista vazia com 200', async (context) => {
  withReleaseDir(context, '1.2.0');
  patchFindMany(context, async () => {
    throw new Error('relation "FirebirdAgent" does not exist');
  });

  const res = makeRes();
  await listFirebirdAgents({ user: { role: 'superadmin' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agentCount, 0);
  assert.equal(res.body.tenantCount, 0);
  assert.deepEqual(res.body.agents, []);
});
