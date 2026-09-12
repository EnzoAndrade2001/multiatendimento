const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const {
  listTenants, createTenant, updateTenant, updateTenantCommercial,
  listTenantUsers, createTenantUser, updateTenantUser,
  listFirebirdAgents,
  startSupportSession, endSupportSession,
  listSupportSessions, revokeSupportSession,
  listSupportUsers, createSupportUser, updateSupportUser,
} = require('../controllers/superAdminController');
const { listCatalog, upsertFeature, upsertPlan, setPlanFeatures, getTenantEntitlements, setTenantOverrides } = require('../controllers/entitlementController');
const { listAgentOperations, requestAgentVersion, listAgentReleases, downloadAgentRelease, getChecklist, updateChecklistItem } = require('../controllers/supportOperationsController');

router.use(authenticate);
router.get('/tenants', listTenants);
router.get('/firebird-agents', listFirebirdAgents);
router.get('/agent-operations', listAgentOperations);
router.post('/agent-operations/:agentId/version', requestAgentVersion);
router.get('/agent-releases', listAgentReleases);
router.get('/agent-releases/:version/download', downloadAgentRelease);
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

module.exports = router;
