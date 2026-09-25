const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const {
  listTenants, createTenant, updateTenant, updateTenantCommercial,
  listTenantUsers, createTenantUser, updateTenantUser,
  startSupportSession, endSupportSession,
  listSupportSessions, revokeSupportSession,
  listSupportUsers, createSupportUser, updateSupportUser,
  listEvolutionServers, createEvolutionServer, updateEvolutionServer, deleteEvolutionServer,
} = require('../controllers/superAdminController');
const { listCatalog, upsertFeature, upsertPlan, setPlanFeatures, getTenantEntitlements, setTenantOverrides } = require('../controllers/entitlementController');
const { getChecklist, updateChecklistItem } = require('../controllers/supportOperationsController');

router.use(authenticate);
router.get('/tenants', listTenants);
router.get('/tenants/:tenantId/deployment-checklist', getChecklist);
router.patch('/tenants/:tenantId/deployment-checklist/:itemId', updateChecklistItem);
router.get('/support-users', listSupportUsers);
router.post('/support-users', createSupportUser);
router.patch('/support-users/:userId', updateSupportUser);
router.get('/product-catalog', listCatalog);
router.put('/features', upsertFeature);
router.put('/plans', upsertPlan);
router.put('/plans/:planId/features', setPlanFeatures);
router.get('/tenants/:id/entitlements', getTenantEntitlements);
router.put('/tenants/:id/entitlements', setTenantOverrides);
router.post('/tenants', createTenant);
router.patch('/tenants/:id', updateTenant);
router.patch('/tenants/:id/commercial', updateTenantCommercial);
router.post('/tenants/:id/support-session', startSupportSession);
router.post('/support-session/end', endSupportSession);
router.get('/support-sessions', listSupportSessions);
router.delete('/support-sessions/:id', revokeSupportSession);
router.get('/tenants/:id/users', listTenantUsers);
router.post('/tenants/:id/users', createTenantUser);
router.patch('/tenants/:id/users/:userId', updateTenantUser);
router.get('/evolution-servers', listEvolutionServers);
router.post('/evolution-servers', createEvolutionServer);
router.patch('/evolution-servers/:id', updateEvolutionServer);
router.delete('/evolution-servers/:id', deleteEvolutionServer);

module.exports = router;
