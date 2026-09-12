const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const controller = require('../controllers/campaignController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('campaigns.manage'), requireEntitlement('campaigns'));
router.get('/instances', controller.listInstances);
router.get('/templates', controller.templates);
router.post('/templates', auditEvent('CAMPAIGN_TEMPLATE_CREATE', 'campaign_template'), controller.createTemplate);
router.post('/preview', controller.preview);
router.post('/test', auditEvent('CAMPAIGN_TEST_SEND', 'campaign'), controller.testSend);
router.get('/', controller.list);
router.post('/', auditEvent('CAMPAIGN_CREATE', 'campaign'), controller.create);
router.get('/:id/export', auditEvent('CAMPAIGN_EXPORT', 'campaign'), controller.exportCampaign);
router.get('/:id', controller.getCampaign);
router.post('/:id/start', auditEvent('CAMPAIGN_START', 'campaign'), controller.start);
router.post('/:id/pause', auditEvent('CAMPAIGN_PAUSE', 'campaign'), controller.pause);
router.post('/:id/resume', auditEvent('CAMPAIGN_RESUME', 'campaign'), controller.resume);
router.post('/:id/cancel', auditEvent('CAMPAIGN_CANCEL', 'campaign'), controller.cancel);
router.post('/:id/retry', auditEvent('CAMPAIGN_RETRY', 'campaign'), controller.retry);
// Endpoint legado mantido para versões antigas do frontend.
router.post('/send', auditEvent('CAMPAIGN_SEND_BULK', 'campaign'), controller.sendBulk);

module.exports = router;
