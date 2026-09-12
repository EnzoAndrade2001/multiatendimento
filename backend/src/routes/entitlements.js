const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const { getMyEntitlements } = require('../controllers/entitlementController');
router.get('/me', authenticate, getMyEntitlements);
module.exports = router;
