const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { syncOfficialEquipments } = require('../services/crmSyncService');

const EVENT_SOURCE = 'lcd_web';
const EVENT_ENTITY = 'events';
const EVENT_MAX_AGE_SECONDS = Math.max(30, Number.parseInt(process.env.LCD_WEB_EVENT_MAX_AGE_SECONDS, 10) || 300);
const EVENT_MAX_BYTES = 2 * 1024 * 1024;

let io = null;

function setIo(socketIo) {
  io = socketIo;
}

function text(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

function first(...values) {
  return values.find((value) => text(value)) ?? null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventSecret() {
  return text(process.env.LCD_WEB_EVENTS_SECRET || process.env.ILUX_WEB_SYNC_TOKEN);
}

function rawRequestBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  return Buffer.from(JSON.stringify(req.body || {}));
}

function safeEqualHex(expected, provided) {
  const normalized = String(provided || '').trim().replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(normalized, 'hex');
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function verifySignature(req) {
  const secret = eventSecret();
  const signature = req.header?.('x-lcd-web-signature') || req.headers?.['x-lcd-web-signature'];
  const timestamp = req.header?.('x-lcd-web-timestamp') || req.headers?.['x-lcd-web-timestamp'];
  if (!secret || !signature || !timestamp) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > EVENT_MAX_AGE_SECONDS) return false;

  const signed = `${Math.floor(timestampSeconds)}.${rawRequestBody(req).toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return safeEqualHex(expected, signature);
}

function canonicalEntity(body) {
  const raw = String(first(body.entity, body.resource, body.eventType) || '').toLowerCase();
  if (raw.includes('customer') || raw.includes('client') || raw.includes('cliente')) return 'customers';
  if (raw.includes('equipment') || raw.includes('equipamento')) return 'equipments';
  if (raw.includes('contract') || raw.includes('contrato')) return 'contracts';
  if (raw.includes('receivable') || raw.includes('financial') || raw.includes('financeiro') || raw.includes('billing')) return 'receivables';
  if (raw.includes('statement') || raw.includes('demonstrativo')) return 'billingStatements';
  if (raw.includes('service') || raw.includes('order') || raw.includes('os')) return 'serviceOrders';
  return text(body.entity) || 'unknown';
}

function customerFields(data, externalId, includeIdentity = true) {
  const raw = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const updatedAt = parseDate(first(raw.updatedAt, raw.atualizadoEm, raw.atualizado, raw.updated_at));
  const fields = {
    ...(includeIdentity ? { externalSource: EVENT_SOURCE, externalId: String(externalId) } : {}),
    name: first(raw.name, raw.nome, raw.legalName, raw.razaoSocial, raw.nmCliente)
      || (includeIdentity ? `Cliente ${externalId}` : null),
    fantasyName: first(raw.fantasyName, raw.nomeFantasia, raw.fantasia, raw.nmFantasia),
    cpfCnpj: first(raw.cpfCnpj, raw.document, raw.cnpj, raw.cpf),
    email: first(raw.email, raw.emailNf, raw.emailNF),
    phone: first(raw.phone, raw.telefone, raw.fone, raw.celular),
    address: first(raw.address, raw.endereco, raw.logradouro),
    neighborhood: first(raw.neighborhood, raw.bairro),
    city: first(raw.city, raw.cidade),
    state: first(raw.state, raw.uf),
    zipCode: first(raw.zipCode, raw.cep),
    contactName: first(raw.contactName, raw.contato, raw.nomeContato),
    notes: first(raw.notes, raw.observations, raw.observacao),
    raw,
    ...(updatedAt ? { externalUpdatedAt: updatedAt } : {}),
  };
  // LCD WEB can publish a patch containing only the changed fields. Do not
  // erase an existing CRM value just because it was absent from that patch.
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined));
}

async function resolveTenant(body, req) {
  const tenantId = text(body.tenantId || req.header?.('x-lcd-web-tenant-id'));
  const tenantSlug = text(body.tenantSlug || req.header?.('x-lcd-web-tenant'));
  if (!tenantId && !tenantSlug) return null;
  return prisma.tenant.findFirst({
    where: tenantId ? { id: tenantId } : { slug: tenantSlug },
    select: { id: true, slug: true, active: true },
  });
}

async function claimEvent(tenantId, eventId, payload) {
  const existing = await prisma.externalSyncRecord.findFirst({
    where: { tenantId, source: EVENT_SOURCE, entity: EVENT_ENTITY, externalId: eventId },
    select: { id: true, payload: true },
  });
  if (existing) return { duplicate: true, record: existing };

  try {
    const record = await prisma.externalSyncRecord.create({
      data: {
        tenantId,
        source: EVENT_SOURCE,
        entity: EVENT_ENTITY,
        externalId: eventId,
        payload: { ...payload, status: 'processing' },
      },
      select: { id: true, payload: true },
    });
    return { duplicate: false, record };
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const record = await prisma.externalSyncRecord.findFirst({
      where: { tenantId, source: EVENT_SOURCE, entity: EVENT_ENTITY, externalId: eventId },
      select: { id: true, payload: true },
    });
    return { duplicate: true, record };
  }
}

async function storeEntitySnapshot(tenantId, entity, externalId, data, occurredAt) {
  if (!externalId || entity === 'unknown' || entity === 'customers') return;
  await prisma.externalSyncRecord.upsert({
    where: {
      tenantId_source_entity_externalId: {
        tenantId,
        source: EVENT_SOURCE,
        entity,
        externalId: String(externalId),
      },
    },
    update: { payload: data || {}, syncedAt: occurredAt || new Date() },
    create: {
      tenantId,
      source: EVENT_SOURCE,
      entity,
      externalId: String(externalId),
      payload: data || {},
      receivedAt: occurredAt || new Date(),
      syncedAt: occurredAt || new Date(),
    },
  });
}

async function upsertCustomerSnapshot(tenantId, externalId, data, deleted = false) {
  if (!externalId) return null;
  if (deleted) {
    const current = await prisma.crmCustomer.findFirst({
      where: { tenantId, externalId: String(externalId) },
      orderBy: [{ externalSource: 'asc' }],
      select: { id: true, raw: true },
    });
    if (!current) return null;
    return prisma.crmCustomer.update({
      where: { id: current.id },
      data: { raw: { ...(current.raw || {}), sourceDeleted: true, deletedAt: new Date().toISOString() } },
      select: { id: true, externalId: true },
    });
  }

  // A customer imported from Firebird is the same customer that LCD WEB
  // exposes. Update that canonical mirror instead of creating a second
  // `lcd_web` customer for every event.
  const current = await prisma.crmCustomer.findFirst({
    where: { tenantId, externalId: String(externalId) },
    orderBy: [{ externalSource: 'asc' }],
    select: { id: true, raw: true },
  });
  if (current) {
    const fields = customerFields(data, externalId, false);
    const currentRaw = current.raw && typeof current.raw === 'object' && !Array.isArray(current.raw)
      ? current.raw
      : {};
    return prisma.crmCustomer.update({
      where: { id: current.id },
      data: { ...fields, raw: { ...currentRaw, ...(fields.raw || {}) } },
      select: { id: true, externalId: true },
    });
  }

  return prisma.crmCustomer.create({
    data: {
      tenantId,
      externalSource: 'firebird',
      externalId: String(externalId),
      ...customerFields(data, externalId, false),
    },
    select: { id: true, externalId: true },
  });
}

async function findCustomerForEvent(tenantId, externalId) {
  if (!externalId) return null;
  return prisma.crmCustomer.findFirst({
    where: { tenantId, externalId: String(externalId) },
    orderBy: [{ externalSource: 'asc' }],
    select: { id: true, externalId: true },
  });
}

async function handleLcdWebEvent(req, res) {
  let claimedRecord = null;
  try {
    if (!verifySignature(req)) return res.status(401).json({ error: 'Assinatura do evento LCD WEB invalida.' });

    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (rawRequestBody(req).length > EVENT_MAX_BYTES) return res.status(413).json({ error: 'Evento LCD WEB excede o limite permitido.' });

    const eventId = text(body.eventId || body.id || req.header?.('x-lcd-web-event-id'));
    const eventType = text(body.eventType || body.type || body.action);
    if (!eventId || !eventType) return res.status(400).json({ error: 'eventId e eventType sao obrigatorios.' });

    const tenant = await resolveTenant(body, req);
    if (!tenant || tenant.active === false) return res.status(404).json({ error: 'Tenant LCD WEB nao encontrado.' });

    const occurredAt = parseDate(body.occurredAt || body.updatedAt) || new Date();
    const entity = canonicalEntity(body);
    const data = body.data || body.payload || body.record || {};
    const entityId = text(body.entityId || body.externalId || data.externalId || data.id || data.seqReceita || data.seqdemonstrativo);
    const customerExternalId = text(
      body.customerExternalId,
      body.clientExternalId,
      data.customerExternalId,
      data.clientExternalId,
      data.cdcliente,
      entity === 'customers' ? entityId : null,
    );
    const claim = await claimEvent(tenant.id, eventId, {
      eventId,
      eventType,
      entity,
      entityId,
      customerExternalId,
      occurredAt: occurredAt.toISOString(),
      receivedAt: new Date().toISOString(),
    });
    if (claim.duplicate) return res.json({ ok: true, duplicate: true, eventId });
    claimedRecord = claim.record;

    const deleted = /(?:deleted|removed|exclu|remov)/i.test(eventType);
    let customer = entity === 'customers'
      ? await upsertCustomerSnapshot(tenant.id, entityId || customerExternalId, data, deleted)
      : null;
    await storeEntitySnapshot(tenant.id, entity, entityId, data, occurredAt);

    if (!customer && entity === 'equipments') {
      customer = await findCustomerForEvent(tenant.id, customerExternalId);
    }
    if (customer && ['customers', 'equipments'].includes(entity)) {
      await syncOfficialEquipments(tenant.id, customer.id).catch((error) => {
        console.warn(`[lcd-web-event] equipamentos nao atualizados para ${customer.externalId}:`, error.message);
      });
    }

    await prisma.externalSyncRecord.update({
      where: { id: claim.record.id },
      data: { payload: { ...claim.record.payload, status: 'success', processedAt: new Date().toISOString() } },
    });

    const realtime = {
      eventId,
      eventType,
      entity,
      entityId,
      customerExternalId,
      occurredAt: occurredAt.toISOString(),
      receivedAt: new Date().toISOString(),
    };
    io?.to(tenant.id).emit('lcd_web_update', realtime);
    return res.status(202).json({ ok: true, accepted: true, eventId });
  } catch (error) {
    if (claimedRecord?.id) {
      await prisma.externalSyncRecord.update({
        where: { id: claimedRecord.id },
        data: { payload: { ...(claimedRecord.payload || {}), status: 'failed', error: error.message } },
      }).catch(() => {});
    }
    console.error('[lcd-web-event] erro:', error.message);
    return res.status(error.statusCode || 500).json({ error: 'Nao foi possivel processar o evento LCD WEB.' });
  }
}

module.exports = { handleLcdWebEvent, setIo, verifySignature };
