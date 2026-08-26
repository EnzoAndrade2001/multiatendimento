import axios from 'axios';

// Em produção usa a URL do backend via variável de ambiente
// Em desenvolvimento usa proxy do Vite (/api → localhost:3002)
const DEFAULT_PRODUCTION_API_URL = 'https://api-crm.lcddigital.com.br';
const isProductionCrm =
  typeof window !== 'undefined' && window.location.hostname === 'crm.lcddigital.com.br';

export const BACKEND_URL = import.meta.env.VITE_API_URL || (isProductionCrm ? DEFAULT_PRODUCTION_API_URL : '');
const BASE_URL = BACKEND_URL ? `${BACKEND_URL}/api` : '/api';
const api = axios.create({ baseURL: BASE_URL });

export const getMediaUrl = (url) => {
  if (!url) return '';
  if (typeof url !== 'string') return '';
  // Se a URL contiver localhost (erro anterior), removemos para usar a BACKEND_URL correta
  const cleanUrl = url.replace('http://localhost:3002', '');
  if (cleanUrl.startsWith('http')) return cleanUrl;
  // Mídias de atendimento passaram a ser entregues por uma rota tenant-aware.
  // Como imagens/vídeos do navegador não enviam o header Bearer, o agente de
  // autenticação aceita o token somente nessa rota de compatibilidade.
  if (cleanUrl.startsWith('/uploads/media/')) {
    const filename = cleanUrl.slice('/uploads/media/'.length).split('?')[0];
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : '';
    const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${BACKEND_URL}/api/media/${encodeURIComponent(filename)}${suffix}`;
  }
  return `${BACKEND_URL}${cleanUrl}`;
};

// Dashboard

// Agendamento
export const getScheduledMessages = () => api.get('/scheduled-messages');
export const scheduleMessage = (data) => api.post('/scheduled-messages', data);
export const deleteScheduledMessage = (id) => api.delete(`/scheduled-messages/${id}`);

// Chat Interno
export const getInternalMessages = (receiverId) => api.get(`/internal-messages?receiverId=${receiverId}`);
export const getInternalConversations = () => api.get('/internal-messages/conversations');
export const sendInternalMessage = (data) => api.post('/internal-messages', data);
export const getInternalConversationMessages = (conversationKey, params = {}) => (
  api.get(`/internal-messages/conversations/${encodeURIComponent(conversationKey)}/messages`, { params })
);
export const updateInternalConversationRead = (conversationKey, data = {}) => (
  api.patch(`/internal-messages/conversations/${encodeURIComponent(conversationKey)}/read`, data)
);
export const updateInternalConversationPin = (conversationKey, pinned) => (
  api.patch(`/internal-messages/conversations/${encodeURIComponent(conversationKey)}/pin`, { pinned })
);
export const sendInternalConversationMessage = (data) => api.post('/internal-messages/messages', data);
export const sendInternalAttachment = (formData, onUploadProgress, signal) => api.post('/internal-messages/messages/attachment', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  onUploadProgress,
  signal,
});
export const getInternalMessageThread = (messageId) => api.get(`/internal-messages/messages/${messageId}/thread`);
export const addInternalMessageReaction = (messageId, emoji) => (
  api.post(`/internal-messages/messages/${messageId}/reactions`, { emoji })
);
export const removeInternalMessageReaction = (messageId, emoji) => (
  api.delete(`/internal-messages/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`)
);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auth
export const login = (email, password, slug) => api.post('/auth/login', { email, password, slug });
export const getMe = () => api.get('/auth/me');
export const updateProfile = (data) => api.patch('/auth/profile', data);
export const getTenantBySlug = (slug) => api.get(`/auth/tenant/${slug}`);
export const uploadFile = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// Settings
export const getSettings = () => api.get('/settings');
export const getAgentInfo = () => api.get('/settings/agent-info', {
  params: { _ts: Date.now() },
  headers: { 'Cache-Control': 'no-cache' },
});
export const downloadAgent = () => api.get('/settings/agent-download', { responseType: 'blob', timeout: 120000 });
export const saveSettings = (data) => api.post('/settings', data);
export const syncCompanyFromFirebird = () => api.post('/settings/company/sync');
export const getSystemPromptPreview = (systemPrompt) => api.post('/settings/system-prompt-preview', { systemPrompt });
export const getBusinessHours = () => api.get('/settings/business-hours');
export const saveBusinessHours = (data) => api.post('/settings/business-hours', data);
export const uploadLogo = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/settings/logo', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const testFirebirdConnection = () => api.post('/integrations/firebird/test');
export const syncFirebirdContacts = (data = {}) => api.post('/integrations/firebird/sync/contacts', data);

// Privacidade / LGPD
export const getPrivacyPolicy = () => api.get('/privacy/policy');
export const acceptPrivacyPolicy = (data) => api.post('/privacy/acceptance', data);
export const searchPrivacySubjects = (params) => api.get('/privacy/admin/subjects', { params });
export const exportPrivacySubject = (source, id) => api.get(`/privacy/admin/subjects/${encodeURIComponent(source)}/${encodeURIComponent(id)}/export`, { responseType: 'blob' });
export const anonymizePrivacySubject = (source, id, data) => api.post(`/privacy/admin/subjects/${encodeURIComponent(source)}/${encodeURIComponent(id)}/anonymize`, data);

// Instance
export const getInstances = () => api.get('/instance/list');
export const getInstanceQrCode = (id) => api.get(`/instance/qrcode/${id}`);
export const createInstance = (name) => api.post('/instance/create', { name });
export const repairInstance = (id) => api.post(`/instance/${id}/repair`);
export const deleteInstance = (id) => api.delete(`/instance/${id}`);

// Contacts
export const getContacts = (q, params = {}) => api.get('/contacts', { params: { ...params, ...(q ? { q } : {}) } });
export const createContact = (data) => api.post('/contacts', data);
export const getContactTags = () => api.get('/contacts/tags');
export const getContactHistory = (id) => api.get(`/contacts/${id}/history`);
export const updateContact = (id, data) => api.patch(`/contacts/${id}`, data);
export const linkContactToCrm = (id, crmCustomerId) => api.patch(`/contacts/${id}/link-crm`, { crmCustomerId });
export const getContactMedia = (id) => api.get(`/contacts/${id}/media`);
export const importContacts = (formData) => api.post('/contacts/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });

// Tickets
export const getTickets = (status, mine = false, filters = {}) => api.get('/tickets', { params: { status, mine, ...filters } });
export const getMessages = (ticketId, params = {}) => api.get(`/tickets/${ticketId}/messages`, { params });
export const sendMessage = (ticketId, body, quotedMsgId = null) => api.post(`/tickets/${ticketId}/messages`, { body, quotedMsgId });
export const deleteMessage = (ticketId, messageId) => api.delete(`/tickets/${ticketId}/messages/${messageId}`);
export const assignTicket = (ticketId, agentId, teamId) => api.patch(`/tickets/${ticketId}/assign`, { agentId, teamId });
export const resolveTicket = (ticketId) => api.patch(`/tickets/${ticketId}/resolve`);
export const createTicket = (contactId, instanceId) => api.post('/tickets', { contactId, instanceId });
export const summarizeTicket = (id) => api.post(`/tickets/${id}/summarize`);
export const createTicketNote = (ticketId, body) => api.post(`/tickets/${ticketId}/notes`, { body });
export const updateTicket = (id, data) => api.patch(`/tickets/${id}`, data);
export const updateTicketPreferences = (id, data) => api.patch(`/tickets/${id}/preferences`, data);
export const reopenTicket = (contactId, instanceId) => api.post('/tickets/reopen', { contactId, instanceId });
export const sendMediaMessage = (ticketId, file, caption = '', quotedMsgId = null) => {
  const form = new FormData();
  form.append('file', file);
  form.append('caption', caption);
  if (quotedMsgId) form.append('quotedMsgId', quotedMsgId);
  return api.post(`/tickets/${ticketId}/media`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const sendAudioMessage = (ticketId, blob, quotedMsgId = null) => {
  const form = new FormData();
  form.append('file', blob, 'recording.mp3');
  if (quotedMsgId) form.append('quotedMsgId', quotedMsgId);
  return api.post(`/tickets/${ticketId}/media`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const forwardMessage = (ticketId, messageId, contactId) => api.post(`/tickets/${ticketId}/forward`, { messageId, contactId });

// Users
export const getUsers = () => api.get('/users');
export const createUser = (data) => api.post('/users', data);
export const updateUser = (id, data) => api.patch(`/users/${id}`, data);
export const deleteUser = (id) => api.delete(`/users/${id}`);

// Teams
export const getTeams = () => api.get('/teams');
export const createTeam = (data) => api.post('/teams', data);
export const updateTeam = (id, data) => api.patch(`/teams/${id}`, data);
export const deleteTeam = (id) => api.delete(`/teams/${id}`);
export const addTeamMember = (teamId, userId) => api.post('/teams/members', { teamId, userId });
export const removeTeamMember = (teamId, userId) => api.delete(`/teams/members/${teamId}/${userId}`);

// Dashboard
export const getStats = () => api.get('/dashboard/stats');

// SuperAdmin
export const getTenants = () => api.get('/superadmin/tenants');
export const createTenant = (data) => api.post('/superadmin/tenants', data);
export const updateTenant = (id, data) => api.patch(`/superadmin/tenants/${id}`, data);

// Quick Responses
export const getQuickResponses = () => api.get('/quick-responses');
// Registra o uso sem bloquear o envio caso a instalação ainda não tenha essa rota.
export const useQuickResponse = (id) => api.post(`/quick-responses/${encodeURIComponent(id)}/use`);
export const createQuickResponse = (data) => api.post('/quick-responses', data);
export const updateQuickResponse = (id, data) => api.patch(`/quick-responses/${encodeURIComponent(id)}`, data);
export const deleteQuickResponse = (id) => api.delete(`/quick-responses/${id}`);

// Knowledge Base
export const getKnowledge = () => api.get('/knowledge');
export const getKnowledgeStats = () => api.get('/knowledge/stats');
export const testKnowledgeSearch = (query) => api.post('/knowledge/test', { query });
export const reindexKnowledge = () => api.post('/knowledge/reindex');
export const createKnowledge = (data) => api.post('/knowledge', data);
export const updateKnowledge = (id, data) => api.put(`/knowledge/${id}`, data);
export const deleteKnowledge = (id) => api.delete(`/knowledge/${id}`);
export const getKnowledgeDocuments = () => api.get('/knowledge/documents');
export const getKnowledgeDocument = (id) => api.get(`/knowledge/documents/${id}`);
export const uploadKnowledgeDocument = (formData, onUploadProgress) => api.post('/knowledge/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress });
export const updateKnowledgeDocument = (id, data) => api.patch(`/knowledge/documents/${id}`, data);
export const publishKnowledgeDocument = (id) => api.post(`/knowledge/documents/${id}/publish`);
export const unpublishKnowledgeDocument = (id) => api.post(`/knowledge/documents/${id}/unpublish`);
export const reprocessKnowledgeDocument = (id) => api.post(`/knowledge/documents/${id}/process`);
export const deleteKnowledgeDocument = (id) => api.delete(`/knowledge/documents/${id}`);
export const downloadKnowledgeDocument = (id) => api.get(`/knowledge/documents/${id}/download`, { responseType: 'blob' });

// Campaigns
export const sendCampaign = (data) => api.post('/campaigns/send', data);
// Campanhas persistentes (compatíveis com o worker do agente local)
export const getCampaigns = (params = {}) => api.get('/campaigns', { params });
export const getCampaign = (id) => api.get(`/campaigns/${encodeURIComponent(id)}`);
export const previewCampaign = (data) => api.post('/campaigns/preview', data);
export const createCampaign = (data) => api.post('/campaigns', data);
export const startCampaign = (id) => api.post(`/campaigns/${encodeURIComponent(id)}/start`);
export const pauseCampaign = (id) => api.post(`/campaigns/${encodeURIComponent(id)}/pause`);
export const resumeCampaign = (id) => api.post(`/campaigns/${encodeURIComponent(id)}/resume`);
export const cancelCampaign = (id) => api.post(`/campaigns/${encodeURIComponent(id)}/cancel`);
export const retryCampaign = (id) => api.post(`/campaigns/${encodeURIComponent(id)}/retry`);
export const exportCampaign = (id) => api.get(`/campaigns/${encodeURIComponent(id)}/export`, { responseType: 'blob' });
export const sendCampaignTest = (data) => api.post('/campaigns/test', data);
export const getCampaignTemplates = () => api.get('/campaigns/templates');
export const createCampaignTemplate = (data) => api.post('/campaigns/templates', data);
// Lista restrita às instâncias do tenant para seleção segura no disparo em massa.
export const getCampaignInstances = () => api.get('/campaigns/instances');

// Tags
export const getTags = () => api.get('/tags');
export const createTag = (data) => api.post('/tags', data);
export const updateTag = (id, data) => api.patch(`/tags/${id}`, data);
export const deleteTag = (id) => api.delete(`/tags/${id}`);

// Dashboard
export const getDashboardStats = (days) => api.get('/dashboard/stats', { params: days ? { days } : undefined });
export const getRevenueStats = () => api.get('/revenue/stats');
export const getRevenueBenchmark = (days) => api.get('/revenue/benchmark', { params: days ? { days } : undefined });
export const getRevenueDetective = () => api.get('/revenue/detective');
export const getRevenueDrilldown = (type) => api.get(`/revenue/drilldown/${type}`);
export const getAuditedTickets = () => api.get('/revenue/audit');
export const auditTicket = (ticketId) => api.post(`/revenue/audit/${ticketId}`);

// OS & Equipments
export const getEquipments = (contactId) => api.get(`/os/contacts/${contactId}/equipments`);
export const updateEquipment = (id, data) => api.patch(`/os/equipments/${id}`, data);
export const deleteEquipment = (id) => api.delete(`/os/equipments/${id}`);
export const createOS = (data) => api.post('/os', data);
export const getOSList = (filters) => api.get('/os', { params: filters });
export const sendOSManagerCopy = (id) => api.post(`/os/${id}/send-manager-copy`);

// Leads / Prospecção
export const searchLeads = (data) => api.post('/leads/search', data);
export const getLeads = (params) => api.get('/leads', { params });
export const getLeadInstances = () => api.get('/leads/instances');
export const getLeadCampaigns = (params = {}) => api.get('/leads/campaigns', { params });
export const convertLead = (id, data = {}) => api.post(`/leads/${encodeURIComponent(id)}/convert`, data);
export const uploadLeadFile = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/leads/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const createManualLeads = (data) => api.post('/leads/manual', data);
export const deleteLead = (id) => api.delete(`/leads/${id}`);
export const deleteAllLeads = () => api.delete('/leads/all');
export const sendToLeads = (data) => api.post('/leads/send', data);

export const deleteContact = (id) => api.delete(`/contacts/${id}`);

// CRM Firebird
export const getCrmSummary = () => api.get('/crm/summary');
export const getCrmCustomers = (params = {}) => api.get('/crm/customers', { params });
export const getCrmCustomer = (id) => api.get(`/crm/customers/${id}`, { timeout: 10000 });
export const getCrmCustomerContracts = (id) => api.get(`/crm/customers/${id}/contracts`, { timeout: 15000 });
export const getCrmCustomerServiceOrders = (id, options = 25) => {
  const params = typeof options === 'number' ? { limit: options } : options;
  return api.get(`/crm/customers/${id}/service-orders`, { params, timeout: 15000 });
};
export const getCrmCustomer360 = (id) => api.get(`/crm/customers/${id}/360`, { timeout: 20000 });
export const getCrmReceivableBoleto = (customerId, receivableId) => api.post(
  `/crm/customers/${customerId}/receivables/${receivableId}/boleto`,
  {},
  { timeout: 60000 },
);
export const getCrmReceivableDocuments = (customerId, receivableId, ticketId = null) => api.get(
  `/crm/customers/${customerId}/receivables/${receivableId}/documents`,
  { params: ticketId ? { ticketId } : {}, timeout: 20000 },
);
export const prepareCrmReceivableDocument = (customerId, receivableId, documentType) => api.post(
  `/crm/customers/${customerId}/receivables/${receivableId}/documents/${documentType}`,
  {},
  { timeout: 120000 },
);
export const sendCrmReceivableDocuments = (customerId, receivableId, data) => api.post(
  `/crm/customers/${customerId}/receivables/${receivableId}/documents/send`,
  data,
  { timeout: 300000 },
);
export const getCrmEquipments = (params = {}) => api.get('/crm/equipments', { params });
export const getCrmFlaggedDocuments = () => api.get('/crm/financial/flagged-documents', { timeout: 15000 });

// Billing Integration (Automação de Cobranças)
export const getBillingLogs = () => api.get('/integrations/firebird/billing-logs');
export const getBillingReports = (params = {}, config = {}) => {
  const query = typeof params === 'number' ? { period: params } : params;
  return api.get('/integrations/firebird/billing-reports', {
    timeout: 45000,
    ...config,
    params: query,
  });
};
export const triggerBillingProcess = () => api.post('/integrations/firebird/trigger-billing-process');
export default api;
