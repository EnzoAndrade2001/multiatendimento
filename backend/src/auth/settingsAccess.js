const { hasPermission } = require('./permissions');

const SETTINGS_FIELDS = Object.freeze({
  'settings.bot.manage': ['botEnabled', 'geminiKey', 'botName', 'systemPrompt', 'transferKeyword'],
  'settings.attendance.manage': [
    'outOfOfficeMessage', 'ratingEnabled', 'ratingMessage', 'notificationPhone',
    'serviceOrderManagerCopyEnabled', 'serviceOrderManagerPhone', 'serviceOrderManagerInstanceId',
    'billingMessageTemplate',
  ],
  'settings.company.manage': [
    'companyName', 'companyCnpj', 'companyIE', 'companyAddress', 'companyBairro',
    'companyCep', 'companyPhone', 'companyCity', 'companyState',
    // Perfil somente leitura sincronizado do Firebird/IEMPRESA.
    'firebirdCompany', 'firebirdCompanySyncStatus', 'firebirdCompanySyncRequestedAt',
    'firebirdCompanySyncRequestId', 'firebirdCompanySyncError',
  ],
  'settings.agent.manage': [
    'firebirdClientToken', 'firebirdApiUrl', 'firebirdApiKey', 'firebirdAuthMode',
    'firebirdHealthPath', 'firebirdContactsPath', 'firebirdSyncEnabled', 'firebirdLastSyncAt',
    'firebirdLastSyncStatus', 'firebirdLastSyncError',
  ],
  'connections.manage': ['evolutionUrl', 'evolutionKey', 'webhookUrl'],
  'leads.manage': ['serpApiKey'],
  'revenue.view': ['kpiContractValue', 'kpiServiceValue', 'kpiSlaLimitHours', 'kpiReincidentThreshold'],
});

function allowedSettingsFields(user) {
  return new Set(Object.entries(SETTINGS_FIELDS)
    .filter(([permission]) => hasPermission(user, permission))
    .flatMap(([, fields]) => fields));
}

function filterSettingsInput(user, input = {}) {
  const allowed = allowedSettingsFields(user);
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
}

function filterSettingsOutput(user, output = {}) {
  const allowed = allowedSettingsFields(user);
  return Object.fromEntries(Object.entries(output).filter(([key]) => (
    allowed.has(key) || ['id', 'tenantId', 'createdAt', 'updatedAt'].includes(key)
  )));
}

module.exports = { SETTINGS_FIELDS, allowedSettingsFields, filterSettingsInput, filterSettingsOutput };
