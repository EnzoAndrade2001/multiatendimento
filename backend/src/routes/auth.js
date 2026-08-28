const router = require('express').Router();
const { login, me, getTenantBySlug, accessOptions } = require('../controllers/authController');
const { updateProfile } = require('../controllers/profileController');
const authenticate = require('../middlewares/authenticate');
const { parseUserAvatarUpload } = require('../middlewares/userAvatarUpload');
const { uploadProfileAvatar, removeProfileAvatar } = require('../controllers/userAvatarController');
const auditEvent = require('../middlewares/auditEvent');

router.get('/tenant/:slug', getTenantBySlug);
router.post('/login', login);
router.get('/me', authenticate, me);
router.get('/access-options', authenticate, accessOptions);
router.patch('/profile', authenticate, auditEvent('PROFILE_UPDATE', 'profile'), updateProfile);
router.post('/profile/avatar', authenticate, parseUserAvatarUpload, auditEvent('PROFILE_AVATAR_UPDATE', 'profile'), uploadProfileAvatar);
router.delete('/profile/avatar', authenticate, auditEvent('PROFILE_AVATAR_DELETE', 'profile'), removeProfileAvatar);

module.exports = router;
