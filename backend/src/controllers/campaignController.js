const prisma = require('../lib/prisma');
const evolutionService = require('../services/evolutionService');
const campaignProcessor = require('../services/campaignProcessor');
const { buildCounterAudience } = require('../services/counterCampaignService');
const path = require('path');

let io;
function setIo(socketIo) {
  io = socketIo;
  campaignProcessor.setIo(socketIo);
}

const CATEGORIES = new Set(['MARKETING', 'ALERT', 'COUNTER', 'BILLING']);
const CONSENT_FIELDS = {
  MARKETING: 'enableWhatsAppMarketing',
  ALERT: 'enableWhatsAppAlerts',
  COUNTER: 'enableWhatsAppCounters',
  BILLING: 'enableWhatsAppBilling',
};
const VALID_STATUSES = new Set(['DRAFT', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED']);

function parseTags(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function normalizeCategory(value) {
  const category = String(value || 'MARKETING').trim().toUpperCase();
  return CATEGORIES.has(category) ? category : 'MARKETING';
}

function renderTemplate(template, contact, extra = {}) {
  const values = {
    nome: contact.name || contact.fantasyName || 'Cliente',
    cliente: contact.name || contact.fantasyName || 'Cliente',
    telefone: contact.phone || '',
    cpf: contact.cpfCnpj || '',
    cnpj: contact.cpfCnpj || '',
    cidade: contact.city || '',
    ...extra,
  };
  return String(template || '').replace(/\[([a-zA-ZÀ-ÿ0-9_]+)\]|\{\{\s*([a-zA-ZÀ-ÿ0-9_]+)\s*\}\}/g, (_match, bracket, moustache) => {
    const key = String(bracket || moustache || '').toLowerCase();
    return values[key] == null ? '' : String(values[key]);
  });
}

function validPhone(phone) {
  if (String(phone || '').toLowerCase().endsWith('@g.us')) return String(phone).toLowerCase();
  const normalized = evolutionService.normalizePhoneNumber(phone);
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? normalized : '';
}

function normalizeCampaignMedia(value) {
  if (!value) return null;
  const mediaUrl = String(value).trim();
  // Campanhas sÃ³ podem usar arquivos que jÃ¡ passaram pelo upload autenticado.
  if (!mediaUrl.startsWith('/uploads/')) throw Object.assign(new Error('Anexo invÃ¡lido para campanha.'), { status: 400 });
  const filename = path.basename(mediaUrl.split('?')[0]);
  if (!filename || filename === '.' || filename === '..') throw Object.assign(new Error('Anexo invÃ¡lido para campanha.'), { status: 400 });
  return `/uploads/${filename}`;
}

function isQuietHours(date, start = '20:00', end = '08:00') {
  const hour = date.getHours() + date.getMinutes() / 60;
  const parse = (value, fallback) => {
    const [h, m] = String(value || fallback).split(':').map(Number);
    return Number.isFinite(h) ? h + (Number.isFinite(m) ? m : 0) / 60 : fallback;
  };
  const from = parse(start, 20);
  const to = parse(end, 8);
  if (from === to) return false;
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

async function getInstance(tenantId, instanceId, { requireConnected = false } = {}) {
  if (!instanceId) return null;
  const instance = await prisma.waInstance.findFirst({
    where: { id: instanceId, tenantId, instanceName: { not: { startsWith: 'DELETED_' } } },
  });
  if (!instance) throw Object.assign(new Error('Instância de saída não encontrada para este tenant.'), { status: 400 });
  if (requireConnected && !['connected', 'CONNECTED', 'open', 'OPEN'].includes(String(instance.status))) {
    throw Object.assign(new Error('A instância selecionada não está conectada ao WhatsApp.'), { status: 409 });
  }
  return instance;
}

async function loadAudience({ tenantId, tag, contactIds, category = 'MARKETING', message = '', counter = false, requireConsent = true }) {
  const where = { tenantId };
  if (Array.isArray(contactIds) && contactIds.length) where.id = { in: [...new Set(contactIds.filter(Boolean))] };
  const contacts = await prisma.contact.findMany({
    where,
    select: {
      id: true, tenantId: true, instanceId: true, phone: true, whatsapp: true, name: true, fantasyName: true,
      cpfCnpj: true, city: true, tags: true,
      enableWhatsAppBilling: true, enableWhatsAppMarketing: true, enableWhatsAppAlerts: true, enableWhatsAppCounters: true, whatsappOptOutAt: true,
      equipments: { select: { id: true, externalId: true, manufacturer: true, model: true, serialNumber: true, sector: true, address: true, isActive: true }, take: 20 },
    },
    orderBy: { name: 'asc' },
  });
  const normalizedTag = String(tag || '').trim().toLowerCase();
  const taggedContacts = normalizedTag
    ? contacts.filter((contact) => parseTags(contact.tags).some((item) => item.toLowerCase() === normalizedTag))
    : contacts;
  const noTag = contacts.length - taggedContacts.length;
  const hasContactSelection = Array.isArray(contactIds) && contactIds.length > 0;
  const authorizedBySelection = Boolean(normalizedTag) || hasContactSelection;
  if (normalizeCategory(category) === 'COUNTER') {
    // Uma tag ou uma seleção manual representa a autorização operacional do
    // disparo. O opt-out global continua bloqueando o contato.
    const counter = buildCounterAudience(taggedContacts, {
      template: message,
      requireOptIn: requireConsent && !authorizedBySelection,
      excludeOptOut: true,
    });
    const skipCounts = counter.skipped.reduce((acc, item) => {
      if (item.reason === 'invalid_phone') acc.invalidPhone++;
      else if (item.reason === 'duplicate_phone') acc.duplicate++;
      else if (item.reason === 'counter_opt_in_required') acc.noConsent++;
      else if (item.reason === 'whatsapp_opt_out') acc.optOut++;
      else acc.noEquipment++;
      return acc;
    }, { invalidPhone: 0, duplicate: 0, noConsent: 0, noEquipment: 0, optOut: 0 });
    return {
      rows: [
        ...counter.recipients.map((item) => {
          const contact = taggedContacts.find((candidate) => candidate.id === item.contactId);
          return { contact, phone: item.phone, status: 'PENDING', renderedMessage: item.renderedMessage, counterData: { ...item.variables, equipmentIds: item.equipmentIds } };
        }),
        ...counter.skipped.map((item) => ({ contact: taggedContacts.find((candidate) => candidate.id === item.contactId), phone: item.phone || '', status: 'SKIPPED', reason: item.reason })),
      ],
      exclusions: { noTag, duplicate: skipCounts.duplicate, invalidPhone: skipCounts.invalidPhone, noConsent: skipCounts.noConsent, noEquipment: skipCounts.noEquipment, optOut: skipCounts.optOut },
    };
  }
  const consentField = CONSENT_FIELDS[normalizeCategory(category)];
  const seen = new Set();
  const rows = [];
  const exclusions = { noTag: 0, duplicate: 0, invalidPhone: 0, noConsent: 0, optOut: 0 };
  for (const contact of contacts) {
    if (normalizedTag && !parseTags(contact.tags).some((item) => item.toLowerCase() === normalizedTag)) {
      exclusions.noTag++;
      continue;
    }
    const phone = validPhone(contact.whatsapp || contact.phone);
    if (!phone) {
      exclusions.invalidPhone++;
      rows.push({ contact, phone: '', status: 'SKIPPED', reason: 'Telefone inválido ou ausente' });
      continue;
    }
    if (seen.has(phone)) {
      exclusions.duplicate++;
      rows.push({ contact, phone, status: 'SKIPPED', reason: 'Telefone duplicado na seleção' });
      continue;
    }
    seen.add(phone);
    if (contact.whatsappOptOutAt) {
      exclusions.optOut++;
      rows.push({ contact, phone, status: 'SKIPPED', reason: 'Contato solicitou não receber mensagens' });
      continue;
    }
    if (requireConsent && !authorizedBySelection && consentField && !contact[consentField]) {
      exclusions.noConsent++;
      rows.push({ contact, phone, status: 'SKIPPED', reason: `Sem aceite para ${normalizeCategory(category).toLowerCase()}` });
      continue;
    }
    let extra = {};
    if (counter || normalizeCategory(category) === 'COUNTER') {
      const equipment = contact.equipments?.[0];
      extra = {
        equipamento: equipment?.model || equipment?.manufacturer || 'equipamento',
        serie: equipment?.serialNumber || '',
        setor: equipment?.sector || '',
      };
    }
    rows.push({ contact, phone, status: 'PENDING', renderedMessage: renderTemplate(message, contact, extra), counterData: extra });
  }
  return { rows, exclusions };
}

function summaryFromRows(rows) {
  return rows.reduce((summary, row) => {
    const key = String(row.status || 'PENDING').toLowerCase();
    summary.total++;
    if (key === 'pending') summary.pending++;
    else if (key === 'sent' || key === 'delivered') summary.sent++;
    else if (key === 'failed') summary.failed++;
    else if (key === 'skipped') summary.skipped++;
    else if (key === 'cancelled') summary.cancelled++;
    return summary;
  }, { total: 0, pending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0 });
}

async function preview(req, res) {
  try {
    if (!req.body.tag && !(Array.isArray(req.body.contactIds) && req.body.contactIds.length)) {
      return res.status(400).json({ error: 'Selecione uma tag ou pelo menos um contato.' });
    }
    const category = normalizeCategory(req.body.category);
    const { rows, exclusions } = await loadAudience({ ...req.body, tenantId: req.user.tenantId, category, message: req.body.message || '', counter: category === 'COUNTER' });
    const summary = summaryFromRows(rows);
    res.json({ category, summary, exclusions, recipients: rows.slice(0, 500).map((row) => ({
      contactId: row.contact.id, name: row.contact.name || row.contact.fantasyName, phone: row.phone,
      status: row.status, reason: row.reason, preview: row.renderedMessage,
    })) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Não foi possível gerar a prévia.' });
  }
}

async function listInstances(req, res) {
  const instances = await prisma.waInstance.findMany({
    where: { tenantId: req.user.tenantId, instanceName: { not: { startsWith: 'DELETED_' } } },
    select: { id: true, instanceName: true, phone: true, status: true },
    orderBy: { instanceName: 'asc' },
  });
  res.json(instances);
}

async function create(req, res) {
  try {
    const { tenantId, userId } = req.user;
    if (!req.body.tag && !(Array.isArray(req.body.contactIds) && req.body.contactIds.length)) {
      return res.status(400).json({ error: 'Selecione uma tag ou pelo menos um contato.' });
    }
    const category = normalizeCategory(req.body.category);
    const message = String(req.body.message || (category === 'COUNTER'
      ? 'Ola [nome], por favor envie os contadores dos equipamentos abaixo:\n[equipamentos]'
      : '')).trim();
    if (!message) return res.status(400).json({ error: 'Mensagem obrigatória.' });
    if (message.length > 2000) return res.status(400).json({ error: 'A mensagem deve ter no mÃ¡ximo 2.000 caracteres.' });
    const instance = await getInstance(tenantId, req.body.instanceId, { requireConnected: false });
    if (!instance) return res.status(400).json({ error: 'Selecione a instância/número de saída.' });
    const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Data de agendamento inválida.' });
    const { rows } = await loadAudience({ ...req.body, tenantId, category, message, counter: category === 'COUNTER', requireConsent: req.body.legacy !== true });
    if (!rows.some((row) => row.status === 'PENDING')) return res.status(422).json({ error: 'Nenhum contato elegÃ­vel para a campanha. Confira o consentimento e os telefones na prÃ©via.' });
    const delaySeconds = Math.max(1, Math.min(3600, Number(req.body.delaySeconds ?? req.body.delay ?? 5) || 5));
    const mediaUrl = normalizeCampaignMedia(req.body.mediaUrl);
    const status = scheduledAt && scheduledAt > new Date() ? 'QUEUED' : 'DRAFT';
    const campaign = await prisma.campaign.create({
      data: {
        tenantId, createdById: userId, instanceId: instance.id, name: String(req.body.name || 'Nova campanha').slice(0, 120),
        category, message, status, delaySeconds, scheduledAt, mediaUrl,
        mediaType: mediaUrl ? String(req.body.mediaType || 'document').slice(0, 32) : null,
        mediaMimeType: mediaUrl ? String(req.body.mediaMimeType || 'application/octet-stream').slice(0, 120) : null,
        mediaFilename: mediaUrl ? String(req.body.mediaFilename || path.basename(mediaUrl)).slice(0, 180) : null,
        // null desativa o intervalo silencioso; valores ausentes preservam o padrao seguro.
        quietHoursStart: Object.prototype.hasOwnProperty.call(req.body, 'respectQuietHours') && req.body.respectQuietHours === false
          ? null : (Object.prototype.hasOwnProperty.call(req.body, 'quietHoursStart') ? req.body.quietHoursStart : '20:00'),
        quietHoursEnd: Object.prototype.hasOwnProperty.call(req.body, 'respectQuietHours') && req.body.respectQuietHours === false
          ? null : (Object.prototype.hasOwnProperty.call(req.body, 'quietHoursEnd') ? req.body.quietHoursEnd : '08:00'),
        total: rows.length, skipped: rows.filter((r) => r.status === 'SKIPPED').length,
        metadata: { tag: req.body.tag || null, counter: category === 'COUNTER', createdFrom: 'campaigns' },
        recipients: { create: (() => {
          // A restriÃ§Ã£o por (campanha, telefone) evita duplicidade real. Para
          // linhas ignoradas com o mesmo telefone (ou sem telefone), use uma
          // chave tÃ©cnica e preserve o valor original no metadata para o CSV.
          const used = new Set();
          return rows.map((row, index) => {
            const originalPhone = row.phone || String(row.contact?.phone || '');
            let storedPhone = originalPhone;
            if (!storedPhone || used.has(storedPhone)) storedPhone = `skip:${row.contact?.id || index}:${originalPhone}`;
            used.add(storedPhone);
            return {
              tenantId, contactId: row.contact?.id || null, instanceId: instance.id, phone: storedPhone,
              contactName: row.contact.name || row.contact.fantasyName || null, renderedMessage: row.renderedMessage || '',
              status: row.status, reason: row.reason || null,
              metadata: { ...(row.counterData || {}), ...(row.status === 'SKIPPED' ? { originalPhone } : {}) },
            };
          });
        })() },
      },
      include: { recipients: true, instance: { select: { id: true, instanceName: true, phone: true, status: true } } },
    });
    res.status(201).json({ campaign, recipients: campaign.recipients, summary: summaryFromRows(campaign.recipients) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Não foi possível criar a campanha.' });
  }
}

async function getCampaign(req, res) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } }, creator: { select: { id: true, name: true } }, recipients: { orderBy: { createdAt: 'asc' } } },
  });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  res.json({ campaign, recipients: campaign.recipients, summary: summaryFromRows(campaign.recipients) });
}

async function list(req, res) {
  const campaigns = await prisma.campaign.findMany({
    where: { tenantId: req.user.tenantId }, orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit) || 100, 250),
    include: { instance: { select: { id: true, instanceName: true, phone: true, status: true } }, creator: { select: { id: true, name: true } } },
  });
  res.json(campaigns);
}

