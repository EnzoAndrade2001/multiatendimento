const axios = require('axios');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { encryptSecret, decryptSecret } = require('./printGuardCrypto');

const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_EVENT_BYTES = 512 * 1024;
const METER_HISTORY_PAGE_SIZE = 100;
const METER_HISTORY_MAX_PAGES = 50;
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
    lastMeterCursor: connection.lastMeterCursor,
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

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizePageCounter(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) return null;
  return Math.floor(number);
}

function normalizeReadAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeUsageCounters(value) {
  if (!isRecord(value)) return null;
  const result = {};
  // Counters are deliberately kept as a small JSON object. Ignore malformed
  // values instead of allowing an integration payload to poison CRM data.
  for (const [key, raw] of Object.entries(value).slice(0, 100)) {
    const name = String(key).trim().slice(0, 80);
    if (!name) continue;
    const number = normalizePageCounter(raw);
    if (number !== null) result[name] = number;
  }
  return Object.keys(result).length ? result : null;
}

function normalizeMeterSnapshot(input) {
  if (!isRecord(input)) return null;
  const nested = [
    input.meter,
    input.measurement?.meter,
    input.reading?.meter,
    input.payload?.meter,
    input.payload?.measurement?.meter,
  ].find(isRecord) || {};
  const pick = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  const pageCounter = normalizePageCounter(pick(
    nested.pageCounter,
    nested.page_counter,
    input.pageCounter,
    input.page_counter,
    input.payload?.pageCounter,
    input.payload?.page_counter,
  ));
  const usageCounters = normalizeUsageCounters(pick(
    nested.usageCounters,
    nested.usage_counters,
    input.usageCounters,
    input.usage_counters,
    input.payload?.usageCounters,
    input.payload?.usage_counters,
  ));
  const readAt = normalizeReadAt(pick(
    nested.readAt,
    nested.read_at,
    input.lastMeterReadAt,
    input.last_meter_read_at,
    input.readAt,
    input.read_at,
    input.payload?.lastMeterReadAt,
    input.payload?.last_meter_read_at,
    input.payload?.readAt,
    input.payload?.read_at,
  ));
  if (pageCounter === null && !usageCounters && !readAt) return null;
  return { pageCounter, usageCounters: usageCounters || {}, readAt };
}

function withMeterPayload(payload, meter) {
  const result = isRecord(payload) ? { ...payload } : {};
  if (!meter) return result;
  result.meter = meter;
  result.pageCounter = meter.pageCounter;
  result.usageCounters = meter.usageCounters;
  result.lastMeterReadAt = meter.readAt;
  // Keep aliases for integrations that still consume the original collector
  // naming while exposing one canonical snapshot to new consumers.
  result.page_counter = meter.pageCounter;
  result.usage_counters = meter.usageCounters;
  return result;
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
    meter: normalizeMeterSnapshot(source),
  };
}

function normalizeRemoteEquipment(item) {
  const result = isRecord(item) ? { ...item } : {};
  const meter = normalizeMeterSnapshot(result);
  return meter ? withMeterPayload(result, meter) : result;
}

