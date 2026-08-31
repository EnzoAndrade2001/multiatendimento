const { queueAuditEvent } = require('../services/auditEventService');

function resolveValue(value, req, res) {
  if (typeof value === 'function') return value(req, res);
  return value;
}

/**
 * Records an API action after the response has completed, without adding
 * latency to the request. Use after authenticate (and, when appropriate,
 * after requirePermission) on mutating routes.
 *
 *   router.patch('/:id', auditEvent('CONTACT_UPDATE', 'contact'), update)
 *
 * Options may provide resourceId, status and metadata as values or functions
 * of (req, res). Metadata is sanitized and bounded by auditEventService.
 */
module.exports = function auditEvent(action, resourceType, options = {}) {
  return (req, res, next) => {
    let recorded = false;
    let responseSummary = null;
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === 'object') {
        responseSummary = {
          result: res.statusCode < 400 ? (body.reused ? 'REUSED' : 'SUCCESS') : 'FAILED',
          reason: res.statusCode >= 400 ? (body.error || body.message || null) : null,
          eventId: body.event?.id || req.params?.eventId || null,
          serviceOrderId: body.serviceOrder?.id || body.event?.serviceOrderId || null,
          serviceOrderNumber: body.serviceOrder?.externalId || body.serviceOrder?.number || null,
          reused: Boolean(body.reused),
        };
      }
      return originalJson(body);
    };
    const record = () => {
      if (recorded || !req.user) return;
      recorded = true;

      let metadata = resolveValue(options.metadata, req, res);
      if (metadata === undefined) {
        metadata = {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          ...responseSummary,
        };
      }

      const status = resolveValue(options.status, req, res)
        || (res.statusCode < 400 ? 'SUCCESS' : 'DENIED_OR_FAILED');
      const resourceId = resolveValue(options.resourceId, req, res)
        ?? req.params?.id
        ?? null;

      queueAuditEvent(req, {
        action: resolveValue(action, req, res),
        resourceType: resolveValue(resourceType, req, res),
        resourceId,
        status,
        metadata,
      });
    };

    // `close` can happen without `finish` if the client disconnects. Record
    // whichever terminal event happens first, but never duplicate it.
    res.once('finish', record);
    res.once('close', record);
    next();
  };
};
