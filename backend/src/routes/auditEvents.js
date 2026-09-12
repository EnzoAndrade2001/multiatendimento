const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const { listAuditEvents } = require('../controllers/auditEventController');

router.get('/events', authenticate, requirePermission('audit.view'), requireEntitlement('audit'), listAuditEvents);

module.exports = router;
