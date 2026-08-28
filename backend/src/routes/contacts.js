const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const upload = require('../middlewares/upload');
const { list, getHistory, updateContact, linkCrm, getMedia, create, getTags, importExcel, deleteContact } = require('../controllers/contactController');
const auditSensitiveAction = require('../middlewares/auditSensitiveAction');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('inbox.view', 'crm.view'));
router.get('/', list);
router.post('/', auditEvent('CONTACT_CREATE', 'contact'), create);
router.post('/import', upload.single('file'), auditEvent('CONTACT_IMPORT', 'contact'), importExcel);
router.get('/tags', getTags);
router.get('/:id/history', getHistory);
router.patch('/:id', auditEvent('CONTACT_UPDATE', 'contact'), updateContact);
router.patch('/:id/link-crm', auditEvent('CONTACT_LINK_CRM', 'contact'), linkCrm);
router.get('/:id/media', getMedia);
router.delete('/:id', auditSensitiveAction('CONTACT_DELETE', 'contact'), auditEvent('CONTACT_DELETE', 'contact'), deleteContact);

module.exports = router;
