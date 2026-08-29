const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

test('PrintGuard secrets use authenticated AES-GCM and are not plaintext', () => {
  const previous = process.env.PRINTGUARD_ENCRYPTION_KEY;
  process.env.PRINTGUARD_ENCRYPTION_KEY = '00'.repeat(32);
  const { encryptSecret, decryptSecret } = require('../src/services/printGuardCrypto');
  try {
    const ciphertext = encryptSecret('access-token-value');
    assert.notEqual(ciphertext, 'access-token-value');
    assert.equal(decryptSecret(ciphertext), 'access-token-value');
  } finally {
    if (previous === undefined) delete process.env.PRINTGUARD_ENCRYPTION_KEY;
    else process.env.PRINTGUARD_ENCRYPTION_KEY = previous;
  }
});

test('PrintGuard webhook HMAC signs exact raw bytes and rejects stale timestamps', () => {
  const previous = process.env.PRINTGUARD_ENCRYPTION_KEY;
  process.env.PRINTGUARD_ENCRYPTION_KEY = '11'.repeat(32);
  const { encryptSecret } = require('../src/services/printGuardCrypto');
  const printGuard = require('../src/services/printGuardService');
  try {
    const secret = 'webhook-secret';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const raw = Buffer.from('{"eventId":"evt-1","message":"á"}', 'utf8');
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw.toString('utf8')}`, 'utf8').digest('hex');
    const connection = { webhookSecretCipher: encryptSecret(secret) };
    assert.equal(printGuard.verifySignature({ connection, timestamp, signature, rawBody: raw }).ok, true);
    assert.equal(printGuard.verifySignature({ connection, timestamp: String(Number(timestamp) - 601), signature, rawBody: raw }).ok, false);
    assert.equal(printGuard.verifySignature({ connection, timestamp, signature, rawBody: Buffer.from('{"eventId":"evt-1"}') }).ok, false);
  } finally {
    if (previous === undefined) delete process.env.PRINTGUARD_ENCRYPTION_KEY;
    else process.env.PRINTGUARD_ENCRYPTION_KEY = previous;
  }
});

test('connection serialization never exposes encrypted credentials', () => {
  const printGuard = require('../src/services/printGuardService');
  const serialized = printGuard.secureConnection({
    id: 'c1', tenantId: 't1', name: 'PrintGuard', baseUrl: 'https://example.test',
    accessTokenCipher: 'v1.secret', webhookSecretCipher: 'v1.secret', status: 'CONNECTED',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(serialized, 'accessToken'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(serialized, 'webhookSecret'), false);
  assert.equal(JSON.stringify(serialized).includes('v1.secret'), false);
});
