const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getAgentInfo } = require('../src/controllers/agentController');

test('manifesto persistente prevalece sobre versao antiga do EasyPanel', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-release-'));
  const previousDir = process.env.FIREBIRD_AGENT_RELEASE_DIR;
  const previousVersion = process.env.FIREBIRD_AGENT_VERSION;
  const previousSha = process.env.FIREBIRD_AGENT_SHA256;
  context.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.FIREBIRD_AGENT_RELEASE_DIR;
    else process.env.FIREBIRD_AGENT_RELEASE_DIR = previousDir;
    if (previousVersion === undefined) delete process.env.FIREBIRD_AGENT_VERSION;
    else process.env.FIREBIRD_AGENT_VERSION = previousVersion;
    if (previousSha === undefined) delete process.env.FIREBIRD_AGENT_SHA256;
    else process.env.FIREBIRD_AGENT_SHA256 = previousSha;
  });

  process.env.FIREBIRD_AGENT_RELEASE_DIR = directory;
  process.env.FIREBIRD_AGENT_VERSION = '1.0.1';
  process.env.FIREBIRD_AGENT_SHA256 = 'sha-antigo';
  fs.writeFileSync(path.join(directory, 'FirebirdCRMClient.exe'), 'release');
  fs.writeFileSync(path.join(directory, 'release.json'), JSON.stringify({
    version: '1.0.3',
    fileName: 'FirebirdCRMClient.exe',
    sha256: 'sha-novo',
    releasedAt: '2026-08-27T14:05:00-03:00',
  }));

  const headers = {};
  const res = {
    setHeader: (name, value) => { headers[name] = value; },
    json: (body) => { res.body = body; },
  };
  getAgentInfo({}, res);

  assert.equal(res.body.version, '1.0.3');
  assert.equal(res.body.sha256, 'sha-novo');
  assert.equal(res.body.downloadAvailable, true);
  assert.match(headers['Cache-Control'], /no-store/);
});
