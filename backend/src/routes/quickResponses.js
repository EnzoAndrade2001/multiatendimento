const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const {
  listQuickResponses,
  createQuickResponse,
  updateQuickResponse,
  useQuickResponse,
  stats,
  deleteQuickResponse,
  archiveQuickResponse,
  restoreQuickResponse,
  listQuickResponseAudit,
} = require('../controllers/quickResponseController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('quick_responses.manage'));
router.get('/', listQuickResponses);
router.get('/stats', stats);
router.get('/audit', listQuickResponseAudit);
router.post('/', auditEvent('QUICK_RESPONSE_CREATE', 'quick_response'), createQuickResponse);
router.patch('/:id/archive', auditEvent('QUICK_RESPONSE_ARCHIVE', 'quick_response'), archiveQuickResponse);
router.patch('/:id/restore', auditEvent('QUICK_RESPONSE_RESTORE', 'quick_response'), restoreQuickResponse);
router.patch('/:id', auditEvent('QUICK_RESPONSE_UPDATE', 'quick_response'), updateQuickResponse);
router.post('/:id/use', auditEvent('QUICK_RESPONSE_USE', 'quick_response'), useQuickResponse);
router.delete('/:id', auditEvent('QUICK_RESPONSE_DELETE', 'quick_response'), deleteQuickResponse);

module.exports = router;
