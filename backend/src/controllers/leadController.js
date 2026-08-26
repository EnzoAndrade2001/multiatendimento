const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { scrapeGoogleMaps } = require('../services/scraperService');
const evolutionService = require('../services/evolutionService');
const campaignProcessor = require('../services/campaignProcessor');
const { uploadsPath } = require('../utils/uploads');

const MAX_SEARCH_RESULTS = 50;
const MAX_BATCH_SIZE = 500;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const CAMPAIGN_ACTIVE = ['DRAFT', 'QUEUED', 'RUNNING', 'PAUSED'];
// Serializa apenas a montagem da fila por tenant. O worker continua
// assíncrono, mas duas requisições simultâneas não conseguem passar pelo
// mesmo snapshot de leads e criar campanhas concorrentes para os mesmos
// números dentro deste processo.
const sendLocks = new Map();
const ALLOWED_MEDIA = new Map([
  ['.jpg', { type: 'image', mime: 'image/jpeg' }], ['.jpeg', { type: 'image', mime: 'image/jpeg' }],
  ['.png', { type: 'image', mime: 'image/png' }], ['.webp', { type: 'image', mime: 'image/webp' }],
  ['.gif', { type: 'image', mime: 'image/gif' }], ['.pdf', { type: 'document', mime: 'application/pdf' }],
  ['.txt', { type: 'document', mime: 'text/plain' }], ['.csv', { type: 'document', mime: 'text/csv' }],
  ['.doc', { type: 'document', mime: 'application/msword' }], ['.docx', { type: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
  ['.xls', { type: 'document', mime: 'application/vnd.ms-excel' }], ['.xlsx', { type: 'document', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
]);

function errorWithStatus(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function acquireSendLock(key) {
  const previous = sendLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  sendLocks.set(key, current);
  await previous;
  return () => {
    if (sendLocks.get(key) === current) sendLocks.delete(key);
    release();
  };
}

/**
 * Serializa operações que escolhem/criam leads e campanhas no mesmo tenant.
 * O lock vive somente durante a transação e evita que duas requisições de
 * prospecção passem simultaneamente pela checagem de destinatários ativos.
 * P2034 é repetido para tolerar uma colisão de serialização do PostgreSQL.
 */
async function withTenantLeadLock(tenantId, work) {
  let attempt = 0;
  while (attempt < 3) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
          `lead-dispatch:${tenantId}`,
        );
        return work(tx);
      });
    } catch (error) {
      if (error?.code !== 'P2034' || ++attempt >= 3) throw error;
    }
  }
  throw new Error('Não foi possível reservar a fila de prospecção.');
}

