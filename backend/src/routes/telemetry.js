const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { queue, action } = require('../controllers/printGuardController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('telemetry.view'));
router.get('/queue', queue);
router.post('/events/:eventId/:action', auditEvent((req) => `PRINTGUARD_EVENT_${String(req.params.action || '').toUpperCase()}`, 'printguard_event'), action);

module.exports = router;
