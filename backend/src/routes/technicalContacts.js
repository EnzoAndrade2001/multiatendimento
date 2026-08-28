const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const auditSensitiveAction = require('../middlewares/auditSensitiveAction');
const controller = require('../controllers/technicalContactController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('settings.bot.manage'));
router.get('/', controller.list);
router.post('/', auditSensitiveAction('TECHNICAL_CONTACT_CREATE', 'technical_contact'), auditEvent('TECHNICAL_CONTACT_CREATE', 'technical_contact'), controller.create);
router.patch('/:id', auditSensitiveAction('TECHNICAL_CONTACT_UPDATE', 'technical_contact'), auditEvent('TECHNICAL_CONTACT_UPDATE', 'technical_contact'), controller.update);
router.delete('/:id', auditSensitiveAction('TECHNICAL_CONTACT_DELETE', 'technical_contact'), auditEvent('TECHNICAL_CONTACT_DELETE', 'technical_contact'), controller.remove);

module.exports = router;
