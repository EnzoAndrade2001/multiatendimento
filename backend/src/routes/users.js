const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { list, create, update, remove } = require('../controllers/userController');
const auditSensitiveAction = require('../middlewares/auditSensitiveAction');
const { parseUserAvatarUpload } = require('../middlewares/userAvatarUpload');
const { uploadUserAvatar, removeUserAvatar } = require('../controllers/userAvatarController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate);
router.get('/', list);
router.use(requirePermission('users.manage'));
router.post('/', auditSensitiveAction('USER_CREATE', 'user'), auditEvent('USER_CREATE', 'user'), create);
router.patch('/:id', auditSensitiveAction('USER_UPDATE', 'user'), auditEvent('USER_UPDATE', 'user'), update);
router.post('/:id/avatar', auditSensitiveAction('USER_AVATAR_UPDATE', 'user'), parseUserAvatarUpload, auditEvent('USER_AVATAR_UPDATE', 'user'), uploadUserAvatar);
router.delete('/:id/avatar', auditSensitiveAction('USER_AVATAR_DELETE', 'user'), auditEvent('USER_AVATAR_DELETE', 'user'), removeUserAvatar);
router.delete('/:id', auditSensitiveAction('USER_DELETE', 'user'), auditEvent('USER_DELETE', 'user'), remove);

module.exports = router;
