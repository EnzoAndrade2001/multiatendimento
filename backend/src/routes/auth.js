const router = require('express').Router();
const { login, supportLogin, me, getTenantBySlug, accessOptions } = require('../controllers/authController');
const { updateProfile } = require('../controllers/profileController');
const authenticate = require('../middlewares/authenticate');
const { parseUserAvatarUpload } = require('../middlewares/userAvatarUpload');
const { uploadProfileAvatar, removeProfileAvatar } = require('../controllers/userAvatarController');
const auditEvent = require('../middlewares/auditEvent');

// Small in-process guard against credential stuffing. It is intentionally
// conservative; a shared rate limiter should still be enforced at the edge
// when the service runs on multiple instances.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 30;

function loginRateLimit(req, res, next) {
  const now = Date.now();
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const previous = loginAttempts.get(key);
  if (!previous || now - previous.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { startedAt: now, count: 1 });
    return next();
  }
  previous.count += 1;
  if (previous.count > LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - previous.startedAt)) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Muitas tentativas de login. Tente novamente mais tarde.' });
  }
  return next();
}

router.get('/tenant/:slug', getTenantBySlug);
router.post('/login', loginRateLimit, login);
router.post('/support-login', loginRateLimit, supportLogin);
router.get('/me', authenticate, me);
router.get('/access-options', authenticate, accessOptions);
router.patch('/profile', authenticate, auditEvent('PROFILE_UPDATE', 'profile'), updateProfile);
router.post('/profile/avatar', authenticate, parseUserAvatarUpload, auditEvent('PROFILE_AVATAR_UPDATE', 'profile'), uploadProfileAvatar);
router.delete('/profile/avatar', authenticate, auditEvent('PROFILE_AVATAR_DELETE', 'profile'), removeProfileAvatar);

module.exports = router;
