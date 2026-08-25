const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const { downloadMedia } = require('../controllers/mediaController');

router.get('/:filename', authenticate, downloadMedia);

module.exports = router;
