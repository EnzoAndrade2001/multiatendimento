const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { list, create, getQrCode, repair, recoverMessages, remove } = require('../controllers/instanceController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('connections.manage'));
router.get('/list', list);
router.post('/create', auditEvent('INSTANCE_CREATE', 'instance'), create);
router.post('/:id/repair', auditEvent('INSTANCE_REPAIR', 'instance'), repair);
router.post('/:id/recover', auditEvent('INSTANCE_RECOVER_MESSAGES', 'instance'), recoverMessages);
router.get('/qrcode/:id', getQrCode);
router.delete('/:id', auditEvent('INSTANCE_DELETE', 'instance'), remove);

module.exports = router;
