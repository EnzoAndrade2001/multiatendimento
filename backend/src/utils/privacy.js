const crypto = require('crypto');

const SENSITIVE_KEYS = /password|secret|token|authorization|api[-_]?key|cookie/i;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function maskIdentifier(value) {
  const clean = digits(value);
  if (!clean) return null;
  return `${'*'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 500) : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEYS.test(key) ? '[redacted]' : sanitizeMetadata(item, depth + 1),
  ]));
}

function maskPhone(value) {
  const clean = digits(value);
  return clean ? `***${clean.slice(-4)}` : 'sem-numero';
}

module.exports = { digits, maskIdentifier, fingerprint, sanitizeMetadata, maskPhone };
