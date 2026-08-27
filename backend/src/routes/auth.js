const router = require('express').Router();
const { login, me, getTenantBySlug, accessOptions } = require('../controllers/authController');
const { updateProfile } = require('../controllers/profileController');
const authenticate = require('../middlewares/authenticate');
const { parseUserAvatarUpload } = require('../middlewares/userAvatarUpload');
const { uploadProfileAvatar, removeProfileAvatar } = require('../controllers/userAvatarController');

router.get('/tenant/:slug', getTenantBySlug);
router.post('/login', login);
router.get('/me', authenticate, me);
router.get('/access-options', authenticate, accessOptions);
router.patch('/profile', authenticate, updateProfile);
router.post('/profile/avatar', authenticate, parseUserAvatarUpload, uploadProfileAvatar);
router.delete('/profile/avatar', authenticate, removeProfileAvatar);

module.exports = router;
