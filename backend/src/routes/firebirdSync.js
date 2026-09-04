const router = require('express').Router();
const { pushBatch, getPendingCommands, commandCallback } = require('../controllers/firebirdSyncController');
const { sendBilling, autoSendBilling, logTestBilling, triggerBillingProcess, getBillingLogs, saveBillingSettings, getBillingDashboardStats } = require('../controllers/billingController');
const upload = require('../middlewares/upload');
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const auditEvent = require('../middlewares/auditEvent');
const { firebirdPendingRateLimit } = require('../middlewares/firebirdPendingRateLimit');

router.post('/push', pushBatch);
router.get('/pending-commands', firebirdPendingRateLimit, getPendingCommands);
router.post('/pending-commands/:id/callback', commandCallback);
router.post('/ping', require('../controllers/firebirdSyncController').agentPing);

// Rotas de Faturamento/Cobrança
router.post('/send-billing', upload.array('media'), sendBilling);
router.post('/auto-send-billing', autoSendBilling);
router.post('/log-test-billing', logTestBilling);
router.post('/trigger-billing-process', authenticate, requirePermission('billing.reprocess'), auditEvent('BILLING_PROCESS_TRIGGER', 'billing'), triggerBillingProcess);
router.get('/billing-logs', authenticate, requirePermission('billing.view'), getBillingLogs);
router.post('/billing-settings', authenticate, requirePermission('billing.reprocess'), auditEvent('BILLING_SETTINGS_UPDATE', 'billing'), saveBillingSettings);
router.get('/billing-reports', authenticate, requirePermission('billing.view'), getBillingDashboardStats);

module.exports = router;
