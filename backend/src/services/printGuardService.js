const axios = require('axios');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { encryptSecret, decryptSecret } = require('./printGuardCrypto');

const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_EVENT_BYTES = 512 * 1024;
// Versioned API prefix shared by pairing and all authenticated resources.
const PRINTGUARD_API_PREFIX = '/integrations/v1/multiatendimento';
let io = null;

function setIo(value) { io = value; }

function normalizeBaseUrl(value) {
  let url = String(value || process.env.PRINTGUARD_URL || '').trim().replace(/\/+$/, '');
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('URL do PrintGuard invalida.');
  if (url.toLowerCase().endsWith(PRINTGUARD_API_PREFIX)) {
    url = url.slice(0, -PRINTGUARD_API_PREFIX.length).replace(/\/+$/, '');
  }
  return url;
}

function apiBaseUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}${PRINTGUARD_API_PREFIX}`;
}

function callbackUrl(req) {
  if (process.env.PRINTGUARD_CALLBACK_URL) return process.env.PRINTGUARD_CALLBACK_URL;
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  return `${protocol}://${req.get('host')}/api/integrations/printguard/webhook`;
}

function extractPayload(data) {
  if (!data || typeof data !== 'object') return {};
  return data.data && typeof data.data === 'object' ? data.data : data;
}

function secureConnection(connection, includeSecrets = false) {
  if (!connection) return null;
  const result = {
    id: connection.id,
    name: connection.name,
    baseUrl: connection.baseUrl,
    externalId: connection.externalId,
    organization: connection.organization || null,
    status: connection.status,
    lastTestAt: connection.lastTestAt,
    lastConnectedAt: connection.lastConnectedAt,
    lastCursor: connection.lastCursor,
    lastError: connection.lastError,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
  // includeSecrets is intentionally never used by HTTP controllers. It exists
  // only for internal calls that immediately construct an Authorization header.
  if (includeSecrets) {
    result.accessToken = decryptSecret(connection.accessTokenCipher);
    result.webhookSecret = decryptSecret(connection.webhookSecretCipher);
  }
  return result;
}

async function getConnection(tenantId) {
  return prisma.printGuardConnection.findFirst({
    where: { tenantId, status: { not: 'INACTIVE' } },
    orderBy: { updatedAt: 'desc' },
  });
}

function clientFor(connection) {
  const credentials = secureConnection(connection, true);
  if (!credentials.accessToken) throw new Error('Conexao PrintGuard sem token ativo.');
  return axios.create({
    baseURL: apiBaseUrl(connection.baseUrl),
    timeout: Number(process.env.PRINTGUARD_TIMEOUT_MS) || 15000,
    headers: { Authorization: `Bearer ${credentials.accessToken}`, Accept: 'application/json' },
  });
}

async function exchangePairing(tenantId, req, input = {}) {
  const code = String(input.code || input.pairingCode || '').trim();
  if (!code) throw new Error('Codigo de pareamento obrigatorio.');
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true } });
  if (!tenant) throw new Error('Tenant nao encontrado.');

  const response = await axios.post(`${apiBaseUrl(baseUrl)}/pairing/exchange`, {
    code,
    callbackUrl: callbackUrl(req),
    tenantExternalId: tenant.slug || tenant.id,
    tenantName: tenant.name,
  }, { timeout: Number(process.env.PRINTGUARD_TIMEOUT_MS) || 15000 });
  const payload = extractPayload(response.data);
  const connectionId = String(payload.connectionId || payload.connection?.id || '').trim();
  const accessToken = payload.accessToken || payload.token;
  const webhookSecret = payload.webhookSecret || payload.secret;
  if (!connectionId || !accessToken || !webhookSecret) throw new Error('Resposta de pareamento incompleta.');

  const name = String(input.name || payload.organization?.name || 'PrintGuard').trim().slice(0, 100) || 'PrintGuard';
  const saved = await prisma.printGuardConnection.upsert({
    where: { tenantId_name: { tenantId, name } },
    update: {
      baseUrl,
      externalId: connectionId,
      organization: payload.organization || null,
      accessTokenCipher: encryptSecret(accessToken),
      webhookSecretCipher: encryptSecret(webhookSecret),
      status: 'CONNECTED',
      lastConnectedAt: new Date(),
      lastTestAt: new Date(),
      lastError: null,
    },
    create: {
      tenantId,
      name,
      baseUrl,
      externalId: connectionId,
      organization: payload.organization || null,
      accessTokenCipher: encryptSecret(accessToken),
      webhookSecretCipher: encryptSecret(webhookSecret),
      status: 'CONNECTED',
      lastConnectedAt: new Date(),
      lastTestAt: new Date(),
    },
  });
  // Um tenant opera com uma única conexão PrintGuard ativa. Pareamentos
  // anteriores permanecem no histórico, mas não podem competir na ingestão.
  await prisma.printGuardConnection.updateMany({
    where: { tenantId, id: { not: saved.id }, status: { not: 'INACTIVE' } },
    data: { status: 'INACTIVE', accessTokenCipher: null, webhookSecretCipher: null },
  });
  return secureConnection(saved);
}