async function updateCrmEquipmentMeter(tenantId, equipmentId, meter) {
  if (!equipmentId || !meter) return { updated: false, skipped: true };
  const equipment = await prisma.crmEquipment.findFirst({
    where: { id: equipmentId, tenantId },
    select: { id: true, raw: true, pageCounter: true, usageCounters: true, lastMeterReadAt: true },
  });
  if (!equipment) return { updated: false, skipped: true, reason: 'equipment_not_found' };

  const incomingReadAt = meter.readAt ? new Date(meter.readAt) : null;
  if (incomingReadAt && Number.isNaN(incomingReadAt.getTime())) return { updated: false, skipped: true, reason: 'invalid_read_at' };
  const currentReadAt = equipment.lastMeterReadAt ? new Date(equipment.lastMeterReadAt) : null;
  // A delayed webhook must never make the CRM show an older counter as the
  // current one. Equal timestamps are harmless and can refresh missing data.
  if (incomingReadAt && currentReadAt && incomingReadAt < currentReadAt) {
    return { updated: false, skipped: true, stale: true };
  }
  // Legacy collectors may omit the reading timestamp. In that case a lower
  // total is still stale; do not make the current CRM snapshot go backwards.
  if (!incomingReadAt && !currentReadAt
    && meter.pageCounter !== null && meter.pageCounter !== undefined
    && equipment.pageCounter !== null && equipment.pageCounter !== undefined
    && meter.pageCounter < equipment.pageCounter) {
    return { updated: false, skipped: true, stale: true };
  }

  const data = { meterSource: 'printguard' };
  if (meter.pageCounter !== null && meter.pageCounter !== undefined) data.pageCounter = meter.pageCounter;
  if (meter.usageCounters && Object.keys(meter.usageCounters).length) data.usageCounters = meter.usageCounters;
  if (incomingReadAt) data.lastMeterReadAt = incomingReadAt;
  const raw = isRecord(equipment.raw) ? equipment.raw : {};
  data.raw = {
    ...raw,
    printGuardMeter: {
      ...meter,
      receivedAt: new Date().toISOString(),
    },
  };
  await prisma.crmEquipment.update({ where: { id: equipment.id }, data });
  return { updated: true, stale: false };
}

async function resolveMapping(tenantId, fields, connectionId) {
  const customerCode = fields.customerCode;
  const serialNumber = fields.serialNumber;
  const existing = await prisma.printGuardBinding.findFirst({ where: { tenantId, connectionId, customerCode, serialNumber } });
  // Um vinculo confirmado por uma pessoa e a fonte de verdade para os sinais
  // seguintes. O resolvedor automatico nao pode desfazer essa decisao.
  if (existing?.source === 'MANUAL' && existing.state === 'MATCHED' && existing.customerId && existing.equipmentId) {
    const [customer, equipment, binding] = await Promise.all([
      prisma.crmCustomer.findFirst({ where: { tenantId, id: existing.customerId } }),
      prisma.crmEquipment.findFirst({ where: { tenantId, id: existing.equipmentId } }),
      prisma.printGuardBinding.update({ where: { id: existing.id }, data: { lastSeenAt: new Date() } }),
    ]);
    if (customer && equipment && (!equipment.customerId || equipment.customerId === customer.id)) {
      return { binding, state: 'MATCHED', customer, equipment };
    }
  }
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
  // Alguns coletores conhecem apenas a série. Quando ela identifica um único
  // equipamento, o próprio vínculo do equipamento é a fonte segura do cliente.
  if (!customer && equipment?.customerId) {
    customer = await prisma.crmCustomer.findFirst({
      where: { id: equipment.customerId, tenantId, externalSource: 'firebird' },
    });
  }
  if (customers.length > 1 || equipments.length > 1) state = 'AMBIGUOUS';
  else if (!customer && !equipment) state = 'UNMATCHED';
  else if (!customer) state = 'UNMATCHED_CUSTOMER';
  else if (!equipment) state = 'UNMATCHED_EQUIPMENT';
  else if (equipment.customerId && equipment.customerId !== customer.id) state = 'AMBIGUOUS';
  else state = 'MATCHED';

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
  await prisma.printGuardConnection.update({
    where: { id: connection.id },
    data: { status: 'CONNECTED', lastConnectedAt: new Date(), lastError: null },
  });
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
      payload: withMeterPayload(fields.payload, fields.meter),
      state: mapping.state === 'MATCHED' ? 'RECEIVED' : 'ERROR',
      bindingId: mapping.binding.id,
      errorCode: mapping.state === 'MATCHED' ? null : mapping.state,
      errorMessage: mapping.state === 'MATCHED' ? null : 'Vinculo de cliente/equipamento nao identificado de forma inequívoca.',
    },
  });
  if (mapping.state === 'MATCHED' && mapping.equipment && fields.meter) {
    await updateCrmEquipmentMeter(connection.tenantId, mapping.equipment.id, fields.meter);
  }
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
  const bindingIds = [...new Set(events.map((event) => event.bindingId).filter(Boolean))];
  const bindings = bindingIds.length
    ? await prisma.printGuardBinding.findMany({ where: { tenantId, id: { in: bindingIds } } })
    : [];
  const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
  const customerIds = [...new Set(bindings.map((binding) => binding.customerId).filter(Boolean))];
  const equipmentIds = [...new Set(bindings.map((binding) => binding.equipmentId).filter(Boolean))];
  const [customers, equipments] = await Promise.all([
    customerIds.length ? prisma.crmCustomer.findMany({ where: { tenantId, id: { in: customerIds } }, select: { id: true, name: true, externalId: true } }) : [],
    equipmentIds.length ? prisma.crmEquipment.findMany({ where: { tenantId, id: { in: equipmentIds } }, select: { id: true, model: true, serialNumber: true, externalId: true, isActive: true } }) : [],
  ]);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const equipmentById = new Map(equipments.map((equipment) => [equipment.id, equipment]));
  return {
    events: events.map((event) => {
      const binding = bindingById.get(event.bindingId);
      const customer = customerById.get(binding?.customerId) || event.payload?.customer || (event.customerCode ? { externalId: event.customerCode } : null);
      const equipment = equipmentById.get(binding?.equipmentId) || event.payload?.equipment || (event.serialNumber ? { serialNumber: event.serialNumber } : null);
      const mappingState = binding?.state || event.errorCode || 'UNMATCHED';
      return {
        ...event,
        status: event.state,
        customer,
        equipment,
        mappingState,
        canOpenServiceOrder: mappingState === 'MATCHED' && equipment?.isActive !== false,
        mappingMessage: mappingState === 'MATCHED'
          ? (equipment?.isActive === false ? 'Equipamento identificado, mas está inativo/fora de operação no iLux.' : 'Cliente e equipamento identificados no iLux.')
          : 'Cliente ou equipamento ainda não identificado no iLux.',
        measurement: event.payload?.measurement || event.payload?.reading || null,
        message: event.payload?.message || event.payload?.description || null,
      };
    }),
    total,
    summary: { total, critical, open, monitoring },
  };
}

function payloadObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function measurementLabel(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'object') return String(value).slice(0, 180);
  const source = payloadObject(value);
  const keys = ['level', 'supply', 'threshold', 'counter', 'pages', 'total', 'value'];
  const parts = keys
    .filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== '')
    .map((key) => `${key}: ${String(source[key])}`);
  return (parts.length ? parts.join(' · ') : JSON.stringify(source)).slice(0, 180);
}

function telemetrySeverityRank(value) {
  return { CRITICAL: 4, HIGH: 3, WARNING: 2, MEDIUM: 2, INFO: 1, LOW: 1 }[String(value || '').toUpperCase()] || 0;
}

function telemetryStateLabel(value) {
  return {
    RECEIVED: 'Aguardando decisão',
    MONITORING: 'Em monitoramento',
    ERROR: 'Falha de vínculo',
    IGNORED: 'Ignorado',
    APPROVED: 'O.S. aberta',
  }[String(value || '').toUpperCase()] || String(value || 'Desconhecido');
}

/**
 * Snapshot enxuto para gestores. A tela técnica continua usando listTelemetry;
 * este método só agrega a leitura recente em indicadores e uma fila acionável,
 * sem expor o payload bruto do PrintGuard.
 */
async function managerSnapshot(tenantId, options = {}) {
  const hours = Math.max(1, Math.min(Number(options.hours) || 24, 168));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const connection = await getConnection(tenantId);
  if (!connection) {
    return {
      available: false,
      connectionStatus: 'INACTIVE',
      connectionName: null,
      lastConnectedAt: null,
      lastSignalAt: null,
      windowHours: hours,
      total: 0,
      critical: 0,
      awaitingDecision: 0,
      monitoring: 0,
      errors: 0,
      unlinked: 0,
      lowToner: 0,
      affectedEquipment: 0,
      incidents: [],
      message: 'Nenhuma conexao PrintGuard configurada para esta empresa.',
    };
  }

  const activeWhere = {
    tenantId,
    createdAt: { gte: since },
    state: { in: ['RECEIVED', 'MONITORING', 'ERROR'] },
  };
  const [events, total, critical, awaitingDecision, monitoring, errors] = await Promise.all([
    prisma.printGuardTelemetryEvent.findMany({
      where: activeWhere,
      select: {
        id: true,
        eventType: true,
        severity: true,
        occurredAt: true,
        createdAt: true,
        state: true,
        customerCode: true,
        serialNumber: true,
        payload: true,
        bindingId: true,
        errorCode: true,
        errorMessage: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.printGuardTelemetryEvent.count({ where: activeWhere }),
    prisma.printGuardTelemetryEvent.count({ where: { ...activeWhere, severity: { in: ['CRITICAL', 'HIGH'] } } }),
    prisma.printGuardTelemetryEvent.count({ where: { ...activeWhere, state: 'RECEIVED' } }),
    prisma.printGuardTelemetryEvent.count({ where: { ...activeWhere, state: 'MONITORING' } }),
    prisma.printGuardTelemetryEvent.count({ where: { ...activeWhere, state: 'ERROR' } }),
  ]);

  const bindingIds = [...new Set(events.map((event) => event.bindingId).filter(Boolean))];
  const bindings = bindingIds.length
    ? await prisma.printGuardBinding.findMany({ where: { tenantId, id: { in: bindingIds } } })
    : [];
  const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
  const customerIds = [...new Set(bindings.map((binding) => binding.customerId).filter(Boolean))];
  const equipmentIds = [...new Set(bindings.map((binding) => binding.equipmentId).filter(Boolean))];
  const [customers, equipments] = await Promise.all([
    customerIds.length
      ? prisma.crmCustomer.findMany({ where: { tenantId, id: { in: customerIds } }, select: { id: true, name: true, externalId: true } })
      : [],
    equipmentIds.length
      ? prisma.crmEquipment.findMany({ where: { tenantId, id: { in: equipmentIds } }, select: { id: true, model: true, serialNumber: true, externalId: true, isActive: true, pageCounter: true, usageCounters: true, lastMeterReadAt: true, meterSource: true } })
      : [],
  ]);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const equipmentById = new Map(equipments.map((equipment) => [equipment.id, equipment]));

  const incidents = events.map((event) => {
    const binding = bindingById.get(event.bindingId);
    const rawPayload = payloadObject(event.payload);
    const customer = customerById.get(binding?.customerId) || rawPayload.customer || null;
    const equipment = equipmentById.get(binding?.equipmentId) || rawPayload.equipment || null;
    const mappingState = binding?.state || (event.state === 'ERROR' ? event.errorCode : null) || 'UNMATCHED';
    const signalAt = event.occurredAt || event.createdAt;
    const eventType = String(event.eventType || 'telemetry');
    const lowerType = eventType.toLowerCase();
    const measurement = rawPayload.measurement ?? rawPayload.reading ?? rawPayload.counter ?? rawPayload.pages;
    const meter = rawPayload.meter || (measurement && typeof measurement === 'object' ? measurement.meter : null)
      || (equipment && equipment.pageCounter !== undefined
        ? {
          pageCounter: equipment.pageCounter ?? null,
          usageCounters: equipment.usageCounters && typeof equipment.usageCounters === 'object' && !Array.isArray(equipment.usageCounters) ? equipment.usageCounters : {},
          readAt: equipment.lastMeterReadAt || null,
          source: equipment.meterSource || null,
        }
        : null);
    const canOpenServiceOrder = mappingState === 'MATCHED' && equipment?.isActive !== false;
    const signalTimestamp = signalAt ? new Date(signalAt).getTime() : NaN;
    return {
      id: event.id,
      eventType,
      severity: String(event.severity || 'INFO').toUpperCase(),
      state: event.state,
      stateLabel: telemetryStateLabel(event.state),
      occurredAt: signalAt,
      ageMinutes: Number.isFinite(signalTimestamp)
        ? Math.max(0, Math.floor((Date.now() - signalTimestamp) / 60000))
        : null,
      customerName: customer?.name || rawPayload.customerName || event.customerCode || 'Cliente nao identificado',
      customerExternalId: customer?.externalId || event.customerCode || null,
      equipmentModel: equipment?.model || rawPayload.equipmentModel || null,
      serialNumber: equipment?.serialNumber || event.serialNumber || null,
      measurement: measurementLabel(measurement),
      meter,
      message: String(rawPayload.message || rawPayload.description || event.errorMessage || '').slice(0, 240) || null,
      mappingState,
      canOpenServiceOrder,
      action: canOpenServiceOrder ? 'Abrir O.S.' : mappingState === 'MATCHED' ? 'Ver detalhes' : 'Revisar vinculo',
      isLowToner: /toner|toner_low|supply|cartucho|insumo/.test(lowerType),
    };
  });

  incidents.sort((a, b) => {
    const severityDelta = telemetrySeverityRank(b.severity) - telemetrySeverityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  });
  const activeIncidents = incidents.filter((event) => event.state !== 'IGNORED' && event.state !== 'APPROVED');
  const uniqueEquipment = new Set(activeIncidents.map((event) => event.serialNumber || event.equipmentModel).filter(Boolean));
  const unlinked = activeIncidents.filter((event) => event.mappingState !== 'MATCHED').length;
  const lowToner = activeIncidents.filter((event) => event.isLowToner).length;
  const lastSignalAt = events.reduce((latest, event) => {
    const candidate = event.occurredAt || event.createdAt;
    if (!candidate) return latest;
    return !latest || new Date(candidate) > new Date(latest) ? candidate : latest;
  }, null);

  return {
    available: connection.status === 'CONNECTED',
    connectionStatus: connection.status,
    connectionName: connection.name,
    lastConnectedAt: connection.lastConnectedAt,
    lastSignalAt,
    windowHours: hours,
    total,
    critical,
    awaitingDecision,
    monitoring,
    errors,
    unlinked,
    lowToner,
    affectedEquipment: uniqueEquipment.size,
    incidents: activeIncidents.slice(0, 8),
    truncated: total > events.length,
    message: connection.status === 'CONNECTED'
      ? null
      : (connection.lastError || 'A conexao PrintGuard nao esta marcada como conectada.'),
  };
}

const clip = (value, max = 2000) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

const IGNORE_REASONS = new Set([
  'FALSE_POSITIVE', 'ALREADY_SUPPLIED', 'OPEN_ORDER', 'DUPLICATE', 'EQUIPMENT_INACTIVE', 'NO_CONTRACT', 'OTHER',
]);

async function eventAction(tenantId, eventId, action, body = {}, actorId = null) {
  const event = await prisma.printGuardTelemetryEvent.findFirst({ where: { tenantId, id: eventId }, include: { connection: true } });
  if (!event) { const error = new Error('Evento nao encontrado.'); error.statusCode = 404; throw error; }
  if (action === 'approve') return approveEvent(tenantId, event, body);

  let assignedToId;
  if (action === 'monitor' && body.assignedToId) {
    const user = await prisma.user.findFirst({ where: { tenantId, id: String(body.assignedToId), active: true }, select: { id: true } });
    if (!user) { const error = new Error('Responsavel nao pertence a esta empresa ou esta inativo.'); error.statusCode = 400; throw error; }
    assignedToId = user.id;
  }

  let ignoredReason = null;
  if (action === 'ignore') {
    const reason = String(body.reason ?? '').trim().toUpperCase();
    const note = String(body.note ?? '').trim();
    // Motivo e opcional (a fila legada ignora sem motivo), mas quando vier tem
    // de ser um codigo conhecido; "OUTRO" exige a observacao como complemento.
    if (reason && !IGNORE_REASONS.has(reason)) { const error = new Error('Motivo de descarte invalido.'); error.statusCode = 400; throw error; }
    if (reason === 'OTHER' && !note) { const error = new Error('Descreva o motivo na observacao para usar "Outro".'); error.statusCode = 400; throw error; }
    ignoredReason = clip([reason, note].filter(Boolean).join(' — '));
  }

  const base = { decisionAt: new Date(), decisionById: actorId || event.decisionById };
  const data = action === 'monitor'
    ? {
      ...base,
      state: 'MONITORING',
      monitoringUntil: body.monitoringUntil ? new Date(body.monitoringUntil) : null,
      monitoringCondition: clip(body.monitoringCondition),
      ...(body.nextStep !== undefined ? { nextStep: clip(body.nextStep) } : {}),
      ...(assignedToId ? { assignedToId } : {}),
    }
    : {
      ...base,
      state: 'IGNORED',
      errorCode: 'IGNORED_BY_USER',
      ignoredReason,
    };

  const updated = await prisma.printGuardTelemetryEvent.update({ where: { id: event.id }, data });
  await notifyRemote(event.connection, event.externalEventId, action, body);

  // Avisa o responsavel do monitoramento pelo chat interno (best-effort).
  if (action === 'monitor' && assignedToId && actorId && assignedToId !== actorId && assignedToId !== event.assignedToId) {
    try {
      const ctx = (body.context && typeof body.context === 'object') ? body.context : {};
      const dueTxt = updated.monitoringUntil
        ? new Date(updated.monitoringUntil).toLocaleString('pt-BR', { timeZone: process.env.APP_TIMEZONE || 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
        : 'sem prazo';
      const bodyText = [
        '🖨️ Monitoramento sob sua responsabilidade — *Saúde do Parque*.',
        '',
        `Cliente: ${ctx.customer || 'não identificado'}`,
        `Equipamento: ${ctx.equipment || 'não identificado'}`,
        `Reavaliar até: ${dueTxt}`,
        updated.monitoringCondition ? `Condição de escalonamento: ${updated.monitoringCondition}` : null,
        updated.nextStep ? `Próximo passo: ${updated.nextStep}` : null,
        '',
        'A ocorrência volta para a fila de decisão ao vencer o prazo.',
      ].filter((line) => line !== null).join('\n');
      const internal = require('../controllers/internalMessageController');
      await internal.notifyUser({ tenantId, fromUserId: actorId, toUserId: assignedToId, body: bodyText });
    } catch (error) {
      console.error('[printGuard] aviso de monitoramento falhou:', error.message);
    }
  }
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

async function fetchPage(connection, resource, cursor, { limit } = {}) {
  const params = {};
  if (cursor) params.cursor = cursor;
  if (limit) params.limit = limit;
  const response = await clientFor(connection).get(`/${resource}`, { params });
  const data = extractPayload(response.data);
  return { items: Array.isArray(data.items) ? data.items : [], nextCursor: data.nextCursor || null, hasMore: Boolean(data.hasMore) };
}

async function listRemote(tenantId, resource, cursor) {
  if (!['customers', 'equipment', 'equipment-readings', 'events'].includes(resource)) throw new Error('Recurso PrintGuard invalido.');
  const connection = await getConnection(tenantId);
  if (!connection) throw new Error('Nenhuma conexao PrintGuard configurada.');
  const page = await fetchPage(connection, resource, cursor);
  if (resource === 'equipment-readings') {
    return {
      ...page,
      items: page.items.map((item) => {
        const meter = normalizeMeterSnapshot(item);
        return meter ? withMeterPayload(item, meter) : item;
      }),
    };
  }
  if (resource !== 'equipment') return page;
  return { ...page, items: page.items.map(normalizeRemoteEquipment) };
}

function truncateToUtcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function meterReadingValue(meter) {
  if (!meter) return null;
  if (meter.pageCounter !== null && meter.pageCounter !== undefined) return normalizePageCounter(meter.pageCounter);
  const usage = isRecord(meter.usageCounters) ? meter.usageCounters : {};
  const fallback = usage.general ?? usage.total ?? usage.overall;
  return normalizePageCounter(fallback);
}

async function persistCrmMeterReading(tenantId, equipment, item, meter) {
  if (!equipment?.externalId || !meter) return { stored: false, skipped: true, reason: 'missing_equipment_or_meter' };
  const value = meterReadingValue(meter);
  const readAt = truncateToUtcDay(meter.readAt);
  if (value === null || !readAt) return { stored: false, skipped: true, reason: 'missing_page_counter_or_read_at' };

  const meterCode = 'page_total';
  const key = {
    tenantId,
    equipmentExternalId: String(equipment.externalId),
    meterCode,
    readAt,
  };
  const previous = await prisma.crmMeterReading.findFirst({
    where: {
      tenantId,
      equipmentExternalId: String(equipment.externalId),
      meterCode,
      readAt: { lt: readAt },
    },
    orderBy: { readAt: 'desc' },
    select: { reading: true, readAt: true },
  });
  const data = {
    serialNumber: equipment.serialNumber || null,
    meterName: 'Contador geral',
    reading: value,
    usageCounters: meter.usageCounters && Object.keys(meter.usageCounters).length
      ? meter.usageCounters
      : null,
    previousReading: previous?.reading ?? null,
    previousReadAt: previous?.readAt ?? null,
    source: 'printguard',
  };
  await prisma.crmMeterReading.upsert({
    where: { tenantId_equipmentExternalId_meterCode_readAt: key },
    update: data,
    create: { ...key, ...data },
  });
  return { stored: true, skipped: false, readAt };
}

async function syncRemoteMeterHistory(tenantId, connection) {
  let cursor = connection.lastMeterCursor || null;
  let pages = 0;
  let processed = 0;
  let stored = 0;
  let unmatched = 0;
  let skipped = 0;
  let hasMore = false;
  do {
    const page = await fetchPage(connection, 'equipment-readings', cursor, { limit: METER_HISTORY_PAGE_SIZE });
    pages += 1;
    for (const item of page.items) {
      const fields = eventFields(item);
      const meter = normalizeMeterSnapshot(item);
      if (!meter) {
        skipped += 1;
        continue;
      }
      processed += 1;
      if (!fields.serialNumber && !fields.customerCode) {
        unmatched += 1;
        continue;
      }
      const mapping = await resolveMapping(tenantId, fields, connection.id);
      if (mapping.state !== 'MATCHED' || !mapping.equipment) {
        unmatched += 1;
        continue;
      }
      const result = await persistCrmMeterReading(tenantId, mapping.equipment, item, meter);
      if (result.stored) stored += 1;
      else skipped += 1;
    }
    if (page.nextCursor) cursor = page.nextCursor;
    hasMore = Boolean(page.hasMore && page.nextCursor);
    if (!hasMore || pages >= METER_HISTORY_MAX_PAGES) break;
  } while (true);
  await prisma.printGuardConnection.update({ where: { id: connection.id }, data: { lastMeterCursor: cursor } });
  return { processed, stored, unmatched, skipped, pages, nextCursor: cursor, hasMore };
}

async function syncRemoteEquipmentMeters(tenantId, connection) {
  let cursor = null;
  let pages = 0;
  let processed = 0;
  let updated = 0;
  let unmatched = 0;
  do {
    const page = await fetchPage(connection, 'equipment', cursor);
    pages += 1;
    for (const item of page.items) {
      const fields = eventFields(item);
      if (!fields.meter) continue;
      processed += 1;
      if (!fields.serialNumber && !fields.customerCode) {
        unmatched += 1;
        continue;
      }
      const mapping = await resolveMapping(tenantId, fields, connection.id);
      if (mapping.state !== 'MATCHED' || !mapping.equipment) {
        unmatched += 1;
        continue;
      }
      const result = await updateCrmEquipmentMeter(tenantId, mapping.equipment.id, fields.meter);
      if (result.updated) updated += 1;
    }
    if (page.nextCursor) cursor = page.nextCursor;
    if (!page.hasMore || !page.nextCursor || pages >= 50) break;
  } while (true);
  return { processed, updated, unmatched, pages };
}

async function syncEvents(tenantId) {
  const connection = await getConnection(tenantId);
  if (!connection) throw new Error('Nenhuma conexao PrintGuard configurada.');
  let equipment = { processed: 0, updated: 0, unmatched: 0, pages: 0 };
  let equipmentError = null;
  try {
    // Equipment snapshots use an independent cursor because the PrintGuard
    // equipment endpoint is a current-state view, while events are append-only.
    equipment = await syncRemoteEquipmentMeters(tenantId, connection);
  } catch (error) {
    // A temporary equipment endpoint failure must not block historical alert
    // synchronization. The result exposes the diagnostic to administrators.
    equipmentError = String(error.message || error).slice(0, 500);
  }
  let meterHistory = { processed: 0, stored: 0, unmatched: 0, skipped: 0, pages: 0, nextCursor: connection.lastMeterCursor || null, hasMore: false };
  let meterHistoryError = null;
  try {
    // Historical readings are independent from the current equipment
    // snapshot. They are consumed with their own cursor so a large history
    // never forces a full replay on every synchronization.
    meterHistory = await syncRemoteMeterHistory(tenantId, connection);
  } catch (error) {
    meterHistoryError = String(error.message || error).slice(0, 500);
  }
  let cursor = connection.lastCursor || null;
  let processed = 0;
  let reconciled = 0;
  let pages = 0;
  const pendingMappings = await prisma.printGuardTelemetryEvent.findMany({
    where: { tenantId, connectionId: connection.id, state: { in: ['ERROR', 'MONITORING'] } },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  for (const stored of pendingMappings) {
    const mapping = await resolveMapping(tenantId, eventFields(stored), connection.id);
    if (mapping.state !== 'MATCHED') continue;
    await prisma.printGuardTelemetryEvent.update({
      where: { id: stored.id },
      data: {
        bindingId: mapping.binding.id,
        state: stored.state === 'MONITORING' ? 'MONITORING' : 'RECEIVED',
        errorCode: null,
        errorMessage: null,
      },
    });
    const storedFields = eventFields(stored);
    if (mapping.equipment && storedFields.meter) {
      await updateCrmEquipmentMeter(tenantId, mapping.equipment.id, storedFields.meter);
    }
    reconciled += 1;
  }
  do {
    const page = await fetchPage(connection, 'events', cursor);
    pages += 1;
    for (const item of page.items) {
      const fields = eventFields(item);
      if (!fields.eventId) continue;
      const duplicate = await prisma.printGuardTelemetryEvent.findUnique({ where: { connectionId_externalEventId: { connectionId: connection.id, externalEventId: fields.eventId } } });
      if (duplicate) continue;
      const mapping = await resolveMapping(tenantId, fields, connection.id);
      const occurredAt = fields.occurredAt && !Number.isNaN(new Date(fields.occurredAt).getTime())
        ? new Date(fields.occurredAt)
        : null;
      await prisma.printGuardTelemetryEvent.create({ data: { tenantId, connectionId: connection.id, externalEventId: fields.eventId, eventType: fields.eventType, severity: fields.severity, occurredAt, customerCode: fields.customerCode, serialNumber: fields.serialNumber, payload: withMeterPayload(item, fields.meter), state: mapping.state === 'MATCHED' ? 'RECEIVED' : 'ERROR', bindingId: mapping.binding.id, errorCode: mapping.state === 'MATCHED' ? null : mapping.state, errorMessage: mapping.state === 'MATCHED' ? null : 'Vinculo nao identificado.' } });
      if (mapping.state === 'MATCHED' && mapping.equipment && fields.meter) {
        await updateCrmEquipmentMeter(tenantId, mapping.equipment.id, fields.meter);
      }
      processed += 1;
    }
    if (page.nextCursor) cursor = page.nextCursor;
    if (!page.hasMore || !page.nextCursor || pages >= 50) break;
  } while (true);
  await prisma.printGuardConnection.update({ where: { id: connection.id }, data: { lastCursor: cursor, lastTestAt: new Date(), lastConnectedAt: new Date(), status: 'CONNECTED', lastError: null } });
  return { processed, reconciled, pages, nextCursor: cursor, equipment, equipmentError, meterHistory, meterHistoryError };
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
  normalizeMeterSnapshot,
  normalizeRemoteEquipment,
  exchangePairing,
  testConnection,
  verifySignature,
  ingestWebhook,
  listTelemetry,
  managerSnapshot,
  eventAction,
  notifyRemote,
  syncEvents,
  syncRemoteMeterHistory,
  persistCrmMeterReading,
  listRemote,
  metrics,
  disconnect,
};
