const { hasFeature } = require('../services/featureEntitlementService');

module.exports = (featureKey) => async (req, res, next) => {
  if (req.user?.role === 'superadmin' && req.user?.supportMode) return next();
  try {
    if (await hasFeature(req.user?.tenantId, featureKey)) return next();
    return res.status(403).json({ error: 'Funcionalidade não incluída no plano da empresa.', feature: featureKey });
  } catch (error) {
    console.error(`[entitlements] falha ao validar ${featureKey}:`, error.message);
    return res.status(503).json({ error: 'Não foi possível validar o plano da empresa.' });
  }
};
