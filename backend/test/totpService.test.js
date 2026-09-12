const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

test('TOTP gera e valida codigo com janela curta', () => {
  const previous = process.env.TOTP_ENCRYPTION_KEY;
  process.env.TOTP_ENCRYPTION_KEY = 'test-key';
  const service = require('../src/services/totpService');
  const secret = service.generateSecret();
  const now = 1789164000000;
  assert.equal(service.verifyCode(secret, service.codeAt(secret, now), now), true);
  assert.equal(service.verifyCode(secret, '000000', now), false);
  const cipher = service.encryptSecret(secret);
  assert.notEqual(cipher, secret);
  assert.equal(service.decryptSecret(cipher), secret);
  if (previous === undefined) delete process.env.TOTP_ENCRYPTION_KEY; else process.env.TOTP_ENCRYPTION_KEY = previous;
});

test('codigos de recuperacao sao unicos e armazenados somente como hash', async () => {
  const service = require('../src/services/totpService');
  const codes = service.generateRecoveryCodes();
  const hashes = await service.hashRecoveryCodes(codes);
  assert.equal(new Set(codes).size, 8);
  assert.equal(hashes.some((hash) => codes.includes(hash)), false);
  assert.equal(await bcrypt.compare(codes[0].replace(/-/g, ''), hashes[0]), true);
});
