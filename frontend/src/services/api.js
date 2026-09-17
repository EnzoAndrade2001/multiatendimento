import axios from 'axios';

// Em produção usa a URL do backend via variável de ambiente
// Em desenvolvimento usa proxy do Vite (/api → localhost:3002)
const DEFAULT_PRODUCTION_API_URL = 'https://api-crm.lcddigital.com.br';
const isProductionCrm =
  typeof window !== 'undefined' && window.location.hostname === 'crm.lcddigital.com.br';

export const BACKEND_URL = import.meta.env.VITE_API_URL || (isProductionCrm ? DEFAULT_PRODUCTION_API_URL : '');
const BASE_URL = BACKEND_URL ? `${BACKEND_URL}/api` : '/api';
const api = axios.create({ baseURL: BASE_URL });

export const LCD_API_URL = import.meta.env.VITE_LCD_API_URL || 'http://localhost:3001/api';
const lcdApi = axios.create({ baseURL: LCD_API_URL });

export const getMediaUrl = (url) => {
  if (!url) return '';
  if (typeof url !== 'string') return '';
  // Se a URL contiver localhost (erro anterior), removemos para usar a BACKEND_URL correta
  const cleanUrl = url.replace('http://localhost:3002', '');
  if (cleanUrl.startsWith('http')) return cleanUrl;
  return `${BACKEND_URL}${cleanUrl}`;
};

// Dashboard

// Agendamento
export const getScheduledMessages = () => api.get('/scheduled-messages');
export const scheduleMessage = (data) => api.post('/scheduled-messages', data);
export const deleteScheduledMessage = (id) => api.delete(`/scheduled-messages/${id}`);

// Chat Interno
export const getInternalMessages = (receiverId) => api.get(`/internal-messages?receiverId=${receiverId}`);
export const sendInternalMessage = (data) => api.post('/internal-messages', data);

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
export const saveSettings = (data) => api.post('/settings', data);
export const getBusinessHours = () => api.get('/settings/business-hours');
export const saveBusinessHours = (data) => api.post('/settings/business-hours', data);
export const uploadLogo = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post('/settings/logo', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const testFirebirdConnection = () => api.post('/integrations/firebird/test');
export const syncFirebirdContacts = (data = {}) => api.post('/integrations/firebird/sync/contacts', data);

// Instance
export const getInstances = () => api.get('/instance/list');
export const getInstanceQrCode = (id) => api.get(`/instance/qrcode/${id}`);
export const createInstance = (name) => api.post('/instance/create', { name });
export const deleteInstance = (id) => api.delete(`/instance/${id}`);

// Contacts
export const getContacts = (q, params = {}) => api.get('/contacts', { params: { ...params, ...(q ? { q } : {}) } });
export const createContact = (data) => api.post('/contacts', data);
export const getContactTags = () => api.get('/contacts/tags');
export const getContactHistory = (id) => api.get(`/contacts/${id}/history`);
export const updateContact = (id, data) => api.patch(`/contacts/${id}`, data);
export const getContactMedia = (id) => api.get(`/contacts/${id}/media`);
export const importContacts = (formData) => api.post('/contacts/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });

// Tickets
export const getTickets = (status, mine = false, filters = {}) => api.get('/tickets', { params: { status, mine, ...filters } });
export const getMessages = (ticketId, params = {}) => api.get(`/tickets/${ticketId}/messages`, { params });
export const sendMessage = (ticketId, body, quotedMsgId = null) => api.post(`/tickets/${ticketId}/messages`, { body, quotedMsgId });
export const deleteMessage = (ticketId, messageId) => api.delete(`/tickets/${ticketId}/messages/${messageId}`);
export const assignTicket = (ticketId, agentId, teamId) => api.patch(`/tickets/${ticketId}/assign`, { agentId, teamId });
export const resolveTicket = (ticketId) => api.patch(`/tickets/${ticketId}/resolve`);
export const createTicket = (contactId) => api.post('/tickets', { contactId });
export const summarizeTicket = (id) => api.post(`/tickets/${id}/summarize`);
export const reopenTicket = (contactId) => api.post('/tickets/reopen', { contactId });
export const updateTicket = (id, data) => api.patch(`/tickets/${id}`, data);
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
export const createQuickResponse = (data) => api.post('/quick-responses', data);
export const deleteQuickResponse = (id) => api.delete(`/quick-responses/${id}`);

// Knowledge Base
export const getKnowledge = () => api.get('/knowledge');
export const createKnowledge = (data) => api.post('/knowledge', data);
export const updateKnowledge = (id, data) => api.put(`/knowledge/${id}`, data);
export const deleteKnowledge = (id) => api.delete(`/knowledge/${id}`);

// Campaigns
export const sendCampaign = (data) => api.post('/campaigns/send', data);

// Tags
export const getTags = () => api.get('/tags');
export const createTag = (data) => api.post('/tags', data);
export const updateTag = (id, data) => api.patch(`/tags/${id}`, data);
export const deleteTag = (id) => api.delete(`/tags/${id}`);

// Dashboard
export const getDashboardStats = () => api.get('/dashboard/stats');
export const getRevenueStats = () => api.get('/revenue/stats');
export const getRevenueBenchmark = () => api.get('/revenue/benchmark');
export const getRevenueDetective = () => api.get('/revenue/detective');
export const getAuditedTickets = () => api.get('/revenue/audit');
export const auditTicket = (ticketId) => api.post(`/revenue/audit/${ticketId}`);

// OS & Equipments
export const getEquipments = (contactId) => api.get(`/os/contacts/${contactId}/equipments`);
export const updateEquipment = (id, data) => api.patch(`/os/equipments/${id}`, data);
export const deleteEquipment = (id) => api.delete(`/os/equipments/${id}`);
export const createOS = (data) => api.post('/os', data);
export const getOSList = (filters) => api.get('/os', { params: filters });

// Leads / Prospecção
export const searchLeads = (data) => api.post('/leads/search', data);
export const getLeads = (params) => api.get('/leads', { params });
export const deleteLead = (id) => api.delete(`/leads/${id}`);
export const deleteAllLeads = () => api.delete('/leads/all');
export const sendToLeads = (data) => api.post('/leads/send', data);

export const deleteContact = (id) => api.delete(`/contacts/${id}`);

// CRM Firebird
export const getCrmSummary = () => api.get('/crm/summary');
export const getCrmCustomers = (params = {}) => api.get('/crm/customers', { params });
export const getCrmCustomer = (id) => lcdApi.get(`/clientes/${id}/360`); // Usando o LCDDIGITALWEB
export const getCrmEquipments = (params = {}) => api.get('/crm/equipments', { params });

export default api;