async function start(req, res) {
  try {
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
    await getInstance(req.user.tenantId, campaign.instanceId, { requireConnected: true });
    if (['COMPLETED', 'CANCELLED'].includes(campaign.status)) return res.status(409).json({ error: 'Esta campanha já foi encerrada.' });
    const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'QUEUED', cancelRequested: false, lastError: null } });
    campaignProcessor.processCampaign(updated.id).catch((err) => console.error('[campaign] worker:', err.message));
    res.json({ campaign: updated });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function transition(req, res, status) {
  const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const data = status === 'CANCELLED' ? { status, cancelRequested: true, cancelledAt: new Date() } : { status, pausedAt: status === 'PAUSED' ? new Date() : null };
  const updated = await prisma.campaign.update({ where: { id: campaign.id }, data });
  if (status === 'QUEUED') campaignProcessor.processCampaign(updated.id).catch(() => {});
  res.json({ campaign: updated });
}

async function retry(req, res) {
  const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  await prisma.campaignRecipient.updateMany({ where: { campaignId: campaign.id, status: 'FAILED' }, data: { status: 'PENDING', reason: null, errorMessage: null } });
  const updated = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'QUEUED', cancelRequested: false, lastError: null } });
  campaignProcessor.processCampaign(updated.id).catch(() => {});
  res.json({ campaign: updated });
}

