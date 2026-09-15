const prisma = require('../lib/prisma');
const evolutionService = require('./evolutionService');
const { recordPrivacyAuditRaw } = require('./privacyAuditService');

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

function isOfficialInstance(instance) {
  return instance?.provider === 'evolution_official';
}

function templateRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.templates)) return payload.templates;
  if (Array.isArray(payload?.messageTemplates)) return payload.messageTemplates;
  return [];
}

function countBodyVariables(components = []) {
  const body = components.find((component) => String(component?.type || '').toUpperCase() === 'BODY');
  const indexes = [...String(body?.text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return indexes.length ? Math.max(...indexes) : 0;
}

function normalizeTemplate(template) {
  const components = Array.isArray(template?.components) ? template.components : [];
  return {
    id: String(template?.id || ''),
    name: String(template?.name || ''),
    language: String(template?.language || template?.languageCode || 'pt_BR'),
    category: String(template?.category || 'UTILITY').toUpperCase(),
    status: String(template?.status || '').toUpperCase(),
    components,
    variableCount: countBodyVariables(components),
  };
}

async function getSettings(tenantId, waInstance) {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  const { evolutionUrl, evolutionKey } = evolutionService.resolveEvolutionConfig(settings, waInstance);
  if (!evolutionUrl || !evolutionKey) throw Object.assign(new Error('Evolution API não configurada.'), { status: 400 });
  return { evolutionUrl, evolutionKey };
}

async function requireInstance(tenantId, instanceId) {
  if (!instanceId) {
    throw Object.assign(new Error('Selecione a instância de saída antes de enviar.'), {
      status: 400,
      code: 'INSTANCE_REQUIRED',
    });
  }
  const instance = await prisma.waInstance.findFirst({ where: { id: instanceId, tenantId } });
  if (!instance || instance.instanceName.startsWith('DELETED_')) {
    throw Object.assign(new Error('A instância selecionada não foi encontrada.'), { status: 404, code: 'INSTANCE_NOT_FOUND' });
  }
  return instance;
}

async function getLastInboundAt({ tenantId, contactId, instanceId }) {
  const message = await prisma.message.findFirst({
    where: {
      fromMe: false,
      ticket: { tenantId, contactId, instanceId },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return message?.createdAt || null;
}

async function getWindow({ tenantId, contactId, instance }) {
  if (!isOfficialInstance(instance)) {
    return { required: false, open: true, lastInboundAt: null, expiresAt: null };
  }
  const lastInboundAt = await getLastInboundAt({ tenantId, contactId, instanceId: instance.id });
  const expiresAt = lastInboundAt ? new Date(lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS) : null;
  return {
    required: true,
    open: Boolean(expiresAt && expiresAt.getTime() > Date.now()),
    lastInboundAt,
    expiresAt,
  };
}

const OPT_OUT_PATTERNS = [
  /^(sair|parar|pare|para|cancelar|cancela|descadastrar|desinscrever|remover|stop|unsubscribe|quit)[.!]*$/i,
  /^n[ãa]o\s+quero(\s+mais)?(\s+receber)?(\s+(mensagens?|nada|contato))?[.!]*$/i,
  /^me\s+(tira|remova|remove|descadastr\w*)/i,
];

// Reconhece pedidos de descadastramento vindos do cliente. Curto e específico
// para não confundir com uma frase que apenas contém "parar".
function isOptOutMessage(text) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value || value.length > 40) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(value));
}

async function getContactOptOut({ tenantId, contactId }) {
  if (!contactId) return null;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { whatsappOptOutAt: true },
  });
  return contact?.whatsappOptOutAt || null;
}

async function registerOptOut({ tenantId, contactId, actorId = null, via = 'inbound_keyword' }) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) return null;
  if (contact.whatsappOptOutAt) return contact;
  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: {
      whatsappOptOutAt: new Date(),
      enableWhatsAppMarketing: false,
      enableWhatsAppAlerts: false,
      enableWhatsAppCounters: false,
      enableWhatsAppBilling: false,
    },
  });
  await recordPrivacyAuditRaw({
    tenantId,
    actorId,
    action: 'WHATSAPP_OPT_OUT',
    resourceType: 'contact',
    resourceId: contactId,
    metadata: { via, channel: 'whatsapp' },
  });
  return updated;
}

async function reactivateConsent({ tenantId, contactId, actorId = null, purposes = {} }) {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) return null;
  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: {
      whatsappOptOutAt: null,
      ...(typeof purposes.billing === 'boolean' ? { enableWhatsAppBilling: purposes.billing } : {}),
      ...(typeof purposes.marketing === 'boolean' ? { enableWhatsAppMarketing: purposes.marketing } : {}),
      ...(typeof purposes.alerts === 'boolean' ? { enableWhatsAppAlerts: purposes.alerts } : {}),
      ...(typeof purposes.counters === 'boolean' ? { enableWhatsAppCounters: purposes.counters } : {}),
    },
  });
  await recordPrivacyAuditRaw({
    tenantId,
    actorId,
    action: 'WHATSAPP_CONSENT_REACTIVATED',
    resourceType: 'contact',
    resourceId: contactId,
    metadata: { purposes, previousOptOutAt: contact.whatsappOptOutAt },
  });
  return updated;
}

