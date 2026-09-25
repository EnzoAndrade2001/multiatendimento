const { hasPermission } = require('./permissions');

const SECRET_PLACEHOLDER = '********';
const SECRET_SETTINGS_FIELDS = new Set([
  'evolutionKey', 'geminiKey', 'openaiKey', 'anthropicKey', 'serpApiKey',
  'plugBoletoToken',
]);

// Infraestrutura e credenciais sao administradas pela equipe que opera o SaaS.
// Uma permissao de tenant (inclusive o papel admin) nunca deve liberar estes
// campos; o acesso ocorre apenas pelo superadmin, normalmente em supportMode.
const SUPPORT_ONLY_SETTINGS_FIELDS = new Set([
  'aiProvider', 'aiModel', 'aiAuxProvider', 'aiModelCatalog',
  'geminiKey', 'openaiKey', 'anthropicKey',
  'evolutionUrl', 'evolutionKey', 'webhookUrl', 'serpApiKey',
  'plugBoletoEnabled', 'plugBoletoBaseUrl', 'plugBoletoPrintPath',
  'plugBoletoCedenteCnpj', 'plugBoletoToken', 'plugBoletoTokenSet',
  'plugBoletoConfigSyncedAt', 'statementRerenderEnabled',
  'kpiContractValue', 'kpiServiceValue', 'kpiSlaLimitHours', 'kpiReincidentThreshold',
]);

function hasSupportSettingsAccess(user) {
  return user?.role === 'superadmin';
}

const SETTINGS_FIELDS = Object.freeze({
  'settings.bot.manage': [
    'botEnabled', 'aiProvider', 'aiModel', 'aiAuxProvider', 'aiModelCatalog', 'geminiKey', 'openaiKey', 'anthropicKey',
    'botName', 'systemPrompt', 'transferKeyword',
  ],
  'settings.attendance.manage': [
    'outOfOfficeMessage', 'ratingEnabled', 'ratingMessage', 'notificationPhone',
    'serviceOrderManagerCopyEnabled', 'serviceOrderManagerPhone', 'serviceOrderManagerInstanceId',
    'billingMessageTemplate', 'billingInstanceId',
  ],
  'settings.company.manage': [
    'companyName', 'companyCnpj', 'companyIE', 'companyAddress', 'companyBairro',
    'companyCep', 'companyPhone', 'companyCity', 'companyState', 'osAccentColor', 'osBarcodeEnabled',
    // Perfil somente leitura consultado no LCDDIGITALWEB.
    'iluxCompany', 'iluxCompanySyncStatus', 'iluxCompanySyncRequestedAt',
    'iluxCompanySyncRequestId', 'iluxCompanySyncError',
  ],
  'settings.agent.manage': [
    'plugBoletoEnabled', 'plugBoletoBaseUrl', 'plugBoletoPrintPath', 'plugBoletoCedenteCnpj',
    'plugBoletoToken', 'plugBoletoTokenSet', 'plugBoletoConfigSyncedAt',
    'statementRerenderEnabled',
  ],
  'connections.manage': ['evolutionUrl', 'evolutionKey', 'webhookUrl'],
  'leads.manage': ['serpApiKey'],
  'revenue.view': ['kpiContractValue', 'kpiServiceValue', 'kpiSlaLimitHours', 'kpiReincidentThreshold'],
});

function allowedSettingsFields(user) {
  const fields = new Set(Object.entries(SETTINGS_FIELDS)
    .filter(([permission]) => hasPermission(user, permission))
    .flatMap(([, fields]) => fields));
  if (!hasSupportSettingsAccess(user)) {
    SUPPORT_ONLY_SETTINGS_FIELDS.forEach((field) => fields.delete(field));
  }
  return fields;
}

function filterSettingsInput(user, input = {}) {
  const allowed = allowedSettingsFields(user);
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => {
    if (!allowed.has(key)) return false;
    if (!SECRET_SETTINGS_FIELDS.has(key)) return true;
    return typeof value === 'string'
      ? Boolean(value.trim()) && value !== SECRET_PLACEHOLDER
      : value !== null && value !== undefined;
  }));
}

function filterSettingsOutput(user, output = {}) {
  const allowed = allowedSettingsFields(user);
  return Object.fromEntries(Object.entries(output)
    .filter(([key]) => allowed.has(key) || ['id', 'tenantId', 'createdAt', 'updatedAt'].includes(key))
    .map(([key, value]) => [key, SECRET_SETTINGS_FIELDS.has(key) && value ? SECRET_PLACEHOLDER : value]));
}

module.exports = {
  SETTINGS_FIELDS, SECRET_PLACEHOLDER, SECRET_SETTINGS_FIELDS,
  SUPPORT_ONLY_SETTINGS_FIELDS, hasSupportSettingsAccess,
  allowedSettingsFields, filterSettingsInput, filterSettingsOutput,
};
