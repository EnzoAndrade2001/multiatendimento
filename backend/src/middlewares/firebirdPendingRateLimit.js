const crypto = require('crypto');

// A valid agent normally keeps this endpoint in a 25 second long-poll, so a
// few dozen requests per minute is already more than enough. The limiter is
// intentionally local and dependency-free: it is a last line of defence for
// an old/misconfigured agent that retries an authentication error in a tight
// loop. Authentication still happens in the controller; this middleware only
// prevents that loop from reaching Prisma thousands of times per minute.
const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_REQUESTS = 60;

function fingerprint(value) {
  const text = String(value || '').trim();
  return text
    ? crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)
    : 'none';
}

function tokenFromRequest(req) {
  const header = typeof req?.get === 'function'
    ? (req.get('x-firebird-token') || req.get('authorization'))
    : '';
  return String(header || '').replace(/^Bearer\s+/i, '').trim();
}

function requestIdentity(req) {
  const token = tokenFromRequest(req);
  const ip = String(req?.ip || req?.socket?.remoteAddress || 'unknown').trim() || 'unknown';
  return {
    key: token ? `token:${fingerprint(token)}` : `ip:${ip}`,
    tokenFingerprint: fingerprint(token),
    ip,
    tenantSlug: String(req?.query?.tenantSlug || req?.body?.tenantSlug || '').trim() || 'none',
    agentId: String(
      (typeof req?.get === 'function' && req.get('x-ilux-agent-id')) || '',
    ).trim() || 'unknown',
    agentVersion: String(
      (typeof req?.get === 'function' && req.get('x-ilux-agent-version')) || '',
    ).trim() || 'unknown',
  };
}

function createFirebirdPendingRateLimit(options = {}) {
  const windowMs = Number.isFinite(options.windowMs) ? Math.max(1000, options.windowMs) : DEFAULT_WINDOW_MS;
  const maxRequests = Number.isFinite(options.maxRequests) ? Math.max(1, options.maxRequests) : DEFAULT_MAX_REQUESTS;
  const buckets = new Map();

  function cleanup(now) {
    if (buckets.size < 1000) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.startedAt >= windowMs) buckets.delete(key);
    }
  }

  const middleware = (req, res, next) => {
    const now = Date.now();
    cleanup(now);
    const identity = requestIdentity(req);
    let bucket = buckets.get(identity.key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      buckets.set(identity.key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000));
      res.set('Retry-After', String(retryAfter));
      // This is deliberately one line per key/window, rather than one line
      // per request, so the protection itself cannot flood the log.
      if (bucket.count === maxRequests + 1) {
        console.warn('[pending-commands] rate limit aplicado', {
          tokenFingerprint: identity.tokenFingerprint,
          tenantSlug: identity.tenantSlug,
          ip: identity.ip,
          agentId: identity.agentId,
          agentVersion: identity.agentVersion,
          retryAfter,
        });
      }
      return res.status(429).json({
        error: 'Muitas tentativas para consultar comandos pendentes. Aguarde e tente novamente.',
        retryAfter,
      });
    }

    return next();
  };

  middleware.reset = () => buckets.clear();
  middleware.identity = requestIdentity;
  return middleware;
}

const firebirdPendingRateLimit = createFirebirdPendingRateLimit();

module.exports = {
  createFirebirdPendingRateLimit,
  firebirdPendingRateLimit,
  requestIdentity,
  tokenFromRequest,
  fingerprint,
};
