const crypto = require('crypto');

function safelyEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left)).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

module.exports = function verifyWebhookSecret(req, res, next) {
  const expected = String(process.env.WEBHOOK_SECRET || '').trim();
  if (!expected) return next();

  const authorization = req.header('authorization') || '';
  const bearer = authorization.replace(/^Bearer\s+/i, '');
  const provided = req.header('x-webhook-secret') || bearer;
  if (!provided || !safelyEqual(provided, expected)) {
    return res.status(401).json({ error: 'Webhook nao autorizado.' });
  }
  return next();
};