function text(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normalizeLeadPhone(phone) {
  const normalized = evolutionService.normalizePhoneNumber(phone || '');
  if (!normalized || normalized.toLowerCase().endsWith('@g.us')) return '';
  const digits = normalized.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? normalized : '';
}

function parseBool(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  if (['true', '1', 'yes', 'sim'].includes(String(value).toLowerCase())) return true;
  if (['false', '0', 'no', 'nao', 'não'].includes(String(value).toLowerCase())) return false;
  return fallback;
}

function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function extractLocation(item, fallbackCity = '', fallbackState = '') {
  let city = text(item.city || fallbackCity, 100);
  let state = text(item.state || fallbackState, 30).toUpperCase();
  const address = text(item.address, 500);
  // SerpAPI normalmente só retorna endereço completo; preservar o texto e
  // aproveitar "Cidade - UF" quando esse padrão estiver disponível.
  if (!city && address) {
    const match = address.match(/,\s*([^,\-]+?)\s*[-/]\s*([A-Z]{2})(?:\s|$)/i);
    if (match) { city = text(match[1], 100); state = text(match[2], 30).toUpperCase(); }
  }
  return { city: city || null, state: state || null };
}

function parsePage(query) {
  const raw = Number.parseInt(query, 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
}

function parseLimit(query) {
  const raw = Number.parseInt(query, 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 50;
}

function parseMaxResults(value) {
  const raw = Number(value);
  return Number.isFinite(raw) ? Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(raw))) : 20;
}

function normalizeMedia(mediaUrl, mediaType, mediaMimeType, tenantId = null) {
  if (!mediaUrl) return null;
  const raw = text(mediaUrl, 500);
  if (!raw.startsWith('/uploads/') || raw.includes('\\') || raw.includes('..') || raw.includes('?') || raw.includes('#')) throw errorWithStatus('Anexo inválido. Use somente um arquivo previamente enviado para /uploads/.');
  const filename = path.basename(raw);
  if (!filename || filename !== raw.slice('/uploads/'.length) || filename.startsWith('.')) throw errorWithStatus('Anexo inválido.');
  // Disparos de prospecção só aceitam arquivos enviados pela rota dedicada.
  // O prefixo contém o tenant e impede reutilizar, por engano, um upload de
  // outro tenant ou do inbox. Sem tenantId a função permanece compatível com
  // os testes/utilitários antigos.
  if (tenantId && !filename.startsWith(`${tenantId}-`)) throw errorWithStatus('Anexo não pertence a este tenant.', 403);
  const info = ALLOWED_MEDIA.get(path.extname(filename).toLowerCase());
  if (!info) throw errorWithStatus('Tipo de anexo não permitido. Use imagem ou documento compatível.');
  const selectedType = text(mediaType, 30).toLowerCase();
  if (selectedType && selectedType !== info.type) throw errorWithStatus('O tipo informado não corresponde ao arquivo anexado.');
  const suppliedMime = text(mediaMimeType, 120).toLowerCase();
  if (suppliedMime && suppliedMime !== info.mime) throw errorWithStatus('O MIME informado não corresponde ao arquivo anexado.');
  const target = path.resolve(uploadsPath, filename);
  const base = path.resolve(uploadsPath);
  if (!target.startsWith(`${base}${path.sep}`) || !fs.existsSync(target)) throw errorWithStatus('O anexo não está disponível no servidor.', 422);
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MEDIA_BYTES) throw errorWithStatus(`O anexo deve ter entre 1 byte e ${MAX_MEDIA_BYTES / (1024 * 1024)} MB.`, 413);
  // Não confie apenas na extensão/MIME enviados pelo navegador. Confira a
  // assinatura dos formatos usados pela prospecção antes de colocar o arquivo
  // na fila de envio.
  const header = fs.readFileSync(target).subarray(0, 12);
  const signature = info.type === 'image'
    ? ((info.mime === 'image/jpeg' && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
      || (info.mime === 'image/png' && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      || (info.mime === 'image/gif' && (header.subarray(0, 6).toString() === 'GIF87a' || header.subarray(0, 6).toString() === 'GIF89a'))
      || (info.mime === 'image/webp' && header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP'))
    : (info.mime === 'application/pdf' ? header.subarray(0, 5).toString() === '%PDF-' : true);
  if (!signature) throw errorWithStatus('O conteúdo do anexo não corresponde ao tipo informado.');
  return { url: `/uploads/${filename}`, type: info.type, mime: info.mime, filename, size: stat.size };
}

async function uploadLeadMedia(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const mediaUrl = `/uploads/${req.file.filename}`;
  try {
    const media = normalizeMedia(mediaUrl, 'image', req.file.mimetype, req.user.tenantId);
    return res.status(201).json({ ...media, name: media.filename, mediaType: media.type, mimeType: media.mime });
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch { /* arquivo inválido não deve permanecer no volume */ }
    return res.status(error.status || 400).json({ error: error.message || 'Arquivo inválido.' });
  }
}

function sourceMetadata(lead) {
  return { source: 'LEAD', sourceLeadId: lead.id };
}

function renderLeadMessage(message, lead) {
  const values = { nome: lead.name, cliente: lead.name, telefone: lead.phone || '', cidade: lead.city || '', estado: lead.state || '', categoria: lead.category || '' };
  return String(message).replace(/\[([a-zA-ZÀ-ÿ0-9_]+)\]|\{\{\s*([a-zA-ZÀ-ÿ0-9_]+)\s*\}\}/g, (_m, a, b) => {
    const key = String(a || b || '').toLowerCase();
    return values[key] == null ? '' : String(values[key]);
  });
}

// POST /api/leads/search
async function searchLeads(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const query = text(req.body.query, 300);
    if (query.length < 3) return res.status(400).json({ error: 'Informe uma busca válida (ex: "dentistas em São Paulo").' });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const apiKey = settings?.serpApiKey || process.env.SERPAPI_KEY;
    if (!apiKey) return res.status(400).json({ error: 'Chave SerpAPI não configurada.' });
    const fallbackCity = text(req.body.city, 100);
    const fallbackState = text(req.body.state, 30).toUpperCase();
    const results = await scrapeGoogleMaps(query, apiKey, parseMaxResults(req.body.maxResults));
    let saved = 0; let updated = 0; const savedLeads = [];
    for (const item of results) {
      try {
        const location = extractLocation(item, fallbackCity, fallbackState);
        const placeId = text(item.placeId, 180) || `search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const normalizedPhone = normalizeLeadPhone(item.phone);
        const existing = await prisma.lead.findFirst({
          where: { tenantId, OR: [{ placeId }, ...(normalizedPhone ? [{ phone: normalizedPhone }] : [])] },
          orderBy: { createdAt: 'asc' },
        });
        const data = {
          name: text(item.name || existing?.name || 'Lead sem nome', 180),
          phone: normalizedPhone || existing?.phone || null,
          address: text(item.address, 500) || existing?.address || null,
          city: location.city || existing?.city || null,
          state: location.state || existing?.state || null,
          website: text(item.website, 500) || existing?.website || null,
          rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : (existing?.rating ?? null),
          category: text(item.category, 180) || existing?.category || null,
          query,
        };
        const lead = existing ? await prisma.lead.update({ where: { id: existing.id }, data }) : await prisma.lead.create({ data: { tenantId, placeId, ...data } });
        savedLeads.push(lead); existing ? updated++ : saved++;
      } catch (error) { console.warn(`[leads] erro ao salvar resultado: ${error.message}`); }
    }
    res.json({ message: `${saved} novos leads encontrados, ${updated} atualizados.`, total: savedLeads.length, leads: savedLeads });
  } catch (error) { console.error('[leads] busca:', error.message); res.status(error.status || 500).json({ error: error.message || 'Erro ao buscar leads.' }); }
}

// GET /api/leads — sem page/limit mantém o array legado; com paginação retorna meta.
async function getLeads(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const q = text(req.query.q, 200);
    const where = { tenantId };
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q, mode: 'insensitive' } }, { category: { contains: q, mode: 'insensitive' } }, { query: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }, { state: { contains: q, mode: 'insensitive' } }];
    if (req.query.imported !== undefined) where.imported = parseBool(req.query.imported, false);
    if (req.query.city) where.city = { equals: text(req.query.city, 100), mode: 'insensitive' };
    if (req.query.state) where.state = { equals: text(req.query.state, 30), mode: 'insensitive' };
    if (req.query.category) where.category = { contains: text(req.query.category, 100), mode: 'insensitive' };
    if (req.query.origin || req.query.source) where.query = { contains: text(req.query.origin || req.query.source, 200), mode: 'insensitive' };
    if (req.query.consent !== undefined) where.marketingOptIn = parseBool(req.query.consent, false);
    if (req.query.optedOut !== undefined) where.optedOutAt = parseBool(req.query.optedOut, false) ? { not: null } : null;
    if (req.query.hasPhone !== undefined) where.phone = parseBool(req.query.hasPhone, false) ? { not: null } : null;
    const paginated = req.query.page !== undefined || req.query.limit !== undefined || req.query.format === 'page';
    const page = parsePage(req.query.page); const limit = parseLimit(req.query.limit);
    const [total, leads] = await Promise.all([prisma.lead.count({ where }), prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, ...(paginated ? { skip: (page - 1) * limit, take: limit } : { take: 500 }) })]);
    if (paginated) {
      // Os indicadores devem representar a base filtrada inteira, e não só a
      // página atual. Isso evita um funil enganoso quando há muitos leads.
      const [withPhone, sent, pending] = await Promise.all([
        prisma.lead.count({ where: { ...where, phone: { not: null } } }),
        prisma.lead.count({ where: { ...where, sentAt: { not: null } } }),
        prisma.lead.count({ where: { ...where, sentAt: null, phone: { not: null }, optedOutAt: null } }),
      ]);
      return res.json({ leads, pagination: {
        total, page, limit, hasMore: page * limit < total, totalPages: Math.ceil(total / limit),
        stats: { total, withPhone, sent, pending },
      } });
    }
    res.json(leads);
  } catch (error) { console.error('[leads] listar:', error.message); res.status(500).json({ error: 'Erro ao listar leads.' }); }
}

async function getLeadInstances(req, res) {
  try {
    const instances = await prisma.waInstance.findMany({ where: { tenantId: req.user.tenantId, instanceName: { not: { startsWith: 'DELETED_' } } }, select: { id: true, instanceName: true, phone: true, status: true }, orderBy: { instanceName: 'asc' } });
    res.json(instances);
  } catch (error) { res.status(500).json({ error: 'Erro ao listar instâncias.' }); }
}

async function getLeadHistory(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId }, select: { id: true, name: true, phone: true, city: true, state: true, marketingOptIn: true, optedOutAt: true, sentAt: true, sentCount: true } });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
    const recipients = await prisma.campaignRecipient.findMany({ where: { tenantId: req.user.tenantId, leadId: lead.id }, include: { campaign: { select: { id: true, name: true, category: true, status: true, instanceId: true, createdAt: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ lead, history: recipients });
  } catch (error) { res.status(500).json({ error: 'Erro ao consultar histórico do lead.' }); }
}

// GET /api/leads/campaigns — histórico próprio da prospecção, sem expor as
// campanhas financeiras/operacionais para quem só possui leads.manage.
async function getLeadCampaigns(req, res) {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId: req.user.tenantId, category: 'PROSPECTING' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, name: true, category: true, status: true, total: true, sent: true,
        delivered: true, failed: true, skipped: true, delaySeconds: true,
        instanceId: true, createdAt: true, startedAt: true, completedAt: true,
        lastError: true,
        instance: { select: { id: true, instanceName: true, phone: true, status: true } },
      },
    });
    res.json(campaigns);
  } catch (error) {
    console.error('[leads] histórico:', error.message);
    res.status(500).json({ error: 'Erro ao consultar o histórico de prospecção.' });
  }
}

// POST /api/leads/:id/convert — promove um lead captado para a agenda do
// WhatsApp/CRM sem duplicar um contato que já exista pelo mesmo telefone.
async function convertLead(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, tenantId } });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
    if (lead.contactId) {
      const existing = await prisma.contact.findFirst({ where: { id: lead.contactId, tenantId } });
      if (existing) return res.json({ lead, contact: existing, alreadyLinked: true });
    }
    const phone = normalizeLeadPhone(lead.phone);
    if (!phone) return res.status(422).json({ error: 'O lead precisa de um telefone válido para ser vinculado.' });
    const requestedInstanceId = text(req.body.instanceId, 100);
    const instance = await prisma.waInstance.findFirst({
      where: { tenantId, ...(requestedInstanceId ? { id: requestedInstanceId } : { status: { in: ['connected', 'CONNECTED', 'open', 'OPEN', 'online', 'ONLINE'] } }), instanceName: { not: { startsWith: 'DELETED_' } } },
      orderBy: { instanceName: 'asc' },
    });
    if (!instance) return res.status(400).json({ error: 'Selecione uma instância WhatsApp para vincular o lead.' });
    const existing = await prisma.contact.findFirst({ where: { tenantId, OR: [{ phone }, { whatsapp: phone }] } });
    const contact = existing || await prisma.contact.create({ data: {
      tenantId, instanceId: instance.id, phone, whatsapp: phone, name: text(lead.name, 180) || phone,
      externalSource: 'prospecting', externalId: lead.id, address: text(lead.address, 500) || null,
      city: text(lead.city, 100) || null, state: text(lead.state, 30) || null,
      tags: JSON.stringify(['prospecção']),
    } });
    const updatedLead = await prisma.lead.update({ where: { id: lead.id }, data: { contactId: contact.id, imported: true } });
    res.status(existing ? 200 : 201).json({ lead: updatedLead, contact, alreadyLinked: Boolean(existing) });
  } catch (error) {
    if (error?.code === 'P2002') return res.status(409).json({ error: 'Este lead já está vinculado a um contato.' });
    console.error('[leads] vinculação:', error.message);
    res.status(500).json({ error: 'Não foi possível vincular o lead ao CRM.' });
  }
}

async function deleteLead(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
    await prisma.lead.delete({ where: { id: lead.id } });
    res.json({ ok: true });
  } catch (error) { res.status(500).json({ error: 'Erro ao deletar lead.' }); }
}

async function deleteAllLeads(req, res) {
  try { const result = await prisma.lead.deleteMany({ where: { tenantId: req.user.tenantId } }); res.json({ ok: true, deleted: result.count }); }
  catch (error) { res.status(500).json({ error: 'Erro ao deletar leads.' }); }
}

async function createManualLeads(req, res) {
  try {
    const input = req.body.leads;
    if (!Array.isArray(input) || input.length === 0) return res.status(400).json({ error: 'Informe pelo menos um contato manual.' });
    if (input.length > MAX_BATCH_SIZE) return res.status(413).json({ error: `O limite é de ${MAX_BATCH_SIZE} contatos por importação. Divida o arquivo em lotes menores.`, limit: MAX_BATCH_SIZE });
    const tenantId = req.user.tenantId; const seen = new Set(); const errors = []; const savedLeads = []; let created = 0; let updated = 0;
    for (let index = 0; index < input.length; index++) {
      const item = input[index];
      if (!item || typeof item !== 'object') { errors.push({ index, reason: 'linha inválida' }); continue; }
      const phone = normalizeLeadPhone(item.phone); const name = text(item.name || item.phone, 180);
      if (!name) { errors.push({ index, reason: 'nome ausente' }); continue; }
      if (!phone) { errors.push({ index, name, reason: 'telefone inválido ou ausente' }); continue; }
      if (seen.has(phone)) { errors.push({ index, name, phone, reason: 'telefone duplicado no lote' }); continue; }
      seen.add(phone);
      const location = extractLocation(item, '', ''); const optIn = parseBool(item.marketingOptIn ?? item.consent, undefined); const optedOutAt = item.optedOutAt === null || item.optedOutAt === '' ? null : parseDate(item.optedOutAt);
      if (item.optedOutAt && !optedOutAt) { errors.push({ index, name, phone, reason: 'data de opt-out inválida' }); continue; }
      const existing = await prisma.lead.findFirst({ where: { tenantId, phone } });
      const query = text(item.query, 300);
      const data = { name, address: text(item.address, 500) || undefined, city: location.city || undefined, state: location.state || undefined, website: text(item.website, 500) || undefined, category: text(item.category, 180) || undefined, ...(query ? { query } : existing ? {} : { query: 'manual' }), ...(optIn !== undefined ? { marketingOptIn: optIn } : {}), ...(item.optedOutAt !== undefined ? { optedOutAt } : {}) };
      const lead = existing ? await prisma.lead.update({ where: { id: existing.id }, data }) : await prisma.lead.create({ data: { tenantId, placeId: `manual_${phone}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, phone, ...data } });
      savedLeads.push(lead); existing ? updated++ : created++;
    }
    res.json({ message: `${created} contatos adicionados, ${updated} atualizados, ${errors.length} ignorados.`, created, updated, skipped: errors.length, errors: errors.slice(0, 100), leads: savedLeads });
  } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Erro ao adicionar contatos.' }); }
}

// POST /api/leads/send — cria uma Campaign durável; o worker realiza o envio.
async function sendToLeads(req, res) {
  let releaseSendLock;
  try {
    const tenantId = req.user.tenantId; const userId = req.user.userId;
    releaseSendLock = await acquireSendLock(tenantId);
    if (!Array.isArray(req.body.leadIds) || req.body.leadIds.length === 0) return res.status(400).json({ error: 'Selecione pelo menos um lead.' });
    const leadIds = [...new Set(req.body.leadIds.map((id) => text(id, 100)).filter(Boolean))];
    if (leadIds.length > MAX_BATCH_SIZE) return res.status(413).json({ error: `O limite é de ${MAX_BATCH_SIZE} leads por disparo.`, limit: MAX_BATCH_SIZE });
    const rawMessage = String(req.body.message == null ? '' : req.body.message).trim();
    if (rawMessage.length > MAX_MESSAGE_LENGTH) return res.status(413).json({ error: `A mensagem deve ter no máximo ${MAX_MESSAGE_LENGTH} caracteres.`, limit: MAX_MESSAGE_LENGTH });
    const message = rawMessage; const rawMedia = req.body.mediaUrl; const hasMedia = Boolean(rawMedia); const hasText = Boolean(message);
    if (!hasText && !hasMedia) return res.status(400).json({ error: 'Informe uma mensagem ou mídia para enviar.' });
    const media = normalizeMedia(rawMedia, req.body.mediaType, req.body.mediaMimeType);
    const requestedInstanceId = text(req.body.instanceId, 100);
    const instance = await prisma.waInstance.findFirst({ where: { tenantId, ...(requestedInstanceId ? { id: requestedInstanceId } : { status: { in: ['connected', 'CONNECTED', 'open', 'OPEN'] } }), instanceName: { not: { startsWith: 'DELETED_' } } }, select: { id: true, instanceName: true, phone: true, status: true }, orderBy: { instanceName: 'asc' } });
    if (!instance) return res.status(400).json({ error: 'Instância de saída não encontrada para este tenant.' });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { evolutionUrl: true, evolutionKey: true } });
    if (!settings?.evolutionUrl || !settings?.evolutionKey) return res.status(400).json({ error: 'Configure a Evolution API antes de enviar.' });
    // A key supplied by the client makes retries idempotent. Without one,
    // create a fresh key so that an intentional new campaign is allowed;
    // active-recipient checks below still prevent duplicate queueing.
    const idempotencyKey = text(req.body.idempotencyKey, 120) || crypto.randomUUID();
    const existingCampaign = await prisma.campaign.findFirst({ where: { tenantId, idempotencyKey }, include: { recipients: true, instance: { select: { id: true, instanceName: true, phone: true, status: true } } } });
    if (existingCampaign) return res.status(200).json({ campaign: existingCampaign, campaignId: existingCampaign.id, duplicate: true, status: existingCampaign.status, sent: existingCampaign.sent, failed: existingCampaign.failed, skipped: existingCampaign.skipped, queued: existingCampaign.status === 'QUEUED' || existingCampaign.status === 'RUNNING' });
    const leads = await prisma.lead.findMany({ where: { tenantId, id: { in: leadIds } } });
    const found = new Set(leads.map((lead) => lead.id)); const rows = []; const seenPhones = new Set(); const requireConsent = req.body.requireConsent === true || req.body.respectConsent === true; const consentConfirmed = req.body.consentConfirmed === true;
    const activeRecipients = await prisma.campaignRecipient.findMany({ where: { tenantId, leadId: { in: leadIds }, campaign: { status: { in: CAMPAIGN_ACTIVE } } }, select: { leadId: true, campaignId: true } });
    const activeLeadIds = new Set(activeRecipients.map((row) => row.leadId));
    for (const leadId of leadIds) {
      const lead = leads.find((item) => item.id === leadId);
      if (!lead) { rows.push({ lead: null, requestedLeadId: leadId, phone: `skip:${leadId}`, status: 'SKIPPED', reason: 'lead_not_found' }); continue; }
      const phone = normalizeLeadPhone(lead.phone);
      let status = 'PENDING'; let reason = null;
      if (!phone) { status = 'SKIPPED'; reason = 'invalid_phone'; }
      else if (seenPhones.has(phone)) { status = 'SKIPPED'; reason = 'duplicate_phone'; }
      else if (req.body.skipAlreadySent === true && lead.sentAt) { status = 'SKIPPED'; reason = 'already_sent'; seenPhones.add(phone); }
      else if (activeLeadIds.has(lead.id)) { status = 'SKIPPED'; reason = 'already_queued'; }
      else if (lead.optedOutAt) { status = 'SKIPPED'; reason = 'opted_out'; }
      else if (requireConsent && !lead.marketingOptIn) { status = 'SKIPPED'; reason = 'consent_required'; }
      if (status === 'PENDING') seenPhones.add(phone);
      rows.push({ lead, phone: phone || `skip:${lead.id}`, status, reason, renderedMessage: hasText ? renderLeadMessage(message, lead) : '', originalPhone: lead.phone || '' });
    }
    const pending = rows.filter((row) => row.status === 'PENDING');
    if (!pending.length) return res.status(422).json({
      error: 'Nenhum lead elegível para a campanha.',
      exclusions: rows.map(({ lead, requestedLeadId, reason, originalPhone }) => ({
        leadId: lead?.id || requestedLeadId || null,
        name: lead?.name || null,
        phone: originalPhone || null,
        reason: reason || 'not_eligible',
      })),
      found: found.size,
      requested: leadIds.length,
    });
    const minDelay = Math.max(1, Math.min(3600, Number(req.body.delayMinSeconds ?? req.body.delay ?? 5) || 5)); const maxDelay = Math.max(minDelay, Math.min(3600, Number(req.body.delayMaxSeconds ?? req.body.delay ?? minDelay) || minDelay)); const delaySeconds = Math.round((minDelay + maxDelay) / 2);
    const scheduledAt = req.body.scheduledAt ? parseDate(req.body.scheduledAt) : null; if (req.body.scheduledAt && !scheduledAt) return res.status(400).json({ error: 'Data de agendamento inválida.' });
    const status = scheduledAt && scheduledAt > new Date() ? 'QUEUED' : 'QUEUED';
    const campaign = await prisma.campaign.create({ data: { tenantId, createdById: userId, instanceId: instance.id, idempotencyKey, name: text(req.body.name || 'Prospecção', 120), category: 'PROSPECTING', message: message || '', mediaUrl: media?.url || null, mediaType: media?.type || null, mediaMimeType: media?.mime || null, mediaFilename: media?.filename || null, status, delaySeconds, scheduledAt, quietHoursStart: req.body.respectQuietHours === false ? null : (text(req.body.quietHoursStart, 5) || '20:00'), quietHoursEnd: req.body.respectQuietHours === false ? null : (text(req.body.quietHoursEnd, 5) || '08:00'), total: rows.length, skipped: rows.filter((row) => row.status === 'SKIPPED').length, metadata: { source: 'LEADS', idempotencyKey, sourceLeadIds: leadIds, delayMinSeconds: minDelay, delayMaxSeconds: maxDelay, requireConsent, consentConfirmed }, recipients: { create: rows.map((row, index) => ({ tenantId, leadId: row.lead?.id || null, instanceId: instance.id, phone: row.status === 'PENDING' ? row.phone : `skip:${row.lead?.id || row.requestedLeadId || index}`, contactName: text(row.lead?.name || 'Lead não encontrado', 180), renderedMessage: row.renderedMessage || '', status: row.status, reason: row.reason, skippedAt: row.status === 'SKIPPED' ? new Date() : null, metadata: { ...(row.lead ? sourceMetadata(row.lead) : { source: 'LEAD', requestedLeadId: row.requestedLeadId || null }), originalPhone: row.originalPhone || row.phone || null } })) } }, include: { recipients: true, instance: { select: { id: true, instanceName: true, phone: true, status: true } } } });
    campaignProcessor.processCampaign(campaign.id).catch((error) => console.error('[leads] worker:', error.message));
    res.status(202).json({ message: `Campanha criada para ${pending.length} lead(s).`, campaign, campaignId: campaign.id, status: campaign.status, queued: true, sent: 0, failed: 0, skipped: campaign.skipped, instance: instance.instanceName, delay: { minSeconds: minDelay, maxSeconds: maxDelay }, found: found.size, requested: leadIds.length });
  } catch (error) {
    // Duas tentativas simultâneas com a mesma chave podem disputar a unique
    // constraint. Retorne a campanha vencedora em vez de criar uma segunda.
    if (error?.code === 'P2002') {
      const key = text(req.body.idempotencyKey, 120);
      if (key) {
        const existing = await prisma.campaign.findFirst({ where: { tenantId: req.user.tenantId, idempotencyKey: key }, include: { recipients: true } }).catch(() => null);
        if (existing) return res.status(200).json({ campaign: existing, campaignId: existing.id, duplicate: true, status: existing.status, sent: existing.sent, failed: existing.failed, skipped: existing.skipped, queued: ['QUEUED', 'RUNNING'].includes(existing.status) });
      }
    }
    console.error('[leads] envio:', error.message);
    res.status(error.status || 500).json({ error: error.message || 'Erro ao criar campanha.' });
  } finally {
    releaseSendLock?.();
  }
}

module.exports = { searchLeads, getLeads, getLeadInstances, getLeadHistory, getLeadCampaigns, convertLead, createManualLeads, deleteLead, deleteAllLeads, sendToLeads, normalizeLeadPhone, normalizeMedia, renderLeadMessage };
