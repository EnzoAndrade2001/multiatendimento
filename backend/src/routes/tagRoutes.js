const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { list, usage, create, update, remove, archive, restore } = require('../controllers/tagController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('tags.manage'));
router.get('/', list);
router.get('/usage', usage);
router.post('/', auditEvent('TAG_CREATE', 'tag'), create);
router.patch('/:id/archive', auditEvent('TAG_ARCHIVE', 'tag'), archive);
router.patch('/:id/restore', auditEvent('TAG_RESTORE', 'tag'), restore);
router.patch('/:id', auditEvent('TAG_UPDATE', 'tag'), update);
router.delete('/:id', auditEvent('TAG_DELETE', 'tag'), remove);

module.exports = router;