async function testConnection(tenantId) {
  const connection = await getConnection(tenantId);
  if (!connection) throw new Error('Nenhuma conexao PrintGuard configurada.');
  try {
    const response = await clientFor(connection).get('/health');
    const updated = await prisma.printGuardConnection.update({
      where: { id: connection.id },
      data: { status: 'CONNECTED', lastTestAt: new Date(), lastConnectedAt: new Date(), lastError: null, organization: extractPayload(response.data).organization || connection.organization || null },
    });
    return { connection: secureConnection(updated), health: response.data };
  } catch (error) {
    await prisma.printGuardConnection.update({ where: { id: connection.id }, data: { status: 'ERROR', lastTestAt: new Date(), lastError: String(error.message || error).slice(0, 1000) } }).catch(() => {});
    throw error;
  }
}

function normalizeCode(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeSerial(value) {
  const text = String(value ?? '').trim();
  return text ? text.toUpperCase() : null;
}

function eventFields(input) {
  const source = input && typeof input === 'object' ? (input.event && typeof input.event === 'object' ? input.event : input) : {};
  const pick = (...values) => values.find((v) => v !== undefined && v !== null && String(v).trim() !== '');
  return {
    eventId: String(pick(source.eventId, source.id, source.externalEventId) || '').trim(),
    eventType: String(pick(source.eventType, source.type, source.kind, 'telemetry')).trim().slice(0, 120),
    customerCode: normalizeCode(pick(source.customerCode, source.customerExternalId, source.customer?.customerCode, source.customer?.code, source.customer?.externalId)),
    serialNumber: normalizeSerial(pick(source.serialNumber, source.serial, source.equipment?.serialNumber, source.device?.serialNumber)),
    severity: String(pick(source.severity, source.priority, 'INFO')).trim().toUpperCase().slice(0, 30),
    occurredAt: pick(source.occurredAt, source.detectedAt, source.timestamp, source.createdAt),
    payload: source,
  };
}

async function resolveMapping(tenantId, fields, connectionId) {
  const customerCode = fields.customerCode;
  const serialNumber = fields.serialNumber;
  let customers = [];
  let equipments = [];
  if (customerCode) {
    customers = await prisma.crmCustomer.findMany({ where: { tenantId, externalSource: 'firebird', externalId: customerCode }, take: 2 });
  }
  if (serialNumber) {
    equipments = await prisma.crmEquipment.findMany({
      where: { tenantId, externalSource: 'firebird', serialNumber: { equals: serialNumber, mode: 'insensitive' } },
    });
  }

  let state = 'UNMATCHED';
  let customer = customers.length === 1 ? customers[0] : null;
  let equipment = equipments.length === 1 ? equipments[0] : null;
  if (customers.length > 1 || equipments.length > 1) state = 'AMBIGUOUS';
  else if (!customer && !equipment) state = 'UNMATCHED';
  else if (!customer) state = 'UNMATCHED_CUSTOMER';
  else if (!equipment) state = 'UNMATCHED_EQUIPMENT';
  else if (equipment.customerId && equipment.customerId !== customer.id) state = 'AMBIGUOUS';
  else state = 'MATCHED';

  const existing = await prisma.printGuardBinding.findFirst({ where: { tenantId, connectionId, customerCode, serialNumber } });
  const data = { customerCode, serialNumber, customerId: customer?.id || null, equipmentId: equipment?.id || null, state, lastSeenAt: new Date() };
  const binding = existing
    ? await prisma.printGuardBinding.update({ where: { id: existing.id }, data })
    : await prisma.printGuardBinding.create({ data: { tenantId, connectionId, ...data } });
  return { binding, state, customer, equipment };
}

function verifySignature({ connection, timestamp, signature, rawBody, now = Date.now() }) {
  if (!timestamp || !signature || !Buffer.isBuffer(rawBody)) return { ok: false, reason: 'missing_headers_or_raw_body' };
  const timestampNumber = Number(timestamp);
  const timestampMs = timestampNumber < 1e12 ? timestampNumber * 1000 : timestampNumber;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > SIGNATURE_TOLERANCE_MS) return { ok: false, reason: 'timestamp_out_of_window' };
  let secret;
  try { secret = decryptSecret(connection.webhookSecretCipher); } catch { return { ok: false, reason: 'secret_unavailable' }; }
  if (!secret) return { ok: false, reason: 'secret_unavailable' };
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8').digest('hex');
  const provided = String(signature).replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return { ok: false, reason: 'signature_format' };
  const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  return { ok, reason: ok ? null : 'signature_mismatch' };
}

