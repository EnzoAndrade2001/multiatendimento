const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { list, create, update, remove } = require('../controllers/userController');
const auditSensitiveAction = require('../middlewares/auditSensitiveAction');

router.use(authenticate);
router.get('/', list);
router.use(requirePermission('users.manage'));
router.post('/', auditSensitiveAction('USER_CREATE', 'user'), create);
router.patch('/:id', auditSensitiveAction('USER_UPDATE', 'user'), update);
router.delete('/:id', auditSensitiveAction('USER_DELETE', 'user'), remove);

module.exports = router;
