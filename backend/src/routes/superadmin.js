const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const {
  listTenants, createTenant, updateTenant,
  listTenantUsers, createTenantUser, updateTenantUser,
  listFirebirdAgents,
} = require('../controllers/superAdminController');

router.use(authenticate);
router.get('/tenants', listTenants);
router.get('/firebird-agents', listFirebirdAgents);
router.post('/tenants', createTenant);
router.patch('/tenants/:id', updateTenant);
router.get('/tenants/:id/users', listTenantUsers);
router.post('/tenants/:id/users', createTenantUser);
router.patch('/tenants/:id/users/:userId', updateTenantUser);

module.exports = router;
