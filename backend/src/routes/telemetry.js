const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const {
  queue, action, parkQueue, parkCoverage, parkRanking, parkTimeline, parkConsolidate,
} = require('../controllers/printGuardController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('telemetry.view'));
router.get('/queue', queue);
router.post('/events/:eventId/:action', auditEvent((req) => `PRINTGUARD_EVENT_${String(req.params.action || '').toUpperCase()}`, 'printguard_event'), action);

// Cockpit "Saude do Parque"
router.get('/park/queue', parkQueue);
router.get('/park/coverage', parkCoverage);
router.get('/park/ranking', parkRanking);
router.get('/park/equipment/:equipmentId/timeline', parkTimeline);
router.post('/park/consolidate', auditEvent('PRINTGUARD_CONSOLIDATE', 'printguard_event'), parkConsolidate);

module.exports = router;
