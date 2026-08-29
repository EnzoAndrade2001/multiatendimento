const crypto = require('crypto');

// PRINTGUARD_ENCRYPTION_KEY must be a random 32-byte hex/base64 value. Keep
// this secret in the container secret store; we intentionally do not derive a
// key from a short passphrase because that would weaken at-rest protection.
function encryptionKey() {
  const configured = String(process.env.PRINTGUARD_ENCRYPTION_KEY || '').trim();
  if (!configured) throw new Error('PRINTGUARD_ENCRYPTION_KEY nao configurada (exija 32 bytes em hex ou base64).');

  if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, 'hex');
  try {
    const decoded = Buffer.from(configured, 'base64');
    if (decoded.length === 32) return decoded;
  } catch { /* handled by explicit validation below */ }
  throw new Error('PRINTGUARD_ENCRYPTION_KEY invalida; informe exatamente 32 bytes em hex ou base64.');
}

function encryptSecret(value) {
  if (value === undefined || value === null || String(value) === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // version.iv.tag.ciphertext; all components are base64url to avoid quoting.
  return ['v1', iv, tag, ciphertext]
    .map((part) => Buffer.isBuffer(part) ? part.toString('base64url') : part)
    .join('.');
}

function decryptSecret(serialized) {
  if (!serialized) return null;
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = String(serialized).split('.');
  if (version !== 'v1' || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('Ciphertext PrintGuard invalido.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivEncoded, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
