const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const { query } = require('../controllers/aiAssistantController');

// Assistente interno de leitura sobre clientes do iLux (Fase 1). Reaproveita
// o entitlement "crm" - é uma extensão dos dados do CRM, não um produto à parte.
router.use(authenticate, requirePermission('ai.assistant.query'), requireEntitlement('crm'));
router.post('/query', query);

module.exports = router;
