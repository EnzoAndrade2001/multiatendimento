const express = require('express');
const router = express.Router();
const knowledgeController = require('../controllers/knowledgeController');
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');

router.use(authenticate, requirePermission('settings.bot.manage'));

router.get('/', knowledgeController.list);
router.get('/stats', knowledgeController.stats);
router.post('/test', knowledgeController.testSearch);
router.post('/reindex', knowledgeController.reindex);
router.post('/', knowledgeController.create);
router.put('/:id', knowledgeController.update);
router.delete('/:id', knowledgeController.remove);

module.exports = router;
