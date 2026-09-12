const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) result += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return result;
}

function base32Decode(value) {
  let bits = '';
  for (const char of String(value).replace(/=|\s/g, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Segredo TOTP invalido');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function encryptionKey() {
  return crypto.createHash('sha256').update(process.env.TOTP_ENCRYPTION_KEY || process.env.JWT_SECRET || '').digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptSecret(value) {
  const [version, iv, tag, payload] = String(value).split('.');
  if (version !== 'v1') throw new Error('Segredo TOTP invalido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8');
}

function generateSecret() { return base32Encode(crypto.randomBytes(20)); }

function codeAt(secret, time = Date.now()) {
  const counter = Math.floor(time / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

function verifyCode(secret, code, time = Date.now()) {
  const supplied = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(supplied)) return false;
  return [-1, 0, 1].some((window) => crypto.timingSafeEqual(Buffer.from(codeAt(secret, time + window * 30000)), Buffer.from(supplied)));
}

function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'));
}

async function hashRecoveryCodes(codes) { return Promise.all(codes.map((code) => bcrypt.hash(code.replace(/-/g, ''), 10))); }

module.exports = { generateSecret, encryptSecret, decryptSecret, codeAt, verifyCode, generateRecoveryCodes, hashRecoveryCodes };
