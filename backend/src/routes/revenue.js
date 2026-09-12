const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const { 
  getRevenueDashboard, 
  getBenchmark, 
  getDetective, 
  auditTicket, 
  getAuditedTickets,
  getDrilldown
} = require('../controllers/revenueController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('revenue.view'), requireEntitlement('ilux_sentinel'));
router.get('/stats', getRevenueDashboard);
router.get('/benchmark', getBenchmark);
router.get('/detective', getDetective);
router.get('/audit', getAuditedTickets);
router.post('/audit/:ticketId', auditEvent('TICKET_QUALITY_AUDIT', 'ticket', { resourceId: (req) => req.params.ticketId }), auditTicket);
router.get('/drilldown/:type', getDrilldown);

module.exports = router;
