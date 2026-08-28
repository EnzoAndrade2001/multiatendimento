const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const controller = require('../controllers/privacyController');
const auditEvent = require('../middlewares/auditEvent');

router.get('/policy', authenticate, controller.getPolicy);
router.post('/acceptance', authenticate, auditEvent('PRIVACY_POLICY_ACCEPT', 'privacy_policy'), controller.acceptPolicy);
router.use('/admin', authenticate, requirePermission('privacy.manage'));
router.get('/admin/subjects', controller.searchSubjects);
router.get('/admin/subjects/:source/:id/export', auditEvent('SUBJECT_EXPORT', 'privacy_subject'), controller.exportSubject);
router.post('/admin/subjects/:source/:id/anonymize', auditEvent('SUBJECT_ANONYMIZE', 'privacy_subject'), controller.anonymizeSubject);
router.get('/admin/retention', controller.getRetention);
router.put('/admin/retention', auditEvent('RETENTION_POLICY_UPDATE', 'privacy_retention'), controller.updateRetention);
router.post('/admin/retention/preview', auditEvent('RETENTION_PREVIEW', 'privacy_retention'), controller.retentionPreview);
router.get('/admin/audit', controller.listAudit);

module.exports = router;
