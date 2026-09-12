const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireSupportAccess = require('../middlewares/requireSupportAccess');
const controller = require('../controllers/printGuardController');
const auditEvent = require('../middlewares/auditEvent');

// Webhook é autenticado por assinatura HMAC, não por JWT do usuário.
router.post('/webhook', controller.webhook);

router.use(authenticate);
router.get('/', requirePermission('connections.manage', 'settings.agent.manage'), requireSupportAccess, controller.status);
router.post('/pairing', requirePermission('connections.manage', 'settings.agent.manage'), requireSupportAccess, auditEvent('PRINTGUARD_PAIRING', 'printguard_connection'), controller.pair);
router.post('/test', requirePermission('connections.manage', 'settings.agent.manage'), requireSupportAccess, auditEvent('PRINTGUARD_CONNECTION_TEST', 'printguard_connection'), controller.test);
router.post('/disconnect', requirePermission('connections.manage', 'settings.agent.manage'), requireSupportAccess, auditEvent('PRINTGUARD_DISCONNECT', 'printguard_connection'), controller.disconnect);
router.get('/metrics', requirePermission('telemetry.view'), controller.getMetrics);
router.post('/sync', requirePermission('telemetry.view'), requireSupportAccess, auditEvent('PRINTGUARD_SYNC', 'printguard_connection'), controller.sync);
router.get('/:resource', requirePermission('telemetry.view'), controller.remotePage);

module.exports = router;