async function ingestWebhook({ connection, body, rawBody, timestamp, signature }) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > MAX_EVENT_BYTES) throw new Error('Payload do evento excede o limite seguro.');
  const verification = verifySignature({ connection, timestamp, signature, rawBody });
  if (!verification.ok) {
    const error = new Error(`Assinatura PrintGuard rejeitada: ${verification.reason}`);
    error.statusCode = 401;
    throw error;
  }
  const fields = eventFields(body);
  if (!fields.eventId) {
    const error = new Error('Evento PrintGuard sem eventId.');
    error.statusCode = 400;
    throw error;
  }
  const duplicate = await prisma.printGuardTelemetryEvent.findUnique({ where: { connectionId_externalEventId: { connectionId: connection.id, externalEventId: fields.eventId } } });
  if (duplicate) return { event: duplicate, duplicate: true };

  const mapping = await resolveMapping(connection.tenantId, fields, connection.id);
  let occurredAt = null;
  if (fields.occurredAt) {
    const parsed = new Date(fields.occurredAt);
    if (!Number.isNaN(parsed.getTime())) occurredAt = parsed;
  }
  const event = await prisma.printGuardTelemetryEvent.create({
    data: {
      tenantId: connection.tenantId,
      connectionId: connection.id,
      externalEventId: fields.eventId,
      eventType: fields.eventType,
      severity: fields.severity,
      occurredAt,
      customerCode: fields.customerCode,
      serialNumber: fields.serialNumber,
      payload: fields.payload,
      state: mapping.state === 'MATCHED' ? 'RECEIVED' : 'ERROR',
      bindingId: mapping.binding.id,
      errorCode: mapping.state === 'MATCHED' ? null : mapping.state,
      errorMessage: mapping.state === 'MATCHED' ? null : 'Vinculo de cliente/equipamento nao identificado de forma inequívoca.',
    },
  });
  if (io) io.to(connection.tenantId).emit('printguard_telemetry', { event: { ...event, mappingState: mapping.state } });
  return { event, duplicate: false, mapping };
}

async function listTelemetry(tenantId, query = {}) {
  const limit = Math.max(1, Math.min(Number(query.limit) || 40, 200));
  const where = { tenantId };
  if (query.status) where.state = String(query.status).toUpperCase();
  if (query.severity) where.severity = String(query.severity).toUpperCase();
  if (query.type) where.eventType = { contains: String(query.type), mode: 'insensitive' };
  if (query.from || query.to) {
    where.occurredAt = {};
    if (query.from && !Number.isNaN(new Date(query.from).getTime())) where.occurredAt.gte = new Date(query.from);
    if (query.to && !Number.isNaN(new Date(query.to).getTime())) where.occurredAt.lte = new Date(query.to);
    if (Object.keys(where.occurredAt).length === 0) delete where.occurredAt;
  }
  if (query.q) {
    const q = String(query.q);
    where.OR = [
      { eventType: { contains: q, mode: 'insensitive' } },
      { customerCode: { contains: q, mode: 'insensitive' } },
      { serialNumber: { contains: q, mode: 'insensitive' } },
      { externalEventId: { contains: q, mode: 'insensitive' } },
    ];
  }
  const [events, total, critical, open, monitoring] = await Promise.all([
    prisma.printGuardTelemetryEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: Math.max(0, Number(query.offset) || 0) }),
    prisma.printGuardTelemetryEvent.count({ where }),
    prisma.printGuardTelemetryEvent.count({ where: { ...where, severity: 'CRITICAL' } }),
    prisma.printGuardTelemetryEvent.count({ where: { ...where, state: 'RECEIVED' } }),
    prisma.printGuardTelemetryEvent.count({ where: { ...where, state: 'MONITORING' } }),
  ]);
  return {
    events: events.map((event) => ({ ...event, status: event.state, customer: event.customerCode ? { externalId: event.customerCode } : null, equipment: event.serialNumber ? { serialNumber: event.serialNumber } : null, measurement: event.payload?.measurement || event.payload?.reading || null, message: event.errorMessage || event.payload?.message || null })),
    total,
    summary: { total, critical, open, monitoring },
  };
}

