const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const { downloadUserAvatar } = require('../controllers/userAvatarController');

router.get('/:filename', authenticate, downloadUserAvatar);

module.exports = router;
