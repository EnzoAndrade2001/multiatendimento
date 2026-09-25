const router = require('express').Router();
const { handleWebhook, recordExternalMessage } = require('../controllers/webhookController');
const verifyWebhookSecret = require('../middlewares/verifyWebhookSecret');

router.post('/', verifyWebhookSecret, handleWebhook);
// Sistemas externos (LCDWEB) avisam aqui quando já mandaram uma mensagem
// direto pela Evolution — ver recordExternalMessage no controller.
router.post('/external-message', verifyWebhookSecret, recordExternalMessage);

module.exports = router;
