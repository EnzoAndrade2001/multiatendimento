const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { getEquipments, addEquipment, updateEquipment, deleteEquipment, getOSList, getOpenOrdersForEquipment, createOS, getOSStatus, updateOS, generatePdf, draftOS, getOSTypes, getOSTechnicians } = require('../controllers/osController');
const { sendManagerCopy } = require('../controllers/serviceOrderManagerController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('crm.view'));

// OS Metadata
router.get('/types', getOSTypes);
router.get('/technicians', getOSTechnicians);

// Equipments (can be managed here or under contacts)
router.get('/contacts/:contactId/equipments', getEquipments);
router.get('/equipments/:equipmentId/open-orders', getOpenOrdersForEquipment);
router.post('/contacts/:contactId/equipments', requirePermission('inbox.create_os'), auditEvent('EQUIPMENT_CREATE', 'equipment', { resourceId: (req) => req.params.contactId }), addEquipment);
router.patch('/equipments/:id', requirePermission('inbox.create_os'), auditEvent('EQUIPMENT_UPDATE', 'equipment'), updateEquipment);
router.delete('/equipments/:id', requirePermission('inbox.create_os'), auditEvent('EQUIPMENT_DELETE', 'equipment'), deleteEquipment);

// OS CRUD
router.get('/', getOSList);
router.post('/', requirePermission('inbox.create_os'), auditEvent('SERVICE_ORDER_CREATE', 'service_order'), createOS);
router.post('/draft', requirePermission('inbox.create_os'), auditEvent('SERVICE_ORDER_DRAFT_CREATE', 'service_order'), draftOS);
router.get('/:id/status', getOSStatus);
router.post('/:id/send-manager-copy', requirePermission('inbox.create_os'), auditEvent('SERVICE_ORDER_MANAGER_COPY_SEND', 'service_order'), sendManagerCopy);
router.patch('/:id', requirePermission('inbox.create_os'), auditEvent('SERVICE_ORDER_UPDATE', 'service_order'), updateOS);
router.get('/:id/pdf', auditEvent('SERVICE_ORDER_PDF_VIEW', 'service_order'), generatePdf);

module.exports = router;