async function eventAction(tenantId, eventId, action, body = {}) {
  const event = await prisma.printGuardTelemetryEvent.findFirst({ where: { tenantId, id: eventId }, include: { connection: true } });
  if (!event) { const error = new Error('Evento nao encontrado.'); error.statusCode = 404; throw error; }
  if (action === 'approve') return approveEvent(tenantId, event, body);
  const nextState = action === 'monitor' ? 'MONITORING' : 'IGNORED';
  const updated = await prisma.printGuardTelemetryEvent.update({ where: { id: event.id }, data: { state: nextState, errorCode: nextState === 'IGNORED' ? 'IGNORED_BY_USER' : null } });
  await notifyRemote(event.connection, event.externalEventId, action, body);
  return updated;
}

async function approveEvent(tenantId, event, body = {}) {
  if (event.state === 'IGNORED') { const error = new Error('Evento ignorado nao pode abrir O.S. sem reprocessamento.'); error.statusCode = 409; throw error; }
  if (event.serviceOrderId) return prisma.serviceOrder.findFirst({ where: { id: event.serviceOrderId, tenantId } });
  if (event.state !== 'RECEIVED' && event.state !== 'MONITORING') { const error = new Error('Evento sem vinculo inequívoco de cliente/equipamento.'); error.statusCode = 409; throw error; }

  const binding = event.bindingId ? await prisma.printGuardBinding.findFirst({ where: { id: event.bindingId, tenantId } }) : null;
  if (!binding?.customerId || !binding.equipmentId || binding.state !== 'MATCHED') { const error = new Error('Nao foi possivel localizar cliente e equipamento vinculados.'); error.statusCode = 409; throw error; }
  const crmEquipment = await prisma.crmEquipment.findFirst({ where: { id: binding.equipmentId, tenantId } });
  const localEquipment = crmEquipment?.externalId ? await prisma.equipment.findFirst({ where: { tenantId, externalSource: 'firebird', externalId: crmEquipment.externalId } }) : null;
  if (!localEquipment) { const error = new Error('Equipamento ainda nao sincronizado para abertura de O.S.'); error.statusCode = 409; throw error; }
  const contact = await prisma.contact.findFirst({ where: { tenantId, id: localEquipment.contactId } });
  if (!contact) { const error = new Error('Contato do equipamento nao encontrado.'); error.statusCode = 409; throw error; }
  const requestKey = `printguard:${event.id}`;
  const existing = await prisma.serviceOrder.findFirst({ where: { tenantId, requestKey } });
  if (existing) {
    await prisma.printGuardTelemetryEvent.update({ where: { id: event.id }, data: { state: 'APPROVED', serviceOrderId: existing.id, ticketId: existing.ticketId } });
    return existing;
  }
  const requestedOsType = String(body.cdOstp || '').trim();
  if (!requestedOsType) {
    const error = new Error('Informe explicitamente o tipo de O.S. para aprovar este evento.');
    error.statusCode = 400;
    throw error;
  }
  const osType = await prisma.crmOsType.findFirst({ where: { tenantId, code: requestedOsType } });
  if (!osType) { const error = new Error('Nenhum tipo de O.S. sincronizado no iLux.'); error.statusCode = 409; throw error; }
  const defect = String(body.defect || event.payload?.description || event.payload?.message || `Alerta PrintGuard ${event.eventType}`).trim().slice(0, 4000);
  const result = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({ data: { tenantId, contactId: contact.id, subject: defect.slice(0, 240), status: 'pending', priority: body.priority || 'medium' } });
    const serviceOrder = await tx.serviceOrder.create({ data: { tenantId, contactId: contact.id, equipmentId: localEquipment.id, ticketId: ticket.id, requestKey, externalSource: 'firebird', status: 'AGUARDANDO_ILUX', cdOstp: osType.code, nmsuportet: body.nmsuportet || null, defect } });
    await tx.printGuardTelemetryEvent.update({ where: { id: event.id }, data: { state: 'APPROVED', ticketId: ticket.id, serviceOrderId: serviceOrder.id, errorCode: null, errorMessage: null } });
    return serviceOrder;
  });
  await notifyRemote(event.connection, event.externalEventId, 'outcome', {
    status: 'resolved',
    resolution: 'Solicitacao de O.S. criada no Multiatendimento e enviada ao fluxo do iLux.',
    metadata: { serviceOrderId: result.id },
  });
  await notifyRemote(event.connection, event.externalEventId, 'ack', {
    status: 'acknowledged',
    note: 'APPROVED',
  });
  return result;
}

