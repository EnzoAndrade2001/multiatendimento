const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const {
  queue, action, parkQueue, parkCoverage, parkRanking, parkTimeline, parkConsolidate,
  parkBindingCandidates, parkResolveBinding, parkAssign, parkNotify, parkManagementMetrics, parkBulk, parkDecisionHistory,
} = require('../controllers/printGuardController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate);
router.get('/queue', requirePermission('telemetry.view'), requireEntitlement('telemetry'), queue);
router.post('/events/:eventId/:action', auditEvent((req) => `PRINTGUARD_EVENT_${String(req.params.action || '').toUpperCase()}`, 'printguard_event'), requirePermission('telemetry.manage'), requireEntitlement('telemetry'), action);

// Cockpit "Saude do Parque"
router.use('/park', requireEntitlement('park_health'));
router.get('/park/queue', requirePermission('telemetry.view'), parkQueue);
router.get('/park/coverage', requirePermission('telemetry.view'), parkCoverage);
router.get('/park/ranking', requirePermission('telemetry.view'), parkRanking);
router.get('/park/management-metrics', requirePermission('telemetry.view'), parkManagementMetrics);
router.post('/park/bulk', auditEvent('PRINTGUARD_BULK_ACTION', 'printguard_event'), requirePermission('telemetry.manage'), parkBulk);
router.get('/park/equipment/:equipmentId/timeline', requirePermission('telemetry.view'), parkTimeline);
router.post('/park/consolidate', auditEvent('PRINTGUARD_CONSOLIDATE', 'printguard_event'), requirePermission('telemetry.manage'), parkConsolidate);
router.get('/park/events/:eventId/binding-candidates', requirePermission('telemetry.view'), parkBindingCandidates);
router.post('/park/events/:eventId/binding', auditEvent('PRINTGUARD_BINDING_FIX', 'printguard_event'), requirePermission('telemetry.manage'), parkResolveBinding);
router.post('/park/events/:eventId/assign', auditEvent('PRINTGUARD_ASSIGN', 'printguard_event'), requirePermission('telemetry.manage'), parkAssign);
router.post('/park/events/:eventId/notify', auditEvent('PRINTGUARD_NOTIFY', 'printguard_event'), requirePermission('telemetry.manage'), parkNotify);
router.get('/park/events/:eventId/history', requirePermission('telemetry.view'), parkDecisionHistory);

module.exports = router;
