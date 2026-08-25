const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const controller = require('../controllers/internalMessageController');
const { internalChatUpload } = require('../middlewares/internalChatUpload');

router.use(authenticate, requirePermission('internal_chat.view'));
router.get('/conversations', controller.listConversations);
router.get('/conversations/:key/messages', controller.listConversationMessages);
router.patch('/conversations/:key/read', controller.markRead);
router.patch('/conversations/:key/pin', controller.pinConversation);
router.post('/messages', controller.sendMessage);
router.post('/messages/attachment', (req, res, next) => {
  internalChatUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || 400;
    return res.status(status).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'O anexo excede o limite de 20 MB.' : error.message,
    });
  });
}, controller.sendMessage);
router.get('/messages/:id/thread', controller.getThread);
router.post('/messages/:id/reactions', controller.setReaction);
router.delete('/messages/:id/reactions/:emoji', controller.removeReaction);
router.get('/', controller.list);
router.post('/', controller.send);

module.exports = router;
