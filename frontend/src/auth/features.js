export const FEATURE_KEYS = {
  dashboard: 'dashboard',
  inbox: 'inbox',
  crm: 'crm',
  serviceOrders: 'service_orders',
  internalChat: 'internal_chat',
  campaigns: 'campaigns',
  aiKnowledge: 'ai_knowledge',
  aiAssistant: 'ai_assistant',
  billing: 'billing',
  leads: 'lead_generation',
  sentinel: 'ilux_sentinel',
  telemetry: 'telemetry',
  audit: 'audit',
  connections: 'connections',
  quickResponses: 'quick_responses',
  privacy: 'privacy',
  settings: 'settings',
};

export const PERMISSION_FEATURE = {
  'dashboard.view': FEATURE_KEYS.dashboard,
  'inbox.view': FEATURE_KEYS.inbox,
  'crm.view': FEATURE_KEYS.crm,
  'internal_chat.view': FEATURE_KEYS.internalChat,
  'campaigns.manage': FEATURE_KEYS.campaigns,
  'settings.bot.manage': FEATURE_KEYS.aiKnowledge,
  'ai.assistant.query': FEATURE_KEYS.aiAssistant,
  'billing.view': FEATURE_KEYS.billing,
  'leads.manage': FEATURE_KEYS.leads,
  'revenue.view': FEATURE_KEYS.sentinel,
  'telemetry.view': FEATURE_KEYS.telemetry,
  'audit.view': FEATURE_KEYS.audit,
  'connections.manage': FEATURE_KEYS.connections,
  'quick_responses.manage': FEATURE_KEYS.quickResponses,
};

export function normalizeEntitlements(payload) {
  const source = payload?.entitlements || payload?.data || payload || {};
  const rawFeatures = source.features || source.enabledFeatures || [];
  const features = new Set(
    Array.isArray(rawFeatures)
      ? rawFeatures.filter((item) => typeof item !== 'object' || item?.enabled !== false).map((item) => String(item?.key || item?.featureKey || item))
      : Object.entries(rawFeatures).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key)
  );
  return {
    planKey: source.planKey || source.planCode || source.plan?.code || source.plan?.key || source.plan || null,
    features,
    limits: source.limits || {},
    managed: source.managed !== false,
  };
}
