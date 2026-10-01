const router = require('express').Router();
const { handleWebhook, recordExternalMessage } = require('../controllers/webhookController');
const { handleLcdWebEvent } = require('../controllers/lcdWebEventController');
const verifyWebhookSecret = require('../middlewares/verifyWebhookSecret');

router.post('/lcd-web/events', handleLcdWebEvent);
router.post('/', verifyWebhookSecret, handleWebhook);
// Sistemas externos (LCDWEB) avisam aqui quando já mandaram uma mensagem
// direto pela Evolution — ver recordExternalMessage no controller.
router.post('/external-message', verifyWebhookSecret, recordExternalMessage);

module.exports = router;
