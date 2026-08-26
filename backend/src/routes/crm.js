const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const {
  getSummary,
  listCustomers,
  exportCustomers,
  getCustomer,
  getCustomerContracts,
  getCustomerServiceOrders,
  getCustomer360,
  getReceivableBoleto,
  getReceivableDocuments,
  getReceivableDocument,
  sendReceivableDocuments,
  listFlaggedBillingDocuments,
  listEquipments,
} = require('../controllers/crmController');

router.use(authenticate);
router.use(requirePermission('crm.view'));

router.get('/summary', asyncRoute(getSummary));
// Keep export before /customers/:id so the literal path is not interpreted as an id.
router.get('/customers/export', asyncRoute(exportCustomers));
router.get('/customers', asyncRoute(listCustomers));
router.get('/customers/:id', asyncRoute(getCustomer));
router.get('/customers/:id/contracts', asyncRoute(getCustomerContracts));
router.get('/customers/:id/service-orders', asyncRoute(getCustomerServiceOrders));
router.get('/customers/:id/360', asyncRoute(getCustomer360));
router.post('/customers/:id/receivables/:receivableId/boleto', requirePermission('crm.financial.view'), asyncRoute(getReceivableBoleto));
router.get('/customers/:id/receivables/:receivableId/documents', requirePermission('crm.financial.view'), asyncRoute(getReceivableDocuments));
router.post('/customers/:id/receivables/:receivableId/documents/send', requirePermission('crm.financial.send'), asyncRoute(sendReceivableDocuments));
router.post('/customers/:id/receivables/:receivableId/documents/:documentType', requirePermission('crm.financial.view'), asyncRoute(getReceivableDocument));
router.get('/financial/flagged-documents', requirePermission('crm.financial.view'), asyncRoute(listFlaggedBillingDocuments));
router.get('/equipments', asyncRoute(listEquipments));

module.exports = router;
