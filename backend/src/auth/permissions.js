const PERMISSIONS = Object.freeze([
  'dashboard.view',
  'inbox.view',
  'inbox.view_all',
  'inbox.assign',
  'inbox.transfer',
  'inbox.resolve',
  'inbox.reopen',
  'inbox.delete_message',
  'inbox.create_os',
  'crm.view',
  'crm.financial.view',
  'crm.financial.send',
  'billing.view',
  'billing.reprocess',
  'campaigns.manage',
  'leads.manage',
  'connections.manage',
  'revenue.view',
  'settings.bot.manage',
  'settings.attendance.manage',
  'users.manage',
  'teams.manage',
  'settings.company.manage',
  'quick_responses.manage',
  'tags.manage',
  'settings.agent.manage',
  'internal_chat.view',
  'privacy.manage',
  'audit.view',
  'telemetry.view',
  'telemetry.manage',
  'ai.assistant.query',
]);

const ATTENDANT = [
  'dashboard.view', 'inbox.view', 'inbox.assign', 'inbox.transfer',
  'inbox.resolve', 'inbox.reopen', 'inbox.create_os', 'crm.view',
  'quick_responses.manage', 'tags.manage', 'internal_chat.view', 'telemetry.view',
  'ai.assistant.query',
];

const PROFILE_PERMISSIONS = Object.freeze({
  admin: PERMISSIONS,
  supervisor: [
    ...ATTENDANT, 'inbox.view_all', 'inbox.delete_message',
    'crm.financial.view', 'billing.view', 'campaigns.manage', 'leads.manage',
    'revenue.view', 'teams.manage', 'settings.attendance.manage', 'audit.view',
    'telemetry.view', 'telemetry.manage',
  ],
  agent: ATTENDANT,
  financeiro: [
    'dashboard.view', 'inbox.view', 'inbox.resolve', 'crm.view',
    'crm.financial.view', 'crm.financial.send', 'billing.view',
    'billing.reprocess', 'internal_chat.view',
    'telemetry.view', 'ai.assistant.query',
  ],
  tecnico: [
    'dashboard.view', 'inbox.view', 'inbox.assign', 'inbox.resolve',
    'inbox.reopen', 'inbox.create_os', 'crm.view', 'internal_chat.view',
    'telemetry.view', 'ai.assistant.query',
  ],
  personalizado: [],
});

const PROFILE_ALIASES = Object.freeze({
  administrator: 'admin',
  atendente: 'agent',
  financial: 'financeiro',
  technician: 'tecnico',
  custom: 'personalizado',
});

const HOME_PAGE_PERMISSIONS = Object.freeze({
  '/dashboard': 'dashboard.view',
  '/inbox': 'inbox.view',
  '/crm': 'crm.view',
  '/billing-reports': 'billing.view',
  '/settings': null,
});

function normalizeProfile(profile, role = 'agent') {
  if (role === 'superadmin') return 'admin';
  if (role === 'admin') return 'admin';
  const normalized = String(profile || role || 'agent').trim().toLowerCase();
  const resolved = PROFILE_ALIASES[normalized] || normalized;
  return Object.hasOwn(PROFILE_PERMISSIONS, resolved) ? resolved : 'agent';
}

function normalizePermissionList(value) {
  let values = value;
  if (typeof values === 'string') {
    try { values = JSON.parse(values); } catch { values = []; }
  }
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((key) => PERMISSIONS.includes(key)))];
}

function resolveUserAccess(user) {
  const profile = normalizeProfile(user?.accessProfile, user?.role);
  const permissions = profile === 'personalizado'
    ? normalizePermissionList(user?.permissions)
    : [...PROFILE_PERMISSIONS[profile]];
  return { profile, permissions };
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'superadmin' || user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function resolveHomePage(homePage, access) {
  const permissions = Array.isArray(access?.permissions) ? access.permissions : [];
  const isAllowed = (path) => Object.hasOwn(HOME_PAGE_PERMISSIONS, path)
    && (!HOME_PAGE_PERMISSIONS[path] || permissions.includes(HOME_PAGE_PERMISSIONS[path]));
  if (isAllowed(homePage)) return homePage;
  return Object.keys(HOME_PAGE_PERMISSIONS).find(isAllowed) || '/settings';
}

module.exports = {
  PERMISSIONS,
  PROFILE_PERMISSIONS,
  normalizeProfile,
  normalizePermissionList,
  resolveUserAccess,
  hasPermission,
  resolveHomePage,
};
