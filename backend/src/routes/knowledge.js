const express = require('express');
const router = express.Router();
const knowledgeController = require('../controllers/knowledgeController');
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const documentController = require('../controllers/knowledgeDocumentController');
const { handleKnowledgeUpload } = require('../middlewares/knowledgeUpload');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('settings.bot.manage'), requireEntitlement('ai_knowledge'));

router.get('/', knowledgeController.list);
router.get('/stats', knowledgeController.stats);
router.get('/audit', knowledgeController.audit);
router.post('/test', knowledgeController.testSearch);
router.post('/reindex', auditEvent('KNOWLEDGE_REINDEX', 'knowledge_base'), knowledgeController.reindex);
router.get('/documents', documentController.list);
router.post('/documents', handleKnowledgeUpload, auditEvent('KNOWLEDGE_DOCUMENT_CREATE', 'knowledge_document'), documentController.create);
router.get('/documents/:id', documentController.detail);
router.get('/documents/:id/download', auditEvent('KNOWLEDGE_DOCUMENT_DOWNLOAD', 'knowledge_document'), documentController.download);
router.patch('/documents/:id', auditEvent('KNOWLEDGE_DOCUMENT_UPDATE', 'knowledge_document'), documentController.update);
router.post('/documents/:id/process', auditEvent('KNOWLEDGE_DOCUMENT_PROCESS', 'knowledge_document'), documentController.reprocess);
router.post('/documents/:id/publish', auditEvent('KNOWLEDGE_DOCUMENT_PUBLISH', 'knowledge_document'), documentController.publish);
router.post('/documents/:id/unpublish', auditEvent('KNOWLEDGE_DOCUMENT_UNPUBLISH', 'knowledge_document'), documentController.unpublish);
router.delete('/documents/:id', auditEvent('KNOWLEDGE_DOCUMENT_DELETE', 'knowledge_document'), documentController.remove);
router.post('/', auditEvent('KNOWLEDGE_CREATE', 'knowledge'), knowledgeController.create);
router.put('/:id', auditEvent('KNOWLEDGE_UPDATE', 'knowledge'), knowledgeController.update);
router.delete('/:id', auditEvent('KNOWLEDGE_DELETE', 'knowledge'), knowledgeController.remove);

module.exports = router;
