const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const controller = require('../controllers/privacyController');

router.get('/policy', authenticate, controller.getPolicy);
router.post('/acceptance', authenticate, controller.acceptPolicy);
router.use('/admin', authenticate, requirePermission('privacy.manage'));
router.get('/admin/subjects', controller.searchSubjects);
router.get('/admin/subjects/:source/:id/export', controller.exportSubject);
router.post('/admin/subjects/:source/:id/anonymize', controller.anonymizeSubject);
router.get('/admin/retention', controller.getRetention);
router.put('/admin/retention', controller.updateRetention);
router.post('/admin/retention/preview', controller.retentionPreview);
router.get('/admin/audit', controller.listAudit);

module.exports = router;
