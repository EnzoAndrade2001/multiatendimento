const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { sanitizeMetadata } = require('../utils/privacy');

const MAX_ACTION_LENGTH = 120;
const MAX_RESOURCE_TYPE_LENGTH = 80;
const MAX_RESOURCE_ID_LENGTH = 160;
const MAX_STATUS_LENGTH = 40;
const MAX_REQUEST_ID_LENGTH = 120;
const MAX_IP_LENGTH = 100;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_METADATA_BYTES = 32 * 1024;

function text(value, maxLength) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, maxLength) : null;
}

function requestHeader(req, name) {
  if (!req || typeof req.get !== 'function') return null;
  try {
    return req.get(name) || null;
  } catch {
    return null;
  }
}

function requestIdFor(req) {
  return text(
    req?.requestId
      || requestHeader(req, 'x-request-id')
      || requestHeader(req, 'x-correlation-id')
      || crypto.randomUUID(),
    MAX_REQUEST_ID_LENGTH,
  );
}

function sanitizeAuditMetadata(value) {
  if (value === undefined || value === null) return null;

  let sanitized;
  try {
    sanitized = sanitizeMetadata(value);
  } catch (error) {
    // Circular objects and unsupported values must never break the audited
    // request. Keep a small diagnostic that does not include the payload.
    sanitized = { truncated: true, reason: 'metadata_sanitization_failed' };
  }

  try {
    const encoded = JSON.stringify(sanitized);
    if (Buffer.byteLength(encoded, 'utf8') <= MAX_METADATA_BYTES) return sanitized;

    // Keep the record valid JSON and bounded even if a caller accidentally
    // passes a very large object (for example, an uploaded document body).
    let preview = encoded.slice(0, MAX_METADATA_BYTES - 256);
    let bounded = {
      truncated: true,
      reason: 'metadata_size_limit',
      preview,
    };

    // `slice` counts UTF-16 code units, not UTF-8 bytes. Trim in small
    // chunks until the serialized JSON is within the hard byte limit even
    // when metadata contains emoji or other multibyte characters.
    while (Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_METADATA_BYTES && preview.length > 0) {
      preview = preview.slice(0, Math.max(0, preview.length - 256));
      bounded = { truncated: true, reason: 'metadata_size_limit', preview };
    }
    return bounded;
  } catch {
    return { truncated: true, reason: 'metadata_serialization_failed' };
  }
}

function resolveTenantId(context) {
  return text(context?.tenantId || context?.user?.tenantId, 120);
}

function resolveActorId(context, details) {
  if (details && Object.prototype.hasOwnProperty.call(details, 'actorId')) {
    return text(details.actorId, 120);
  }
  return text(context?.user?.userId || context?.userId, 120);
}

function buildAuditData(context, details = {}) {
  const tenantId = resolveTenantId(context);
  const action = text(details.action, MAX_ACTION_LENGTH);
  const resourceType = text(details.resourceType, MAX_RESOURCE_TYPE_LENGTH);

  if (!tenantId || !action || !resourceType) return null;

  const req = context?.req || (context && context.user ? context : null);
  const ipAddress = text(
    details.ipAddress !== undefined
      ? details.ipAddress
      : req?.ip,
    MAX_IP_LENGTH,
  );
  const userAgent = text(
    details.userAgent !== undefined
      ? details.userAgent
      : requestHeader(req, 'user-agent'),
    MAX_USER_AGENT_LENGTH,
  );
  const requestId = text(
    details.requestId !== undefined ? details.requestId : requestIdFor(req),
    MAX_REQUEST_ID_LENGTH,
  );

  return {
    tenantId,
    actorId: resolveActorId(context, details),
    action,
    resourceType,
    resourceId: text(details.resourceId, MAX_RESOURCE_ID_LENGTH),
    status: text(details.status || 'SUCCESS', MAX_STATUS_LENGTH) || 'SUCCESS',
    metadata: sanitizeAuditMetadata(details.metadata),
    ipAddress,
    userAgent,
    requestId,
  };
}

/**
 * Persists a central audit event. This function is intentionally safe to
 * await in tests or in an administrative operation, but callers handling a
 * normal request should prefer queueAuditEvent so an audit outage never
 * delays or fails the user-facing operation.
 */
async function recordAuditEvent(context, details = {}) {
  const data = buildAuditData(context, details);
  if (!data) return null;

  try {
    return await prisma.auditEvent.create({ data });
  } catch (error) {
    // Audit must be best-effort. A migration outage, connection issue or
    // malformed legacy database must not turn a successful request into 500.
    console.error(`[audit-event] Falha ao registrar ${data.action}: ${error.message}`);
    return null;
  }
}

/**
 * Fire-and-forget variant for controllers, workers and socket handlers.
 * Returning no promise prevents accidental `await` in a latency-sensitive
 * path while the catch below avoids unhandledRejection noise.
 */
function queueAuditEvent(context, details = {}) {
  const schedule = typeof setImmediate === 'function' ? setImmediate : (callback) => setTimeout(callback, 0);
  schedule(() => {
    recordAuditEvent(context, details).catch((error) => {
      console.error(`[audit-event] Falha inesperada ao enfileirar auditoria: ${error.message}`);
    });
  });
}

module.exports = {
  MAX_METADATA_BYTES,
  buildAuditData,
  recordAuditEvent,
  queueAuditEvent,
  sanitizeAuditMetadata,
};
