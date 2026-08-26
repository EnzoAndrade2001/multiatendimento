const express = require('express');
const router = express.Router();
const knowledgeController = require('../controllers/knowledgeController');
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const documentController = require('../controllers/knowledgeDocumentController');
const { knowledgeUpload } = require('../middlewares/knowledgeUpload');

router.use(authenticate, requirePermission('settings.bot.manage'));

router.get('/', knowledgeController.list);
router.get('/stats', knowledgeController.stats);
router.post('/test', knowledgeController.testSearch);
router.post('/reindex', knowledgeController.reindex);
router.get('/documents', documentController.list);
router.post('/documents', knowledgeUpload.single('file'), documentController.create);
router.get('/documents/:id', documentController.detail);
router.get('/documents/:id/download', documentController.download);
router.post('/documents/:id/process', documentController.reprocess);
router.post('/documents/:id/publish', documentController.publish);
router.post('/documents/:id/unpublish', documentController.unpublish);
router.delete('/documents/:id', documentController.remove);
router.post('/', knowledgeController.create);
router.put('/:id', knowledgeController.update);
router.delete('/:id', knowledgeController.remove);

module.exports = router;
