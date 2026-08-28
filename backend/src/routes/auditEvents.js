const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { listAuditEvents } = require('../controllers/auditEventController');

router.get('/events', authenticate, requirePermission('audit.view'), listAuditEvents);

module.exports = router;
