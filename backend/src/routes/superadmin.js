const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const {
  listTenants, createTenant, updateTenant,
  listTenantUsers, createTenantUser, updateTenantUser,
  listFirebirdAgents,
  startSupportSession, endSupportSession,
} = require('../controllers/superAdminController');
const { listCatalog, upsertFeature, upsertPlan, setPlanFeatures, getTenantEntitlements, setTenantOverrides } = require('../controllers/entitlementController');

router.use(authenticate);
router.get('/tenants', listTenants);
router.get('/firebird-agents', listFirebirdAgents);
router.get('/product-catalog', listCatalog);
router.put('/features', upsertFeature);
router.put('/plans', upsertPlan);
router.put('/plans/:planId/features', setPlanFeatures);
router.get('/tenants/:id/entitlements', getTenantEntitlements);
router.put('/tenants/:id/entitlements', setTenantOverrides);
router.post('/tenants', createTenant);
router.patch('/tenants/:id', updateTenant);
router.post('/tenants/:id/support-session', startSupportSession);
router.post('/support-session/end', endSupportSession);
router.get('/tenants/:id/users', listTenantUsers);
router.post('/tenants/:id/users', createTenantUser);
router.patch('/tenants/:id/users/:userId', updateTenantUser);

module.exports = router;
