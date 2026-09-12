const { hasSupportSettingsAccess } = require('../auth/settingsAccess');

module.exports = (req, res, next) => {
  if (hasSupportSettingsAccess(req.user)) return next();
  return res.status(403).json({ error: 'Configuracao disponivel somente para o suporte tecnico' });
};
