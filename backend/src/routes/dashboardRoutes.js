const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const { getStats } = require('../controllers/dashboardController');

router.use(authenticate, requirePermission('dashboard.view'), requireEntitlement('dashboard'));
router.get('/stats', getStats);

module.exports = router;
