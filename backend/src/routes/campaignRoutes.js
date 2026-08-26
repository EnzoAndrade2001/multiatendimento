const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const controller = require('../controllers/campaignController');

router.use(authenticate, requirePermission('campaigns.manage'));
router.get('/instances', controller.listInstances);
router.get('/templates', controller.templates);
router.post('/templates', controller.createTemplate);
router.post('/preview', controller.preview);
router.post('/test', controller.testSend);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id/export', controller.exportCampaign);
router.get('/:id', controller.getCampaign);
router.post('/:id/start', controller.start);
router.post('/:id/pause', controller.pause);
router.post('/:id/resume', controller.resume);
router.post('/:id/cancel', controller.cancel);
router.post('/:id/retry', controller.retry);
// Endpoint legado mantido para versões antigas do frontend.
router.post('/send', controller.sendBulk);

module.exports = router;
