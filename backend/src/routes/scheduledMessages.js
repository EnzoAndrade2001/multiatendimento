const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { schedule, list, remove } = require('../controllers/scheduledMessageController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('inbox.view'));
router.get('/', list);
router.post('/', auditEvent('SCHEDULED_MESSAGE_CREATE', 'scheduled_message'), schedule);
router.delete('/:id', auditEvent('SCHEDULED_MESSAGE_DELETE', 'scheduled_message'), remove);

module.exports = router;