async function notifyRemote(connection, externalEventId, action, body = {}) {
  if (!connection?.externalId || !externalEventId) return { ok: false, skipped: true };
  const path = action === 'outcome' ? 'outcome' : 'ack';
  try {
    const payload = path === 'ack'
      ? { status: 'acknowledged', note: String(body.note || action).slice(0, 1000) }
      : body;
    await clientFor(connection).post(`/events/${encodeURIComponent(externalEventId)}/${path}`, payload);
    return { ok: true };
  } catch (error) {
    console.warn(`[printguard] falha ao registrar ${action}: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function fetchPage(connection, resource, cursor) {
  const params = cursor ? { cursor } : {};
  const response = await clientFor(connection).get(`/${resource}`, { params });
  const data = extractPayload(response.data);
  return { items: Array.isArray(data.items) ? data.items : [], nextCursor: data.nextCursor || null, hasMore: Boolean(data.hasMore) };
}

async function listRemote(tenantId, resource, cursor) {
  if (!['customers', 'equipment', 'events'].includes(resource)) throw new Error('Recurso PrintGuard invalido.');
  const connection = await getConnection(tenantId);
  if (!connection) throw new Error('Nenhuma conexao PrintGuard configurada.');
  return fetchPage(connection, resource, cursor);
}

async function syncEvents(tenantId) {
  const connection = await getConnection(tenantId);
  if (!connection) throw new Error('Nenhuma conexao PrintGuard configurada.');
  let cursor = connection.lastCursor || null;
  let processed = 0;
  let pages = 0;
  do {
    const page = await fetchPage(connection, 'events', cursor);
    pages += 1;
    for (const item of page.items) {
      const rawBody = Buffer.from(JSON.stringify(item));
      const fields = eventFields(item);
      if (!fields.eventId) continue;
      const duplicate = await prisma.printGuardTelemetryEvent.findUnique({ where: { connectionId_externalEventId: { connectionId: connection.id, externalEventId: fields.eventId } } });
      if (duplicate) continue;
      const mapping = await resolveMapping(tenantId, fields, connection.id);
      const occurredAt = fields.occurredAt && !Number.isNaN(new Date(fields.occurredAt).getTime())
        ? new Date(fields.occurredAt)
        : null;
      await prisma.printGuardTelemetryEvent.create({ data: { tenantId, connectionId: connection.id, externalEventId: fields.eventId, eventType: fields.eventType, severity: fields.severity, occurredAt, customerCode: fields.customerCode, serialNumber: fields.serialNumber, payload: item, state: mapping.state === 'MATCHED' ? 'RECEIVED' : 'ERROR', bindingId: mapping.binding.id, errorCode: mapping.state === 'MATCHED' ? null : mapping.state, errorMessage: mapping.state === 'MATCHED' ? null : 'Vinculo nao identificado.' } });
      processed += 1;
    }
    if (page.nextCursor) cursor = page.nextCursor;
    if (!page.hasMore || !page.nextCursor || pages >= 50) break;
  } while (true);
  await prisma.printGuardConnection.update({ where: { id: connection.id }, data: { lastCursor: cursor, lastTestAt: new Date(), status: 'CONNECTED', lastError: null } });
  return { processed, pages, nextCursor: cursor };
}

async function metrics(tenantId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [devices, readings24h, alerts, errors24h] = await Promise.all([
    prisma.printGuardBinding.count({ where: { tenantId, state: 'MATCHED' } }),
    prisma.printGuardTelemetryEvent.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.printGuardTelemetryEvent.count({ where: { tenantId, state: { in: ['RECEIVED', 'MONITORING'] } } }),
    prisma.printGuardTelemetryEvent.count({ where: { tenantId, createdAt: { gte: since }, state: 'ERROR' } }),
  ]);
  return { devices, readings24h, alerts, errors24h };
}

async function disconnect(tenantId) {
  const connection = await getConnection(tenantId);
  if (!connection) return null;
  const updated = await prisma.printGuardConnection.update({ where: { id: connection.id }, data: { status: 'INACTIVE', accessTokenCipher: null, webhookSecretCipher: null, lastError: null } });
  return secureConnection(updated);
}

module.exports = {
  setIo,
  getConnection,
  secureConnection,
  exchangePairing,
  testConnection,
  verifySignature,
  ingestWebhook,
  listTelemetry,
  eventAction,
  syncEvents,
  listRemote,
  metrics,
  disconnect,
};
