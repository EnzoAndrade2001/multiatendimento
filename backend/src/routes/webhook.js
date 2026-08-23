const router = require('express').Router();
const { handleWebhook } = require('../controllers/webhookController');
const verifyWebhookSecret = require('../middlewares/verifyWebhookSecret');

router.post('/', verifyWebhookSecret, handleWebhook);

module.exports = router;