// Porta única para envios automáticos (bot, campanhas, agendamentos, avisos).
// QR sem opt-out passa direto; instância oficial respeita a janela de 24 horas.
async function assertAutomatedSendAllowed({ tenantId, contactId, instance }) {
  if (await getContactOptOut({ tenantId, contactId })) {
    throw Object.assign(new Error('Contato solicitou não receber mensagens (opt-out).'), {
      status: 409,
      code: 'CONTACT_OPTED_OUT',
    });
  }
  const window = await getWindow({ tenantId, contactId, instance });
  if (window.required && !window.open) {
    throw Object.assign(new Error('Janela oficial de 24 horas encerrada; automações não enviam texto livre.'), {
      status: 409,
      code: 'OFFICIAL_WINDOW_CLOSED',
      window,
    });
  }
  return { window };
}

async function canAutomatedSend(args) {
  try {
    const { window } = await assertAutomatedSendAllowed(args);
    return { allowed: true, window };
  } catch (err) {
    return { allowed: false, code: err.code || 'BLOCKED', reason: err.message, window: err.window || null };
  }
}

async function listApprovedTemplates({ tenantId, instance }) {
  if (!isOfficialInstance(instance)) return [];
  const { evolutionUrl, evolutionKey } = await getSettings(tenantId, instance);
  const raw = await evolutionService.findTemplates(evolutionUrl, evolutionKey, instance.instanceName);
  return templateRows(raw)
    .map(normalizeTemplate)
    .filter((template) => template.name && template.status === 'APPROVED');
}

function renderTemplate(template, values = []) {
  const body = template.components.find((component) => String(component?.type || '').toUpperCase() === 'BODY');
  return String(body?.text || template.name).replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, index) => {
    return String(values[Number(index) - 1] ?? '').trim();
  });
}

async function getOutboundOptions({ tenantId, ticketId, instanceId }) {
  const ticket = await prisma.ticket.findFirst({
    where: { id: ticketId, tenantId },
    select: { id: true, contactId: true },
  });
  if (!ticket) throw Object.assign(new Error('Ticket não encontrado.'), { status: 404 });
  const instance = await requireInstance(tenantId, instanceId);
  const window = await getWindow({ tenantId, contactId: ticket.contactId, instance });
  const templates = window.required && !window.open
    ? await listApprovedTemplates({ tenantId, instance })
    : [];
  const optedOut = Boolean(await getContactOptOut({ tenantId, contactId: ticket.contactId }));
  return {
    instance: { id: instance.id, instanceName: instance.instanceName, phone: instance.phone, provider: instance.provider, status: instance.status },
    mode: isOfficialInstance(instance) ? 'official' : 'qr',
    window,
    templates,
    optedOut,
  };
}

async function authorizeOutbound({ tenantId, ticket, instanceId, templateSelection, media = false }) {
  const instance = await requireInstance(tenantId, instanceId);
  const window = await getWindow({ tenantId, contactId: ticket.contactId, instance });
  const optedOut = Boolean(await getContactOptOut({ tenantId, contactId: ticket.contactId }));
  if (optedOut && isOfficialInstance(instance) && !window.open) {
    throw Object.assign(new Error('Este contato solicitou não receber mensagens (opt-out). Não é possível reabrir a conversa por template.'), {
      status: 409,
      code: 'CONTACT_OPTED_OUT',
      window,
    });
  }
  if (!isOfficialInstance(instance) || window.open) {
    return { instance, window, optedOut, mode: 'freeform', template: null, templateValues: [], renderedBody: null };
  }
  if (media) {
    throw Object.assign(new Error('A janela oficial de 24 horas está encerrada. Para enviar arquivo, use um template oficial com mídia aprovado pela Meta.'), {
      status: 409,
      code: 'OFFICIAL_MEDIA_TEMPLATE_REQUIRED',
      window,
    });
  }
  const requestedName = String(templateSelection?.name || '').trim();
  const requestedLanguage = String(templateSelection?.language || '').trim();
  if (!requestedName) {
    throw Object.assign(new Error('A janela oficial de 24 horas está encerrada. Selecione um template aprovado pela Meta.'), {
      status: 409,
      code: 'OFFICIAL_TEMPLATE_REQUIRED',
      window,
    });
  }
  const templates = await listApprovedTemplates({ tenantId, instance });
  const template = templates.find((item) => item.name === requestedName && (!requestedLanguage || item.language === requestedLanguage));
  if (!template) {
    throw Object.assign(new Error('O template selecionado não está aprovado ou não pertence a esta instância.'), {
      status: 409,
      code: 'OFFICIAL_TEMPLATE_NOT_APPROVED',
      window,
    });
  }
  const values = Array.isArray(templateSelection?.values)
    ? templateSelection.values.map((value) => String(value ?? '').trim())
    : [];
  if (values.length < template.variableCount || values.slice(0, template.variableCount).some((value) => !value)) {
    throw Object.assign(new Error(`Preencha as ${template.variableCount} variável(is) obrigatória(s) do template.`), {
      status: 422,
      code: 'OFFICIAL_TEMPLATE_VARIABLES_REQUIRED',
    });
  }
  return {
    instance,
    window,
    optedOut,
    mode: 'template',
    template,
    templateValues: values.slice(0, template.variableCount),
    renderedBody: renderTemplate(template, values),
  };
}

module.exports = {
  CUSTOMER_SERVICE_WINDOW_MS,
  authorizeOutbound,
  getOutboundOptions,
  isOfficialInstance,
  isOptOutMessage,
  getContactOptOut,
  registerOptOut,
  reactivateConsent,
  assertAutomatedSendAllowed,
  canAutomatedSend,
  listApprovedTemplates,
  normalizeTemplate,
  renderTemplate,
};
