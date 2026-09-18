export const PERMISSION_KEYS = [
  'dashboard.view', 'inbox.view', 'inbox.view_all', 'inbox.assign', 'inbox.transfer',
  'inbox.resolve', 'inbox.reopen', 'inbox.delete_message', 'inbox.create_os', 'crm.view',
  'crm.financial.view', 'crm.financial.send', 'billing.view', 'billing.reprocess',
  'campaigns.manage', 'leads.manage', 'connections.manage', 'revenue.view',
  'settings.bot.manage', 'settings.attendance.manage', 'users.manage', 'teams.manage',
  'settings.company.manage', 'quick_responses.manage', 'tags.manage',
  'settings.agent.manage', 'privacy.manage', 'audit.view', 'telemetry.view', 'telemetry.manage', 'internal_chat.view',
  'ai.assistant.query',
];

export const ACCESS_PROFILES = {
  admin: { label: 'Administrador', permissions: PERMISSION_KEYS, homePage: '/dashboard' },
  supervisor: {
    label: 'Supervisor', homePage: '/inbox', permissions: [
      'dashboard.view', 'inbox.view', 'inbox.assign', 'inbox.transfer', 'inbox.resolve',
      'inbox.reopen', 'inbox.create_os', 'crm.view', 'quick_responses.manage',
      'tags.manage', 'internal_chat.view', 'inbox.view_all', 'inbox.delete_message',
      'crm.financial.view', 'billing.view', 'campaigns.manage', 'leads.manage',
      'revenue.view', 'teams.manage', 'settings.attendance.manage', 'telemetry.view', 'telemetry.manage', 'ai.assistant.query',
    ],
  },
  agent: {
    label: 'Atendente', homePage: '/inbox', permissions: [
      'dashboard.view', 'inbox.view', 'inbox.assign', 'inbox.transfer', 'inbox.resolve',
      'inbox.reopen', 'inbox.create_os', 'crm.view', 'quick_responses.manage',
      'tags.manage', 'internal_chat.view', 'telemetry.view', 'ai.assistant.query',
    ],
  },
  financeiro: {
    label: 'Financeiro', homePage: '/crm', permissions: [
      'dashboard.view', 'inbox.view', 'inbox.resolve', 'crm.view', 'crm.financial.view',
      'crm.financial.send', 'billing.view', 'billing.reprocess', 'internal_chat.view', 'telemetry.view', 'ai.assistant.query',
    ],
  },
  tecnico: {
    label: 'Técnico', homePage: '/inbox', permissions: [
      'dashboard.view', 'inbox.view', 'inbox.assign', 'inbox.resolve', 'inbox.reopen', 'inbox.create_os',
      'crm.view', 'internal_chat.view', 'telemetry.view', 'ai.assistant.query',
    ],
  },
  personalizado: { label: 'Personalizado', homePage: '/inbox', permissions: [] },
};

export const PERMISSION_GROUPS = [
  { label: 'Atendimento', keys: PERMISSION_KEYS.filter((key) => key.startsWith('inbox.')) },
  { label: 'CRM e financeiro', keys: PERMISSION_KEYS.filter((key) => key.startsWith('crm.') || key.startsWith('billing.')) },
  { label: 'Operação', keys: ['dashboard.view', 'campaigns.manage', 'leads.manage', 'connections.manage', 'revenue.view', 'telemetry.view', 'telemetry.manage', 'internal_chat.view', 'ai.assistant.query'] },
  { label: 'Administração', keys: PERMISSION_KEYS.filter((key) => key.startsWith('settings.') || ['users.manage', 'teams.manage', 'quick_responses.manage', 'tags.manage', 'privacy.manage', 'audit.view'].includes(key)) },
];

export const PERMISSION_LABELS = {
  'dashboard.view': 'Ver dashboard', 'inbox.view': 'Acessar atendimento',
  'inbox.view_all': 'Ver todas as conversas', 'inbox.assign': 'Assumir/atribuir',
  'inbox.transfer': 'Transferir', 'inbox.resolve': 'Encerrar', 'inbox.reopen': 'Reabrir',
  'inbox.delete_message': 'Excluir mensagens', 'inbox.create_os': 'Abrir O.S.',
  'crm.view': 'Acessar CRM', 'crm.financial.view': 'Ver valores financeiros',
  'crm.financial.send': 'Enviar documentos financeiros', 'billing.view': 'Ver relatórios de cobrança',
  'billing.reprocess': 'Reprocessar cobranças', 'campaigns.manage': 'Gerenciar campanhas',
  'leads.manage': 'Gerenciar prospecção', 'connections.manage': 'Gerenciar conexões',
  'revenue.view': 'Ver ILUX WEB Sentinela', 'settings.bot.manage': 'Configurar Robô IA',
  'settings.attendance.manage': 'Configurar atendimento', 'users.manage': 'Gerenciar usuários',
  'teams.manage': 'Gerenciar equipes', 'settings.company.manage': 'Configurar empresa',
  'quick_responses.manage': 'Gerenciar respostas rápidas', 'tags.manage': 'Gerenciar etiquetas',
  'settings.agent.manage': 'Configurar Agente Local', 'privacy.manage': 'Gerenciar privacidade e LGPD',
  'internal_chat.view': 'Usar chat interno', 'audit.view': 'Consultar auditoria do sistema', 'telemetry.view': 'Acompanhar telemetria operacional', 'telemetry.manage': 'Gerenciar decisões do Sentinela',
  'ai.assistant.query': 'Consultar o Assistente ILUX WEB',
};

export function permissionsForUser(user = {}) {
  const role = String(user.role || localStorage.getItem('role') || 'agent').toLowerCase();
  if (role === 'superadmin' || role === 'admin') return new Set(PERMISSION_KEYS);
  const explicit = user.permissions || user.accessPermissions;
  if (Array.isArray(explicit)) return new Set(explicit);
  if (explicit && typeof explicit === 'object') return new Set(Object.keys(explicit).filter((key) => explicit[key]));
  const profile = user.accessProfile || user.profile || role;
  return new Set((ACCESS_PROFILES[profile] || ACCESS_PROFILES.agent).permissions);
}
