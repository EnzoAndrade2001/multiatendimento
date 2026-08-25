const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const controller = require('../controllers/internalMessageController');

router.use(authenticate, requirePermission('internal_chat.view'));
router.get('/conversations', controller.listConversations);
router.get('/conversations/:key/messages', controller.listConversationMessages);
router.patch('/conversations/:key/read', controller.markRead);
router.patch('/conversations/:key/pin', controller.pinConversation);
router.post('/messages', controller.sendMessage);
router.get('/messages/:id/thread', controller.getThread);
router.post('/messages/:id/reactions', controller.setReaction);
router.delete('/messages/:id/reactions/:emoji', controller.removeReaction);
router.get('/', controller.list);
router.post('/', controller.send);

module.exports = router;
