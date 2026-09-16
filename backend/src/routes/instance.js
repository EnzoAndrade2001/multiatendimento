const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const { list, create, getQrCode, repair, recoverMessages, importContacts, remove, healthEvents, updateServer } = require('../controllers/instanceController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('connections.manage'), requireEntitlement('connections'));
router.get('/list', list);
router.post('/create', auditEvent('INSTANCE_CREATE', 'instance'), create);
router.post('/:id/repair', auditEvent('INSTANCE_REPAIR', 'instance'), repair);
router.patch('/:id/server', auditEvent('INSTANCE_UPDATE_SERVER', 'instance'), updateServer);
router.post('/:id/recover', auditEvent('INSTANCE_RECOVER_MESSAGES', 'instance'), recoverMessages);
router.post('/:id/import-contacts', auditEvent('INSTANCE_IMPORT_CONTACTS', 'instance'), importContacts);
router.get('/qrcode/:id', getQrCode);
router.get('/:id/health-events', healthEvents);
router.delete('/:id', auditEvent('INSTANCE_DELETE', 'instance'), remove);

module.exports = router;
