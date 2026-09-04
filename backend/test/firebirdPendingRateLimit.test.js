const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFirebirdPendingRateLimit,
  requestIdentity,
  fingerprint,
} = require('../src/middlewares/firebirdPendingRateLimit');

function request(headers = {}, query = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    query,
    ip: '203.0.113.10',
    socket: { remoteAddress: '203.0.113.10' },
    get(name) { return normalized[String(name).toLowerCase()]; },
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('identidade usa hash do token e metadados do agente sem expor credencial', () => {
  const req = request({
    'x-firebird-token': 'token-secreto',
    'x-ilux-agent-id': 'install-123',
    'x-ilux-agent-version': '1.1.3',
  }, { tenantSlug: 'empresa-teste' });
  const identity = requestIdentity(req);

  assert.equal(identity.tokenFingerprint, fingerprint('token-secreto'));
  assert.equal(identity.tenantSlug, 'empresa-teste');
  assert.equal(identity.agentId, 'install-123');
  assert.equal(identity.agentVersion, '1.1.3');
  assert.equal(identity.tokenFingerprint.includes('token-secreto'), false);
});

test('rate limit responde 429 depois do limite e informa Retry-After', () => {
  const limiter = createFirebirdPendingRateLimit({ windowMs: 60_000, maxRequests: 2 });
  const req = request({ 'x-firebird-token': 'token-invalido' });
  let nextCalls = 0;

  for (let i = 0; i < 2; i += 1) {
    const res = responseRecorder();
    limiter(req, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 200);
  }

  const limited = responseRecorder();
  limiter(req, limited, () => { nextCalls += 1; });

  assert.equal(nextCalls, 2);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '60');
  assert.equal(limited.body.retryAfter, 60);
});

test('tokens diferentes possuem limites independentes', () => {
  const limiter = createFirebirdPendingRateLimit({ windowMs: 60_000, maxRequests: 1 });
  let nextCalls = 0;
  for (const token of ['token-a', 'token-b']) {
    const res = responseRecorder();
    limiter(request({ 'x-firebird-token': token }), res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 200);
  }
  assert.equal(nextCalls, 2);
});
