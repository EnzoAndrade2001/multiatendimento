const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const requirePermission = require('../middlewares/requirePermission');
const requireEntitlement = require('../middlewares/requireEntitlement');
const controller = require('../controllers/internalMessageController');
const { internalChatUpload } = require('../middlewares/internalChatUpload');
const auditEvent = require('../middlewares/auditEvent');

router.use(authenticate, requirePermission('internal_chat.view'), requireEntitlement('internal_chat'));
router.get('/conversations', controller.listConversations);
router.get('/conversations/:key/messages', controller.listConversationMessages);
router.patch('/conversations/:key/read', auditEvent('INTERNAL_CONVERSATION_READ', 'internal_conversation', { resourceId: (req) => req.params.key }), controller.markRead);
router.patch('/conversations/:key/pin', auditEvent('INTERNAL_CONVERSATION_PIN', 'internal_conversation', { resourceId: (req) => req.params.key }), controller.pinConversation);
router.post('/messages', auditEvent('INTERNAL_MESSAGE_SEND', 'internal_message'), controller.sendMessage);
router.post('/messages/attachment', (req, res, next) => {
  internalChatUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode || 400;
    return res.status(status).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'O anexo excede o limite de 20 MB.' : error.message,
    });
  });
}, auditEvent('INTERNAL_MESSAGE_ATTACHMENT_SEND', 'internal_message'), controller.sendMessage);
router.get('/messages/:id/thread', controller.getThread);
router.post('/messages/:id/reactions', auditEvent('INTERNAL_MESSAGE_REACTION_ADD', 'internal_message'), controller.setReaction);
router.delete('/messages/:id/reactions/:emoji', auditEvent('INTERNAL_MESSAGE_REACTION_REMOVE', 'internal_message'), controller.removeReaction);
router.get('/', controller.list);
router.post('/', auditEvent('INTERNAL_MESSAGE_SEND_LEGACY', 'internal_message'), controller.send);

module.exports = router;
