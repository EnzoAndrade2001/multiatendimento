const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prisma = require('../src/lib/prisma');
const { getAgentStatus } = require('../src/controllers/agentController');

function withReleaseDir(context, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-'));
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
  const original = prisma.firebirdAgent?.findMany;
  const had = Object.prototype.hasOwnProperty.call(prisma, 'firebirdAgent');
  const originalObj = prisma.firebirdAgent;
  context.after(() => {
    if (had) prisma.firebirdAgent = originalObj;
    else delete prisma.firebirdAgent;
    if (originalObj && original) originalObj.findMany = original;
  });
  prisma.firebirdAgent = { ...(originalObj || {}), findMany: impl };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { res.headers[name] = value; },
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; return res; },
  };
  return res;
}

const REQ = { user: { tenantId: 'tenant-1' } };

test('getAgentStatus cruza a versao de cada instalacao com o release publicado', async (context) => {
  withReleaseDir(context, '1.2.0');
  const recent = new Date(Date.now() - 60 * 1000);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  patchFindMany(context, async () => [
    { installId: 'a1', hostname: 'SRV-ILUX', version: '1.1.2', runtime: 'executable', capabilities: ['sync.contacts'], firstSeenAt: old, lastSeenAt: recent },
    { installId: 'legacy:200.0.0.1', hostname: null, version: '1.2.0', runtime: 'python', capabilities: null, firstSeenAt: old, lastSeenAt: old },
  ]);

  const res = makeRes();
  await getAgentStatus(REQ, res);

  assert.equal(res.body.latestVersion, '1.2.0');
  assert.equal(res.body.agentCount, 2);
  assert.equal(res.body.onlineCount, 1); // a2 esta stale
  assert.equal(res.body.outdatedCount, 1); // so a1

  const [a1, a2] = res.body.agents;
  assert.equal(a1.installId, 'a1');
  assert.equal(a1.identified, true);
  assert.equal(a1.online, true);
  assert.equal(a1.updateAvailable, true);
  assert.equal(a2.identified, false); // chave legacy:
  assert.equal(a2.online, false);
  assert.equal(a2.updateAvailable, false);
  assert.match(res.headers['Cache-Control'], /no-store/);
});

test('getAgentStatus sem manifesto nao afirma desatualizado', async (context) => {
  withReleaseDir(context, null);
  patchFindMany(context, async () => [
    { installId: 'a1', hostname: 'SRV', version: '1.1.2', runtime: 'executable', capabilities: null, firstSeenAt: new Date(), lastSeenAt: new Date() },
  ]);

  const res = makeRes();
  await getAgentStatus(REQ, res);

  assert.equal(res.body.latestVersion, null);
  assert.equal(res.body.outdatedCount, 0);
  assert.equal(res.body.agents[0].updateAvailable, false);
});

test('getAgentStatus e best-effort: falha no banco vira lista vazia com 200', async (context) => {
  withReleaseDir(context, '1.2.0');
  patchFindMany(context, async () => {
    throw new Error('relation "FirebirdAgent" does not exist');
  });

  const res = makeRes();
  await getAgentStatus(REQ, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.agentCount, 0);
  assert.deepEqual(res.body.agents, []);
  assert.equal(res.body.latestVersion, '1.2.0');
});
