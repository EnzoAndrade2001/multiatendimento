const crypto = require('crypto');

function safelyEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left)).digest();
  const rightDigest = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

module.exports = function verifyWebhookSecret(req, res, next) {
  const expected = String(process.env.WEBHOOK_SECRET || '').trim();
  // Fail closed in production: an unset secret must never turn a state-changing
  // webhook into an anonymous endpoint. Local development can opt in explicitly.
  if (!expected) {
    if (process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true' && process.env.NODE_ENV !== 'production') {
      return next();
    }
    return res.status(503).json({ error: 'Webhook indisponivel: segredo nao configurado.' });
  }

  const authorization = req.header('authorization') || '';
  const bearer = authorization.replace(/^Bearer\s+/i, '');
  const provided = req.header('x-webhook-secret') || bearer || req.query?.token;
  if (!provided || !safelyEqual(provided, expected)) {
    return res.status(401).json({ error: 'Webhook nao autorizado.' });
  }
  return next();
};
