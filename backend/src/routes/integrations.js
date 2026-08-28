const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const {
  syncFirebirdContacts,
  testFirebirdConnection,
} = require('../controllers/integrationController');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate);

router.post('/firebird/test', requirePermission('settings.agent.manage'), auditEvent('FIREBIRD_CONNECTION_TEST', 'integration'), testFirebirdConnection);
router.post('/firebird/sync/contacts', requirePermission('settings.agent.manage'), auditEvent('FIREBIRD_CONTACTS_SYNC', 'integration'), syncFirebirdContacts);

module.exports = router;