async function exportCampaign(req, res) {
  const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId }, include: { recipients: true } });
  if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
  const header = 'nome;telefone;status;motivo;tentativas;enviado_em\n';
  const rows = campaign.recipients.map((r) => [r.contactName || '', r.metadata?.originalPhone || r.phone, r.status, r.reason || r.errorMessage || '', r.attempts, r.sentAt?.toISOString() || ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campanha-${campaign.id}.csv"`);
  res.send('\uFEFF' + header + rows.join('\n'));
}

async function templates(req, res) {
  const rows = await prisma.campaignTemplate.findMany({ where: { tenantId: req.user.tenantId, active: true }, orderBy: { name: 'asc' } });
  res.json(rows);
}

async function createTemplate(req, res) {
  const body = String(req.body.body || '').trim();
  if (!req.body.name || !body) return res.status(400).json({ error: 'Nome e conteúdo são obrigatórios.' });
  const row = await prisma.campaignTemplate.create({ data: { tenantId: req.user.tenantId, name: String(req.body.name).slice(0, 120), category: normalizeCategory(req.body.category), body, variables: req.body.variables || null, createdById: req.user.userId } });
  res.status(201).json(row);
}

async function testSend(req, res) {
  try {
    const { tenantId } = req.user;
    const instance = await getInstance(tenantId, req.body.instanceId, { requireConnected: true });
    const phone = validPhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Telefone de teste inválido.' });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings?.evolutionUrl || !settings?.evolutionKey) return res.status(400).json({ error: 'Evolution API não configurada.' });
    const result = await evolutionService.sendText(settings.evolutionUrl, settings.evolutionKey, instance.instanceName, phone, String(req.body.message || ''));
    res.json({ ok: true, externalId: result?.key?.id || result?.message?.key?.id || null });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Não foi possível enviar o teste.' });
  }
}

// Endpoint legado: cria a campanha e inicia imediatamente. Mantém os clientes
// antigos funcionando, mas sem permitir que destinatários sejam duplicados.
async function sendBulk(req, res) {
  let instanceId = req.body.instanceId;
  if (!instanceId) {
    const first = await prisma.waInstance.findFirst({
      where: { tenantId: req.user.tenantId, status: { in: ['connected', 'CONNECTED', 'open', 'OPEN'] }, instanceName: { not: { startsWith: 'DELETED_' } } },
      select: { id: true }, orderBy: { instanceName: 'asc' },
    });
    instanceId = first?.id;
  }
  // A API antiga recebia o intervalo em milissegundos; converta somente esse
  // formato para que nao vire uma espera de milhares de segundos.
  const legacyDelay = Number(req.body.delay);
  const delaySeconds = Number.isFinite(legacyDelay) && legacyDelay > 120 ? legacyDelay / 1000 : legacyDelay;
  req.body = { ...req.body, name: req.body.name || 'Disparo legado', instanceId, delaySeconds, category: req.body.category || 'MARKETING', legacy: true };
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload?.campaign) return originalJson({ total: payload.campaign.total, status: payload.campaign.status, campaignId: payload.campaign.id, campaign: payload.campaign, summary: payload.summary });
    return originalJson(payload);
  };
  return create(req, {
    ...res,
    status(code) { res.status(code); return this; },
    json: (payload) => {
      if (payload?.campaign && payload.campaign.status === 'DRAFT') {
        campaignProcessor.processCampaign(payload.campaign.id).catch(() => {});
        return originalJson({ total: payload.campaign.total, status: 'started', campaignId: payload.campaign.id, campaign: payload.campaign, summary: payload.summary });
      }
      return originalJson(payload);
    },
  });
}

module.exports = { setIo, list, create, preview, listInstances, getCampaign, start, pause: (req, res) => transition(req, res, 'PAUSED'), resume: (req, res) => transition(req, res, 'QUEUED'), cancel: (req, res) => transition(req, res, 'CANCELLED'), retry, exportCampaign, templates, createTemplate, testSend, sendBulk, renderTemplate, loadAudience, isQuietHours };
