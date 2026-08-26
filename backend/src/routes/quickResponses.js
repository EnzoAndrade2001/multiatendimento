const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const { listQuickResponses, createQuickResponse, updateQuickResponse, useQuickResponse, stats, deleteQuickResponse } = require('../controllers/quickResponseController');

router.use(authenticate, requirePermission('quick_responses.manage'));
router.get('/', listQuickResponses);
router.get('/stats', stats);
router.post('/', createQuickResponse);
router.patch('/:id', updateQuickResponse);
router.post('/:id/use', useQuickResponse);
router.delete('/:id', deleteQuickResponse);

module.exports = router;
