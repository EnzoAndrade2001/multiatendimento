const { recordPrivacyAudit } = require('../services/privacyAuditService');

module.exports = function auditSensitiveAction(action, resourceType) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (!req.user) return;
      recordPrivacyAudit(req, {
        action,
        resourceType,
        resourceId: req.params?.id || null,
        status: res.statusCode < 400 ? 'SUCCESS' : 'DENIED_OR_FAILED',
        metadata: {
          method: req.method,
          changedFields: req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 100) : [],
          statusCode: res.statusCode,
        },
      });
    });
    next();
  };
};
