const { filterSettingsInput, hasSupportSettingsAccess, SUPPORT_ONLY_SETTINGS_FIELDS } = require('../auth/settingsAccess');

module.exports = (req, res, next) => {
  const attemptedSupportFields = Object.keys(req.body || {}).filter((field) => SUPPORT_ONLY_SETTINGS_FIELDS.has(field));
  if (attemptedSupportFields.length && !hasSupportSettingsAccess(req.user)) {
    return res.status(403).json({
      error: 'Configuracao disponivel somente para o suporte tecnico',
      fields: attemptedSupportFields,
    });
  }
  req.body = filterSettingsInput(req.user, req.body);
  next();
};
