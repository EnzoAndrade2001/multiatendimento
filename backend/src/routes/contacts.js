const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const upload = require('../middlewares/upload');
const { list, getHistory, updateContact, getMedia, create, getTags, importExcel, deleteContact } = require('../controllers/contactController');
const auditSensitiveAction = require('../middlewares/auditSensitiveAction');

router.use(authenticate, requirePermission('inbox.view', 'crm.view'));
router.get('/', list);
router.post('/', create);
router.post('/import', upload.single('file'), importExcel);
router.get('/tags', getTags);
router.get('/:id/history', getHistory);
router.patch('/:id', updateContact);
router.get('/:id/media', getMedia);
router.delete('/:id', auditSensitiveAction('CONTACT_DELETE', 'contact'), deleteContact);

module.exports = router;
