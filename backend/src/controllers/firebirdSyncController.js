const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { requestIdentity } = require('../middlewares/firebirdPendingRateLimit');
const evolutionService = require('../services/evolutionService');
const { sendServiceOrderManagerCopy } = require('../services/serviceOrderManagerCopyService');
const { mapEquipmentType } = require('../utils/equipmentMapper');
const { mediaPath } = require('../utils/uploads');
const billingDocumentService = require('../services/billingDocumentService');
const { COMPANY_ENTITY, COMPANY_REQUEST_ENTITY, normalizeCompanyProfile } = require('../services/companyProfileService');
const { encryptSecret } = require('../services/printGuardCrypto');
const { normalizeServiceOrderStatus } = require('../utils/serviceOrderStatus');
const { parseFirebirdDate } = require('../utils/firebirdDate');
const agentController = require('./agentController');
const { isOutdated } = require('../utils/agentVersion');

// Mantem o nome usado pelos normalizadores legados, mas com a semantica
// correta para datas Firebird sem fuso (horario local de Sao Paulo).
const normalizeDate = parseFirebirdDate;

const RECEIVABLE_SNAPSHOT_ENTITY = 'receivablesSnapshot';
const EQUIPMENT_SNAPSHOT_ENTITY = 'equipmentsSnapshot';
const TECHNICIAN_SNAPSHOT_ENTITY = 'techniciansSnapshot';
const SERVICE_ORDER_OPEN_SNAPSHOT_ENTITY = 'serviceOrdersOpenSnapshot';

// Authentication failures are actionable, but logging every retry from a
// broken agent can consume more CPU/IO than the request itself. Keep one
// diagnostic per key/message per minute and include enough metadata to find
// the offending installation without ever logging the raw credential.
const pendingCommandErrorLog = new Map();
const PENDING_COMMAND_ERROR_LOG_WINDOW_MS = 60 * 1000;

function logPendingCommandError(req, err) {
  const identity = requestIdentity(req);
  const message = String(err?.message || err || 'erro desconhecido');
  const key = `${identity.key}:${message}`;
  const now = Date.now();
  const previous = pendingCommandErrorLog.get(key);

  if (previous && now - previous.lastLoggedAt < PENDING_COMMAND_ERROR_LOG_WINDOW_MS) {
    previous.count += 1;
    return;
  }

  if (pendingCommandErrorLog.size > 1000) {
    for (const [entryKey, entry] of pendingCommandErrorLog) {
      if (now - entry.lastLoggedAt >= PENDING_COMMAND_ERROR_LOG_WINDOW_MS) {
        pendingCommandErrorLog.delete(entryKey);
      }
    }
  }

  const repeated = previous?.count || 0;
  pendingCommandErrorLog.set(key, { lastLoggedAt: now, count: 0 });
  console.error('[pending-commands] erro', {
    message,
    repeatedSinceLastLog: repeated,
    tokenFingerprint: identity.tokenFingerprint,
    tenantSlug: identity.tenantSlug,
    ip: identity.ip,
    agentId: identity.agentId,
    agentVersion: identity.agentVersion,
  });
}

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

// `pick` estringa tudo, entao um booleano `inactive` do agente chega como
// 'true'/'false'; `tfinativo` legado chega como 'S'/'N'.
function isInactiveFlag(value) {
  return ['1', 'S', 'SIM', 'TRUE', 'Y', 'YES'].includes(String(value ?? '').trim().toUpperCase());
}

function normalizeEquipmentOwner(value) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!code) return null;
  if (code === 'C' || code === 'CLIENTE') return 'CLIENTE';
  if (code === 'E' || code === 'EMPRESA') return 'EMPRESA';
  return code;
}

function normalizePhone(value, fallback) {
  const phone = evolutionService.normalizePhoneNumber(value);
  if (phone) return phone;
  return fallback ? `FB-${fallback}` : null;
}

function normalizeStatus(value) {
  return normalizeServiceOrderStatus(value);
}

function comparableText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isImportedServiceOrderMirror(pending, holder, seqOs) {
  if (!pending || !holder) return false;
  if (pending.id === holder.id || pending.externalId) return false;
  if (String(holder.externalId || '') !== String(seqOs || '')) return false;
  if (holder.externalSource !== 'firebird') return false;
  // Um registro importado pelo historico nao carrega os vinculos exclusivos
  // da solicitacao feita no CRM.
  if (holder.requestKey || holder.ticketId || holder.userId) return false;
  if (!pending.equipmentId || pending.equipmentId !== holder.equipmentId) return false;

  const pendingDefect = comparableText(pending.defect);
  const holderDefect = comparableText(holder.defect);
  if (pendingDefect && holderDefect && pendingDefect !== holderDefect) return false;

  const pendingCreatedAt = new Date(pending.createdAt).getTime();
  const holderCreatedAt = new Date(holder.createdAt).getTime();
  return Number.isFinite(pendingCreatedAt)
    && Number.isFinite(holderCreatedAt)
    && Math.abs(holderCreatedAt - pendingCreatedAt) <= 10 * 60 * 1000;
}

async function mergeImportedServiceOrderMirror(tenantId, pending, holder, seqOs) {
  if (!isImportedServiceOrderMirror(pending, holder, seqOs)) return null;
  return prisma.$transaction(async (tx) => {
    // Exclui apenas o espelho sem ticket/requestKey. O registro original
    // preserva auditoria, atendente, conversa e a chave idempotente.
    await tx.serviceOrder.delete({ where: { id: holder.id, tenantId } });
    return tx.serviceOrder.update({
      where: { id: pending.id, tenantId },
      data: {
        externalId: String(seqOs),
        status: 'PENDENTE',
      },
    });
  });
}

function firebirdTokenFromRequest(req) {
  const headerToken = typeof req?.header === 'function' ? req.header('x-firebird-token') : undefined;
  const authorization = typeof req?.header === 'function' ? req.header('authorization') : undefined;
  return String(headerToken || String(authorization || '').replace(/^Bearer\s+/i, '') || '').trim();
}

function tenantResolutionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Resolve the tenant for Firebird agents.
 *
 * New agents may send the slug explicitly, but older packages only know the
 * opaque client token. In that case the token is used as the tenant binding;
 * it must match exactly one TenantSettings row. Ambiguous tokens fail closed
 * instead of guessing a company.
 */
async function resolveTenantContext(tenantSlug, req, { requireInstance = true } = {}) {
  const normalizedSlug = String(tenantSlug || '').trim();
  const providedToken = firebirdTokenFromRequest(req);
  let tenant;

  // O token é a credencial e o vínculo inequívoco da instalação. Primeiro
  // preservamos a consulta por slug quando ele já pertence ao mesmo token;
  // se o agente foi reaproveitado com o slug de outra empresa, resolvemos pelo
  // token e ignoramos o valor antigo.
  if (normalizedSlug) {
    tenant = await prisma.tenant.findUnique({
      where: { slug: normalizedSlug },
      include: { settings: true, instances: true },
    });
    if (tenant && providedToken && resolveToken(tenant) !== providedToken) {
      tenant = null;
    }
  }

  if (!tenant && providedToken) {
    const matches = await prisma.tenantSettings.findMany({
      where: { firebirdClientToken: providedToken },
      include: { tenant: { include: { settings: true, instances: true } } },
      take: 2,
    });

    if (matches.length > 1) {
      throw tenantResolutionError('Token de sincronização associado a mais de uma empresa; informe o tenantSlug.', 409);
    }
    if (matches.length === 1) {
      tenant = matches[0].tenant;
    }
  }

  if (!tenant) {
    if (providedToken) {
      throw tenantResolutionError('Não foi possível identificar a empresa pelo token de sincronização.', 401);
    }
    throw tenantResolutionError('tenantSlug é obrigatório quando o token de sincronização não foi informado.', 400);
  }

  const instance =
    tenant.instances.find((item) => String(item.status).toLowerCase() === 'connected') ||
    tenant.instances[0];

  if (requireInstance && !instance) {
    throw tenantResolutionError('Nenhuma instância de WhatsApp encontrada para esse tenant.', 422);
  }

  return { tenant, instance };
}

function resolveToken(tenant) {
  return tenant?.settings?.firebirdClientToken || process.env.FIREBIRD_SYNC_TOKEN || '';
}

function assertToken(req, tenant) {
  const expected = resolveToken(tenant);
  const provided = req.header('x-firebird-token') || req.header('authorization')?.replace(/^Bearer\s+/i, '');

  if (!expected) {
    throw tenantResolutionError('Token de sincronização não configurado no CRM.', 503);
  }

  if (!provided || provided !== expected) {
    throw tenantResolutionError('Token de sincronização inválido.', 401);
  }
}

async function upsertRawRecord(tenantId, source, entity, externalId, payload) {
  const safeExternalId = externalId || crypto.randomUUID();
  await prisma.externalSyncRecord.upsert({
    where: {
      tenantId_source_entity_externalId: {
        tenantId,
        source,
        entity,
        externalId: safeExternalId,
      },
    },
    update: {
      payload,
      syncedAt: new Date(),
    },
    create: {
      tenantId,
      source,
      entity,
      externalId: safeExternalId,
      payload,
      syncedAt: new Date(),
    },
  });
  return safeExternalId;
}

async function reconcileReceivablesSnapshot(tenantId, snapshot) {
  const externalIds = [...new Set((snapshot?.externalIds || []).map(String).filter((value) => /^\d+$/.test(value)))];
  const minExternalId = Number(snapshot?.minExternalId);
  const maxExternalId = Number(snapshot?.maxExternalId);
  const declaredCount = Number(snapshot?.count);
  if (!snapshot?.completeWindow || !externalIds.length
    || !Number.isSafeInteger(minExternalId) || !Number.isSafeInteger(maxExternalId)
    || minExternalId <= 0 || maxExternalId < minExternalId
    || declaredCount !== externalIds.length) {
    throw new Error('Snapshot de titulos invalido ou incompleto; reconciliacao ignorada por seguranca.');
  }

  const present = new Set(externalIds);
  const cached = await prisma.externalSyncRecord.findMany({
    where: { tenantId, source: 'firebird', entity: 'receivables' },
    select: { id: true, externalId: true, payload: true },
  });
  const missing = cached.filter((record) => {
    const numericId = Number(record.externalId);
    return Number.isSafeInteger(numericId)
      && numericId >= minExternalId
      && numericId <= maxExternalId
      && !present.has(String(record.externalId))
      && !record.payload?.sourceDeleted;
  });
  const sourceDeletedAt = snapshot.capturedAt || new Date().toISOString();
  for (const record of missing) {
    await prisma.externalSyncRecord.update({
      where: { id: record.id },
      data: { payload: { ...(record.payload || {}), sourceDeleted: true, sourceDeletedAt } },
    });
  }
  return missing.length;
}

// Desativa no CRM os equipamentos que o agente nao reporta mais dentro da janela
// autoritativa (removidos de vez do iLux ou movidos para outro tenant). Nunca
// apaga -- so vira isActive=false, reversivel no proximo sync.
async function reconcileEquipmentsSnapshot(tenantId, snapshot) {
  const externalIds = [...new Set((snapshot?.externalIds || []).map(String).filter((value) => /^\d+$/.test(value)))];
  const minExternalId = Number(snapshot?.minExternalId);
  const maxExternalId = Number(snapshot?.maxExternalId);
  const declaredCount = Number(snapshot?.count);
  const hasRange = externalIds.length > 0
    && Number.isSafeInteger(minExternalId) && Number.isSafeInteger(maxExternalId)
    && minExternalId > 0 && maxExternalId >= minExternalId;
  if (!snapshot?.completeWindow || !Array.isArray(snapshot?.externalIds)
    || declaredCount !== externalIds.length || (externalIds.length > 0 && !hasRange)) {
    throw new Error('Snapshot de equipamentos invalido ou incompleto; reconciliacao ignorada por seguranca.');
  }

  const present = new Set(externalIds);
  const cached = await prisma.crmEquipment.findMany({
    where: { tenantId, externalSource: 'firebird', isActive: true },
    select: { id: true, externalId: true },
  });
  const missingIds = cached
    .filter((record) => {
      const numericId = Number(record.externalId);
      const inScope = snapshot.scope === 'contracted'
        ? true
        : Number.isSafeInteger(numericId)
          && numericId >= minExternalId
          && numericId <= maxExternalId;
      return inScope && !present.has(String(record.externalId));
    })
    .map((record) => record.id);
  if (missingIds.length) {
    await prisma.crmEquipment.updateMany({
      where: { id: { in: missingIds } },
      data: { isActive: false },
    });
  }
  return missingIds.length;
}

// A lista de tecnicos tambem e uma janela autoritativa. O iLux mistura
// tecnicos e atendentes em IXLOSSUPORTE; depois do filtro TIPO=S, os registros
// antigos do tipo O precisam ser desativados no espelho local.
async function reconcileTechniciansSnapshot(tenantId, snapshot) {
  const sourceIds = Array.isArray(snapshot?.externalIds) ? snapshot.externalIds : [];
  const externalIds = [...new Set(sourceIds.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
  const declaredCount = Number(snapshot?.count);
  if (!snapshot?.completeWindow || !Array.isArray(snapshot?.externalIds) || declaredCount !== externalIds.length) {
    throw new Error('Snapshot de tecnicos invalido ou incompleto; reconciliacao ignorada.');
  }

  const cached = await prisma.crmTechnician.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
  });
  const missingIds = cached
    .filter((record) => !externalIds.includes(String(record.name || '').trim().toUpperCase()))
    .map((record) => record.id);
  if (missingIds.length) {
    await prisma.crmTechnician.updateMany({ where: { id: { in: missingIds } }, data: { isActive: false } });
  }
  return missingIds.length;
}

// O iLux altera STATUS/DTATENDIMENTO diretamente na IXLOS e, em varios
// registros, preserva ATUALIZADO com a data de inclusao. Nesse caso nenhum
// cursor incremental consegue descobrir que uma O.S. deixou de estar aberta.
// O agente envia uma janela autoritativa das O.S. ainda abertas; as que
// desapareceram dessa janela sao marcadas como concluidas no espelho local.
async function reconcileServiceOrdersOpenSnapshot(tenantId, snapshot) {
  const externalIds = [...new Set((snapshot?.externalIds || []).map(String).filter((value) => /^\d+$/.test(value)))];
  const declaredCount = Number(snapshot?.count);
  if (!snapshot?.completeWindow || !Array.isArray(snapshot?.externalIds) || declaredCount !== externalIds.length) {
    throw new Error('Snapshot de O.S. abertas invalido ou incompleto; reconciliacao ignorada por seguranca.');
  }

  const present = new Set(externalIds);
  const cached = await prisma.externalSyncRecord.findMany({
    where: { tenantId, source: 'firebird', entity: 'serviceOrders' },
    select: { id: true, externalId: true, payload: true },
  });
  let reconciled = 0;
  for (const record of cached) {
    if (present.has(String(record.externalId))) continue;
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : payload;
    const status = String(raw.status ?? payload.status ?? '').trim().toUpperCase();
    if (!['A', 'E', 'M', 'T', 'P'].includes(status)) continue;

    const reconciledAt = snapshot.capturedAt || new Date().toISOString();
    const nextRaw = {
      ...raw,
      status: 'O',
      nmstatus: raw.dtfechamento ? raw.nmstatus : 'CONCLUIDO POR SINCRONIZACAO',
      sourceReconciledClosed: true,
      sourceReconciledAt: reconciledAt,
    };
    await prisma.externalSyncRecord.update({
      where: { id: record.id },
      data: {
        payload: {
          ...payload,
          status: 'O',
          raw: nextRaw,
          sourceReconciledClosed: true,
          sourceReconciledAt: reconciledAt,
        },
        syncedAt: new Date(),
      },
    });
    const sourceClosedAt = parseFirebirdDate(
      raw.dtfechamento || payload.closedAt,
      raw.hratendimento || payload.hratendimento,
    );
    const sourceAttendedAt = parseFirebirdDate(
      raw.dtatendimento || payload.resolvedAt,
      raw.hratendimento || payload.hratendimento,
    );
    await prisma.serviceOrder.updateMany({
      where: { tenantId, externalSource: 'firebird', externalId: String(record.externalId) },
      data: {
        status: 'FINALIZADA',
        ...(sourceClosedAt ? { closedAt: sourceClosedAt } : {}),
        ...((sourceAttendedAt || sourceClosedAt) ? { resolvedAt: sourceAttendedAt || sourceClosedAt } : {}),
      },
    });
    reconciled += 1;
  }
  return reconciled;
}

async function findOrCreateContact(tenant, instance, data) {
  const externalId = pick(data.externalId, data.cdCliente, data.clientExternalId, data.clientId);
  const externalSource = 'firebird';

  if (!externalId) {
    throw new Error('Contato sem identificador externo.');
  }

  const phone = normalizePhone(
    pick(data.whatsapp, data.celular, data.phone, data.fone1, data.fone2, data.telefone),
    externalId
  );
  const whatsapp = normalizePhone(pick(data.whatsapp, data.celular), null);

  const defaults = {
    tenantId: tenant.id,
    instanceId: instance.id,
    externalSource,
    externalId,
    externalUpdatedAt: normalizeDate(pick(data.updatedAt, data.atualizado, data.modificadoEm, data.inclusao)),
    phone: phone || `FB-${externalId}`,
    whatsapp,
    name: pick(data.name, data.nmCliente, data.razaoSocial, data.cliente) || `Cliente ${externalId}`,
    fantasyName: pick(data.fantasyName, data.fantasia, data.nomeFantasia),
    email: pick(data.email),
    cpfCnpj: pick(data.cpfCnpj, data.cpf, data.cnpj, data.documento),
    address: pick(data.address, data.endereco, data.logradouro),
    city: pick(data.city, data.cidade),
    state: pick(data.state, data.uf),
    zipCode: pick(data.zipCode, data.cep),
    notes: pick(data.obs, data.observacao, data.contato) || null,
  };

  const existing = await prisma.contact.findFirst({
    where: {
      tenantId: tenant.id,
      externalSource,
      externalId,
    },
  });

  if (existing) {
    return prisma.contact.update({
      where: { id: existing.id },
      data: {
        ...defaults,
        phone: defaults.phone || existing.phone,
        whatsapp: defaults.whatsapp || existing.whatsapp,
        name: defaults.name || existing.name,
        fantasyName: defaults.fantasyName || existing.fantasyName,
        email: defaults.email || existing.email,
        cpfCnpj: defaults.cpfCnpj || existing.cpfCnpj,
        address: defaults.address || existing.address,
        city: defaults.city || existing.city,
        state: defaults.state || existing.state,
        zipCode: defaults.zipCode || existing.zipCode,
        notes: defaults.notes || existing.notes,
      },
    });
  }

  return prisma.contact.create({ data: defaults });
}

async function upsertCrmCustomer(tenant, data) {
  const externalId = pick(data.externalId, data.cdCliente, data.clientExternalId, data.clientId);
  if (!externalId) {
    throw new Error('Cliente CRM sem identificador externo.');
  }

  const phone = normalizePhone(
    pick(data.phone, data.fone1, data.celular, data.whatsapp, data.fone2, data.telefone),
    null
  );

  const defaults = {
    tenantId: tenant.id,
    externalSource: 'firebird',
    externalId,
    externalUpdatedAt: normalizeDate(pick(data.updatedAt, data.atualizado, data.modificadoEm, data.inclusao)),
    name: pick(data.name, data.nmCliente, data.razaoSocial, data.cliente) || `Cliente ${externalId}`,
    fantasyName: pick(data.fantasyName, data.fantasia, data.nomeFantasia),
    cpfCnpj: pick(data.cpfCnpj, data.cpf, data.cnpj, data.documento),
    email: pick(data.email),
    phone,
    address: pick(data.address, data.endereco, data.logradouro),
    neighborhood: pick(data.neighborhood, data.bairro),
    city: pick(data.city, data.cidade),
    state: pick(data.state, data.uf),
    zipCode: pick(data.zipCode, data.cep),
    contactName: pick(data.contact, data.contato),
    notes: pick(data.obs, data.observacao),
    raw: data.raw || data,
  };

  return prisma.crmCustomer.upsert({
    where: {
      tenantId_externalSource_externalId: {
        tenantId: tenant.id,
        externalSource: 'firebird',
        externalId,
      },
    },
    update: defaults,
    create: defaults,
  });
}

async function upsertCrmEquipment(tenant, data) {
  const externalId = pick(data.externalId, data.cdequipamento, data.equipmentExternalId);
  const clientExternalId = pick(data.clientExternalId, data.cdCliente, data.clientId);
  if (!externalId) {
    throw new Error('Equipamento CRM sem identificador externo.');
  }

  // The LCD Digital Web is authoritative for the customer/equipment link.
  // Once its mirror exists, a later Firebird snapshot may refresh legacy
  // fields but must not overwrite the official link or create a competing
  // active record for the same machine.
  const lcdOfficial = await prisma.crmEquipment.findUnique({
    where: {
      tenantId_externalSource_externalId: {
        tenantId: tenant.id,
        externalSource: 'LCDDIGITALWEB',
        externalId,
      },
    },
  });
  if (lcdOfficial) return lcdOfficial;

  let customer = null;
  if (clientExternalId) {
    customer = await prisma.crmCustomer.findFirst({
      where: {
        tenantId: tenant.id,
        externalSource: 'firebird',
        externalId: clientExternalId,
      },
    });
  }

  const defaults = {
    tenantId: tenant.id,
    customerId: customer?.id || null,
    externalSource: 'firebird',
    externalId,
    externalUpdatedAt: normalizeDate(pick(data.updatedAt, data.atualizado, data.inclusao)),
    model: pick(data.model, data.modelo, data.equipmentModel) || `Equipamento ${externalId}`,
    manufacturer: pick(data.manufacturer, data.fabricante),
    type: mapEquipmentType(pick(data.type, data.tipo, data.cdProduto), pick(data.model, data.modelo, data.equipmentModel)),
    serialNumber: pick(data.serialNumber, data.serie, data.sn),
    assetTag: pick(data.assetTag, data.patrimonio),
    sector: pick(data.sector, data.departamento),
    installLocation: pick(data.installLocation, data.localInstal, data.localinstal),
    address: pick(data.address, data.endereco),
    city: pick(data.city, data.cidade),
    state: pick(data.state, data.uf),
    phone: normalizePhone(pick(data.phone, data.fone, data.celular, data.whatsapp), null),
    ownerType: normalizeEquipmentOwner(pick(data.ownerType, data.proprietario, data.tfproprietario)),
    // O agente ja resolve o vinculo real pelo historico de instalacao do
    // contrato (IXLCONTRATOSIT); quando a maquina saiu do contrato ele manda
    // null/inactive. `?? null` garante que o vinculo antigo seja limpo no
    // update (pick devolveria undefined e o Prisma manteria o valor velho).
    contractExternalId: pick(data.contractExternalId, data.seqContrato, data.seqcontrato) ?? null,
    isActive: !isInactiveFlag(pick(data.inactive, data.tfinativo)),
    raw: data.raw || data,
  };

  return prisma.crmEquipment.upsert({
    where: {
      tenantId_externalSource_externalId: {
        tenantId: tenant.id,
        externalSource: 'firebird',
        externalId,
      },
    },
    update: defaults,
    create: defaults,
  });
}

async function findOrCreateEquipment(tenant, instance, data) {
  const externalId = pick(data.externalId, data.cdequipamento, data.equipmentExternalId, data.seqOs);
  const clientExternalId = pick(data.clientExternalId, data.cdCliente, data.clientId);

  if (!externalId) {
    throw new Error('Equipamento sem identificador externo.');
  }

  const contact = await findOrCreateContact(tenant, instance, {
    externalId: clientExternalId || `EQUIP-${externalId}`,
    cdCliente: clientExternalId || `EQUIP-${externalId}`,
    name: pick(data.clientName, data.nmCliente, data.nomeCliente) || `Cliente ${clientExternalId || externalId}`,
    phone: pick(data.phone, data.fone, data.celular, data.whatsapp),
    city: pick(data.city, data.cidade),
    state: pick(data.state, data.uf),
  });

  const defaults = {
    tenantId: tenant.id,
    contactId: contact.id,
    externalSource: 'firebird',
    externalId,
    externalUpdatedAt: normalizeDate(pick(data.updatedAt, data.atualizado, data.inclusao)),
    manufacturer: pick(data.manufacturer, data.fabricante),
    model: pick(data.model, data.modelo) || `Equipamento ${externalId}`,
    serialNumber: pick(data.serialNumber, data.serie, data.sn),
    type: mapEquipmentType(pick(data.type, data.tipo, data.cdProduto), pick(data.model, data.modelo)),
    sector: pick(data.sector, data.departamento, data.localInstal),
    address: pick(data.address, data.endereco),
  };

  const existing = await prisma.equipment.findFirst({
    where: {
      tenantId: tenant.id,
      externalSource: 'firebird',
      externalId,
    },
  });

  if (existing) {
    return prisma.equipment.update({
      where: { id: existing.id },
      data: {
        ...defaults,
        contactId: contact.id,
        manufacturer: defaults.manufacturer || existing.manufacturer,
        model: defaults.model || existing.model,
        serialNumber: defaults.serialNumber || existing.serialNumber,
        type: defaults.type || existing.type,
        sector: defaults.sector || existing.sector,
        address: defaults.address || existing.address,
      },
    });
  }

  return prisma.equipment.create({ data: defaults });
}

async function upsertServiceOrder(tenant, instance, data) {
  const externalId = pick(data.externalId, data.seqOs, data.idAtendimento, data.id_atendimento);

  if (!externalId) {
    throw new Error('Ordem de serviço sem identificador externo.');
  }

  const contact = await findOrCreateContact(tenant, instance, {
    externalId: pick(data.clientExternalId, data.cdCliente, data.clientId) || `OS-${externalId}`,
    cdCliente: pick(data.clientExternalId, data.cdCliente, data.clientId) || `OS-${externalId}`,
    name: pick(data.clientName, data.nmCliente) || `Cliente ${pick(data.clientExternalId, data.cdCliente, data.clientId) || externalId}`,
    phone: pick(data.phone, data.fone, data.celular, data.whatsapp),
    address: pick(data.address, data.endereco),
    city: pick(data.city, data.cidade),
    state: pick(data.state, data.uf),
    zipCode: pick(data.zipCode, data.cep),
  });

  const equipment = await findOrCreateEquipment(tenant, instance, {
    externalId: pick(data.equipmentExternalId, data.cdequipamento) || `EQ-${externalId}`,
    clientExternalId: pick(data.clientExternalId, data.cdCliente, data.clientId) || `OS-${externalId}`,
    clientName: pick(data.clientName, data.nmCliente) || contact.name,
    manufacturer: pick(data.manufacturer, data.fabricante),
    model: pick(data.equipmentModel, data.modele, data.modeloe, data.modelo) || `Equipamento ${externalId}`,
    serialNumber: pick(data.serialNumber, data.serie),
    type: pick(data.type, data.tipo, data.cdProduto),
    sector: pick(data.sector, data.departamento, data.localInstal),
    address: pick(data.address, data.endereco),
    city: pick(data.city, data.cidade),
    state: pick(data.state, data.uf),
  });

  const openedAt = parseFirebirdDate(
    pick(data.createdAt, data.dtInclusao, data.dtinclusao, data.raw?.dtinclusao),
    pick(data.time, data.hrInclusao, data.hrinclusao, data.raw?.hrinclusao),
  );
  const attendedAt = parseFirebirdDate(
    pick(data.resolvedAt, data.dtAtendimento, data.dtatendimento, data.raw?.dtatendimento),
    pick(data.attendedTime, data.hrAtendimento, data.hratendimento, data.raw?.hratendimento),
  );
  const closedAt = parseFirebirdDate(
    pick(data.closedAt, data.dtFechamento, data.dtfechamento, data.raw?.dtfechamento),
    pick(data.closedTime, data.hrFechamento, data.hratendimento, data.raw?.hratendimento),
  );
  const hasClosedAt = ['closedAt', 'dtFechamento', 'dtfechamento'].some((key) => (
    Object.prototype.hasOwnProperty.call(data, key) || Object.prototype.hasOwnProperty.call(data.raw || {}, key)
  ));
  const hasAttendedAt = ['resolvedAt', 'dtAtendimento', 'dtatendimento'].some((key) => (
    Object.prototype.hasOwnProperty.call(data, key) || Object.prototype.hasOwnProperty.call(data.raw || {}, key)
  ));
  const sourceStatusCode = pick(
    data.statusCode,
    data.cdStatus,
    data.cdstatus,
    data.raw?.statusCode,
    data.raw?.cdStatus,
    data.raw?.cdstatus,
  );

  const defaults = {
    tenantId: tenant.id,
    contactId: contact.id,
    equipmentId: equipment.id,
    externalSource: 'firebird',
    externalId,
    externalUpdatedAt: parseFirebirdDate(pick(data.updatedAt, data.atualizado, data.raw?.atualizado)) || openedAt || attendedAt || closedAt,
    sourceStatusCode,
    status: normalizeStatus(pick(data.status, data.nmStatus, data.nmstatus, data.raw?.status, data.raw?.nmstatus, data.tffaturar, data.raw?.tffaturar)),
    defect: pick(data.defect, data.nmDefeito, data.causa, data.sintoma),
    technicalNotes: [pick(data.action, data.acao), pick(data.observacao), pick(data.nmSuporteT)].filter(Boolean).join(' | ') || null,
    resolvedAt: attendedAt || closedAt || null,
    ...(openedAt ? { createdAt: openedAt } : {}),
    ...(closedAt ? { closedAt } : {}),
  };

  const existing = await prisma.serviceOrder.findFirst({
    where: {
      tenantId: tenant.id,
      externalSource: 'firebird',
      externalId,
    },
  });

  if (existing) {
    return prisma.serviceOrder.update({
      where: { id: existing.id },
      data: {
        ...defaults,
        contactId: contact.id,
        equipmentId: equipment.id,
        status: defaults.status || existing.status,
        sourceStatusCode: sourceStatusCode || existing.sourceStatusCode,
        defect: defaults.defect || existing.defect,
        technicalNotes: defaults.technicalNotes || existing.technicalNotes,
        ...(openedAt ? { createdAt: openedAt } : {}),
        ...(hasClosedAt ? { closedAt: closedAt || null } : {}),
        ...(hasAttendedAt ? { resolvedAt: attendedAt || closedAt || null } : {}),
      },
    });
  }

  return prisma.serviceOrder.create({ data: defaults });
}

function parseNum(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/\s+/g, '').replace('.', '').replace(',', '.'));
  if (Number.isFinite(n)) return n;
  const plain = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(plain) ? plain : null;
}

function truncToUtcDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Diferente de parseNum(): o agente ja manda numeros JSON limpos (floats), sem
// mascara brasileira. parseNum destroi "5017.6" (vira 50176 ao remover o ponto).
function plainNum(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function plainInt(value) {
  const n = plainNum(value);
  return n === null ? null : Math.round(n);
}

// Demonstrativo do iLux (IXLDEMOFAT + IXLCONTRATOSFAT) empurrado pelo agente
// (entity billingStatement). Header em CrmBillingStatement, linhas recriadas do
// zero a cada push (imutaveis depois que o demonstrativo fecha). Valores como o
// ERP fechou -- nada e recalculado.
async function upsertCrmBillingStatement(tenant, data) {
  const p = data || {};
  const externalId = pick(p.externalId, p.seqdemonstrativo, p.SEQDEMONSTRATIVO);
  if (!externalId) return false;

  const lines = Array.isArray(p.lines) ? p.lines : [];
  const header = {
    period: pick(p.period, p.periodo) || null,
    statementDate: normalizeDate(pick(p.statementDate, p.dtdemonstrativo)),
    dueDate: normalizeDate(pick(p.dueDate, p.dtcobranca)),
    customerExternalId: pick(p.customerExternalId, p.cdcliente) || null,
    companyExternalId: pick(p.companyExternalId, p.cdempresa) || null,
    contractGroupExternalId: pick(p.contractGroupExternalId, p.seqcontratogrp) || null,
    receivableExternalId: pick(p.receivableExternalId, p.seqreceita) || null,
    invoiceNumber: pick(p.invoiceNumber, p.numnf) || null,
    totalValue: plainNum(p.totalValue) ?? 0,
    fixedValue: plainNum(p.fixedValue) ?? 0,
    excessValue: plainNum(p.excessValue) ?? 0,
    discountValue: plainNum(p.discountValue) ?? 0,
    surchargeValue: plainNum(p.surchargeValue) ?? 0,
    netValue: plainNum(p.netValue) ?? 0,
    status: pick(p.status) || null,
    notes: p.notes ? String(p.notes).slice(0, 4000) : null,
    lineCount: plainInt(p.lineCount) ?? lines.length,
    raw: p,
    externalUpdatedAt: normalizeDate(pick(p.externalUpdatedAt, p.atualizado)),
    syncedAt: new Date(),
  };

  const statement = await prisma.crmBillingStatement.upsert({
    where: {
      tenantId_externalSource_externalId: {
        tenantId: tenant.id, externalSource: 'firebird', externalId: String(externalId),
      },
    },
    update: header,
    create: {
      tenantId: tenant.id, externalSource: 'firebird', externalId: String(externalId), ...header,
    },
    select: { id: true },
  });

  const rows = lines.map((l, index) => ({
    tenantId: tenant.id,
    statementId: statement.id,
    statementExternalId: String(externalId),
    lineNo: plainInt(l.lineNo) ?? index,
    contractExternalId: pick(l.contractExternalId, l.seqcontrato) || null,
    contractGroupExternalId: pick(l.contractGroupExternalId, l.seqcontratogrp) || null,
    equipmentExternalId: pick(l.equipmentExternalId, l.cdequipamento) || null,
    equipmentName: pick(l.equipmentName) || null,
    equipmentModel: pick(l.equipmentModel) || null,
    equipmentSerial: pick(l.equipmentSerial) || null,
    meterCode: pick(l.meterCode) || null,
    meterCodeBilling: pick(l.meterCodeBilling) || null,
    department: pick(l.department) || null,
    installLocation: pick(l.installLocation) || null,
    periodStart: normalizeDate(l.periodStart),
    periodEnd: normalizeDate(l.periodEnd),
    readingDate: normalizeDate(l.readingDate),
    periodDays: plainInt(l.periodDays),
    meterStart: plainInt(l.meterStart),
    meterEnd: plainInt(l.meterEnd),
    meterDiscount: plainInt(l.meterDiscount),
    qtyProduction: plainInt(l.qtyProduction),
    qtyFranchise: plainInt(l.qtyFranchise),
    qtyExcess: plainInt(l.qtyExcess),
    franchiseValue: plainNum(l.franchiseValue) ?? 0,
    excessValue: plainNum(l.excessValue) ?? 0,
    franchiseCharged: plainNum(l.franchiseCharged) ?? 0,
    excessCharged: plainNum(l.excessCharged) ?? 0,
    invoiceValue: plainNum(l.invoiceValue) ?? 0,
    discountValue: plainNum(l.discountValue) ?? 0,
    surchargeValue: plainNum(l.surchargeValue) ?? 0,
    isFixed: Boolean(l.isFixed),
    isExempt: Boolean(l.isExempt),
    isProrated: Boolean(l.isProrated),
    isBonus: Boolean(l.isBonus),
    raw: l,
  }));

  await prisma.$transaction([
    prisma.crmBillingStatementLine.deleteMany({ where: { statementId: statement.id } }),
    ...(rows.length ? [prisma.crmBillingStatementLine.createMany({ data: rows })] : []),
  ]);

  return true;
}

function normalizeMeterUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 100)) {
    const key = String(rawKey).trim().slice(0, 80);
    const number = parseNum(rawValue);
    if (key && Number.isFinite(number) && number >= 0) result[key] = Math.floor(number);
  }
  return Object.keys(result).length ? result : null;
}

// Contrato do iLux -> CrmContract consultavel. Le tanto os campos ja
// normalizados pelo agente quanto os nomes crus das colunas Firebird.
async function upsertCrmContract(tenant, data) {
  const p = data || {};
  const externalId = pick(p.externalId, p.seqixlcontratos, p.seqIxlContratos, p.seqcontrato, p.seqContrato, p.SEQCONTRATO);
  if (!externalId) return;

  const modality = pick(p.modality, p.modalidade, p.billingMode);
  const status = pick(p.status, p.ds_status, p.dsStatus, p.situacao);
  const isActive = String(pick(p.isActive, p.ativo) ?? '').toUpperCase() !== 'FALSE'
    && !isInactiveFlag(pick(p.tfinativo, p.inativo));

  const fields = {
    customerExternalId: pick(p.customerExternalId, p.clientExternalId, p.cdcliente, p.cdCliente, p.CDCLIENTE),
    number: pick(p.number, p.contractNumber, p.nrcontrato, p.nrContrato),
    type: pick(p.type, p.contractType, p.nmcontratotp, p.tipocontrato),
    typeCode: pick(p.typeCode, p.contractTypeCode, p.cdcontratotp),
    modality: modality ? modality.toLowerCase() : null,
    status,
    isActive,
    startsAt: normalizeDate(pick(p.startsAt, p.dtinicio, p.dt_inicio, p.dtInicio)),
    endsAt: normalizeDate(pick(p.endsAt, p.dtfim, p.dt_fim, p.dtFim)),
    monthlyValue: parseNum(pick(p.monthlyValue, p.valor_mensal, p.valmensal, p.vlmensal)),
    pageFranchise: Math.round(parseNum(pick(p.pageFranchise, p.qt_franquia, p.qtfranquia)) || 0),
    franchiseValue: parseNum(pick(p.franchiseValue, p.valor_franquia, p.valfranquia)) || 0,
    // O agente manda o valor JA por pagina em overageRateMax/Min (VALEXCEDENTE/1000).
    excessPageValue: parseNum(pick(p.excessPageValue, p.overageRateMax, p.overageRateMin, p.valor_excedente, p.valexcedente, p.vlpgexcedente)) || 0,
    activeEquipment: Math.round(parseNum(pick(p.activeEquipment, p.equipmentCount, p.qt_equipamentos, p.qtequipamentos)) || 0),
    raw: p,
    externalUpdatedAt: normalizeDate(pick(p.externalUpdatedAt, p.updatedAt, p.atualizado, p.ATUALIZADO)),
  };

  await prisma.crmContract.upsert({
    where: { tenantId_externalSource_externalId: { tenantId: tenant.id, externalSource: 'firebird', externalId: String(externalId) } },
    update: fields,
    create: { tenantId: tenant.id, externalSource: 'firebird', externalId: String(externalId), ...fields },
  });
}

// Leitura de contador -> CrmMeterReading (append-only, 1 ponto por medidor/dia).
// Tambem grava o ponto anterior quando vier junto, para semear o historico.
async function persistMeterHistory(tenant, data) {
  const rows = Array.isArray(data?.meters) ? data.meters : [data];
  for (const m of rows) {
    if (!m || typeof m !== 'object') continue;
    const equipmentExternalId = pick(m.equipmentExternalId, m.cdequipamento, m.cdEquipamento, m.CDEQUIPAMENTO);
    const reading = parseNum(pick(m.reading, m.medidor, m.MEDIDOR, m.page_counter, m.pageCounter, m.counter));
    if (!equipmentExternalId || reading == null) continue;

    const meterCode = pick(m.meterCode, m.cdmedidor, m.CDMEDIDOR) || '0';
    const meterName = pick(m.meterName, m.nome, m.descricao, m.tipo);
    const serialNumber = pick(m.serialNumber, m.numserie, m.nrserie, m.NRSERIE);
    const readAt = truncToUtcDay(normalizeDate(pick(m.readAt, m.dtleitura, m.DTLEITURA)) || new Date());
    if (!readAt) continue;

    const previousReading = parseNum(pick(m.previousReading, m.medidorult, m.MEDIDORULT));
    const previousReadAt = truncToUtcDay(normalizeDate(pick(m.previousReadAt, m.dtleiturault, m.DTLEITURAULT)));
    const usageCounters = normalizeMeterUsage(pick(m.usageCounters, m.usage_counters, m.contadores, m.counters));

    const base = { serialNumber, meterName, usageCounters, source: 'firebird' };
    await prisma.crmMeterReading.upsert({
      where: { tenantId_equipmentExternalId_meterCode_readAt: { tenantId: tenant.id, equipmentExternalId: String(equipmentExternalId), meterCode: String(meterCode), readAt } },
      update: { reading: Math.round(reading), previousReading: previousReading != null ? Math.round(previousReading) : undefined, previousReadAt: previousReadAt || undefined, ...base },
      create: { tenantId: tenant.id, equipmentExternalId: String(equipmentExternalId), meterCode: String(meterCode), reading: Math.round(reading), previousReading: previousReading != null ? Math.round(previousReading) : null, readAt, previousReadAt: previousReadAt || null, ...base },
    });

    // Semeia o ponto anterior (dia distinto) para dar 2+ pontos ao historico.
    if (previousReading != null && previousReadAt && previousReadAt.getTime() !== readAt.getTime()) {
      await prisma.crmMeterReading.upsert({
        where: { tenantId_equipmentExternalId_meterCode_readAt: { tenantId: tenant.id, equipmentExternalId: String(equipmentExternalId), meterCode: String(meterCode), readAt: previousReadAt } },
        update: {},
        create: { tenantId: tenant.id, equipmentExternalId: String(equipmentExternalId), meterCode: String(meterCode), reading: Math.round(previousReading), readAt: previousReadAt, ...base },
      });
    }
  }
}

async function pushBatch(req, res) {
  try {
    const { tenantSlug, entity, records } = req.body || {};

    if (!entity || typeof entity !== 'string') {
      return res.status(400).json({ error: 'entity é obrigatório.' });
    }

    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'records deve ser uma lista.' });
    }

    // Somente a importação de O.S. precisa de uma instância para associar o
    // contato ao canal. Cadastros, contratos e leituras podem ser validados e
    // sincronizados antes de o cliente conectar o WhatsApp.
    const { tenant, instance } = await resolveTenantContext(tenantSlug, req, {
      requireInstance: entity === 'serviceOrders',
    });
    assertToken(req, tenant);

    const source = 'firebird';
    const stats = {
      received: records.length,
      stored: 0,
      crmCustomers: 0,
      crmEquipments: 0,
      contacts: 0,
      equipments: 0,
      serviceOrders: 0,
      companyInfo: 0,
      reconciled: 0,
      skipped: 0,
      errors: [],
    };

    for (const record of records) {
      try {
        if (entity === RECEIVABLE_SNAPSHOT_ENTITY) {
          stats.reconciled += await reconcileReceivablesSnapshot(tenant.id, record);
          stats.stored += 1;
          continue;
        }
        if (entity === EQUIPMENT_SNAPSHOT_ENTITY) {
          stats.reconciled += await reconcileEquipmentsSnapshot(tenant.id, record);
          stats.stored += 1;
          continue;
        }
        if (entity === TECHNICIAN_SNAPSHOT_ENTITY) {
          stats.reconciled += await reconcileTechniciansSnapshot(tenant.id, record);
          stats.stored += 1;
          continue;
        }
        if (entity === SERVICE_ORDER_OPEN_SNAPSHOT_ENTITY) {
          stats.reconciled += await reconcileServiceOrdersOpenSnapshot(tenant.id, record);
          stats.stored += 1;
          continue;
        }
        if (entity === 'plugBoletoConfig') {
          // Credencial do PlugBoleto (CE_CEDENTE / CE_PARAM_CONFIG) empurrada
          // pelo agente a cada ciclo. Guarda o token cifrado direto em
          // TenantSettings; nao vira registro bruto.
          const token = String(record.token || '').trim();
          const cnpj = String(record.cedenteCnpj || record.cnpj || '').replace(/\D/g, '');
          if (token && cnpj) {
            // So LIGA a flag na PRIMEIRA sincronizacao (quando ainda nao havia
            // credencial). Depois disso, quem manda no on/off e o usuario -- o
            // agente sincroniza a credencial mas nao sobrescreve a escolha dele.
            const current = await prisma.tenantSettings.findUnique({
              where: { tenantId: tenant.id },
              select: { plugBoletoTokenCipher: true },
            });
            const firstSync = !current?.plugBoletoTokenCipher;
            await prisma.tenantSettings.update({
              where: { tenantId: tenant.id },
              data: {
                ...(firstSync ? { plugBoletoEnabled: true } : {}),
                plugBoletoCedenteCnpj: cnpj,
                plugBoletoBaseUrl: String(record.baseUrl || '').trim() || undefined,
                plugBoletoPrintPath: String(record.printPath || '').trim() || undefined,
                plugBoletoTokenCipher: encryptSecret(token),
                plugBoletoConfigSyncedAt: new Date(),
              },
            });
            stats.stored += 1;
          } else {
            stats.skipped += 1;
          }
          continue;
        }
        if (entity === 'billingStatement') {
          // Demonstrativo (IXLDEMOFAT + IXLCONTRATOSFAT) para o CRM re-renderizar
          // o PDF sem a pasta monitorada. Nao vira externalSyncRecord bruto -- o
          // header ja guarda `raw`.
          const ok = await upsertCrmBillingStatement(tenant, record);
          if (ok) stats.stored += 1; else stats.skipped += 1;
          continue;
        }
        if (entity === 'billingScanStatus') {
          // Resumo da ultima varredura do envio automatico (o agente empurra
          // uma vez por ciclo). Guarda em TenantSettings para a visao "titulos
          // aguardando documento na pasta".
          const mbt = record.missingByType || {};
          await prisma.tenantSettings.update({
            where: { tenantId: tenant.id },
            data: {
              billingScanStatus: {
                checkedAt: new Date().toISOString(),
                checked: Number(record.checked) || 0,
                ready: Number(record.ready) || 0,
                alreadySent: Number(record.alreadySent) || 0,
                skippedPeriod: Number(record.skippedPeriod) || 0,
                ambiguous: Number(record.ambiguous) || 0,
                missingByType: {
                  invoice: Number(mbt.invoice) || 0,
                  statement: Number(mbt.statement) || 0,
                  boleto: Number(mbt.boleto) || 0,
                },
              },
            },
          });
          stats.stored += 1;
          continue;
        }
        const payloadToStore = entity === COMPANY_ENTITY
          ? normalizeCompanyProfile(record)
          : record;
        const externalId = pick(
          record.externalId,
          record.cdCliente,
          record.cdequipamento,
          record.seqOs,
          record.idAtendimento,
          record.id_atendimento,
          record.companyCode,
          record.cdEmpresa,
          record.cdeempresa,
          record.code,
          record.cdOstp,
          record.name,
          record.nmSuporte,
          record.nmsuporte
        ) || crypto.randomUUID();

        await upsertRawRecord(tenant.id, source, entity, externalId, payloadToStore);
        stats.stored += 1;

        if (entity === 'contacts') {
          await upsertCrmCustomer(tenant, record);
          stats.crmCustomers += 1;
        } else if (entity === 'equipments') {
          await upsertCrmEquipment(tenant, record);
          stats.crmEquipments += 1;
        } else if (entity === 'osTypes') {
          await upsertCrmOsType(tenant, record);
        } else if (entity === 'technicians') {
          await upsertCrmTechnician(tenant, record);
        } else if (entity === 'defectTypes') {
          await upsertCrmDefectType(tenant, record);
        } else if (entity === 'serviceOrders') {
          await upsertServiceOrder(tenant, instance, record);
          stats.serviceOrders += 1;
        } else if (entity === 'contracts') {
          await upsertCrmContract(tenant, record);
        } else if (entity === 'equipmentMeters') {
          await persistMeterHistory(tenant, record);
        } else if (entity === COMPANY_ENTITY) {
          stats.companyInfo += 1;
        } else {
          stats.skipped += 1;
        }
      } catch (err) {
        stats.errors.push(err.message);
      }
    }

    await prisma.tenantSettings.update({
      where: { tenantId: tenant.id },
      data: {
        firebirdLastSyncAt: new Date(),
        firebirdLastSyncStatus: stats.errors.length ? 'partial' : 'ok',
        firebirdLastSyncError: stats.errors.length ? stats.errors.slice(0, 20).join('\n') : null,
      },
    });

    // O /ping (que popula o inventario) e a ultima coisa do ciclo do agente;
    // se o ciclo morre antes dele, o push ainda passou por aqui. Registrar a
    // instalacao tambem no push garante que ela apareca no inventario mesmo
    // sem o ping final.
    await recordAgentInventory(tenant.id, agentIdentityFromPing(req));

    res.json({
      ok: true,
      tenant: tenant.slug,
      entity,
      stats,
    });
  } catch (err) {
    console.error('[firebird-sync] erro:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function upsertCrmOsType(tenant, data) {
  const code = pick(data.code, data.cdOstp, data.cdostp);
  const name = pick(data.name, data.nmOstp, data.nmostp);
  if (!code || !name) {
    throw new Error('Tipo de O.S. sem código ou descrição.');
  }

  return prisma.crmOsType.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code,
      },
    },
    update: {
      name,
      formulario: pick(data.formulario, data.formularioCode),
      formularioObs: pick(data.formularioObs, data.formularioobs),
      tipoOs: pick(data.tipoOs, data.tipo_os),
      tipoChamado: pick(data.tipoChamado, data.tpchamado),
      logoOs: pick(data.logoOs, data.logo_os),
      inactive: Boolean(data.inactive),
      reportBundle: pick(data.reportBundle, data.reportFile),
    },
    create: {
      tenantId: tenant.id,
      code,
      name,
      formulario: pick(data.formulario, data.formularioCode),
      formularioObs: pick(data.formularioObs, data.formularioobs),
      tipoOs: pick(data.tipoOs, data.tipo_os),
      tipoChamado: pick(data.tipoChamado, data.tpchamado),
      logoOs: pick(data.logoOs, data.logo_os),
      inactive: Boolean(data.inactive),
      reportBundle: pick(data.reportBundle, data.reportFile),
    },
  });
}

async function upsertCrmTechnician(tenant, data) {
  const name = pick(data.name, data.nmSuporte, data.nmsuporte);
  if (!name) {
    throw new Error('Técnico sem nome.');
  }

  const isActive = !['S', 'SIM', 'TRUE', '1'].includes(String(pick(data.inactive, data.tfinativo, data.tfativo === 'N') || '').toUpperCase());

  return prisma.crmTechnician.upsert({
    where: {
      tenantId_name: {
        tenantId: tenant.id,
        name,
      },
    },
    update: { isActive },
    create: {
      tenantId: tenant.id,
      name,
      isActive,
    },
  });
}

async function upsertCrmDefectType(tenant, data) {
  const code = pick(data.code, data.cdDefeito, data.cddefeito);
  const name = pick(data.name, data.nmDefeito, data.nmdefeito);
  if (!code || !name) throw new Error('Tipo de defeito sem código ou descrição.');

  const inactive = ['S', 'SIM', 'TRUE', '1'].includes(
    String(pick(data.inactive, data.tfinativo) || '').toUpperCase()
  );
  return prisma.crmDefectType.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code } },
    update: { name, inactive },
    create: { tenantId: tenant.id, code, name, inactive },
  });
}

async function getPendingCommands(req, res) {
  try {
    const { tenantSlug } = req.query;
    const waitSeconds = Math.max(0, Math.min(Number.parseInt(req.query.wait, 10) || 0, 25));
    const { tenant } = await resolveTenantContext(tenantSlug, req, { requireInstance: false });
    assertToken(req, tenant);

    const deadline = Date.now() + (waitSeconds * 1000);
    let pendingOS = [];
    let pendingBillingPdf = null;
    let pendingBillingDocument = null;
    let pendingCompanyProfile = null;
    let pendingAgentVersion = null;

    do {
      const leaseExpiredAt = new Date(Date.now() - 45_000);
      const candidate = await prisma.serviceOrder.findFirst({
        where: {
          tenantId: tenant.id,
          externalSource: 'firebird',
          externalId: null,
          OR: [
            { status: 'AGUARDANDO_ILUX' },
            { status: 'PROCESSANDO_ILUX', updatedAt: { lt: leaseExpiredAt } },
            { status: 'PENDENTE' },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, updatedAt: true },
      });

      if (candidate) {
        const claimed = await prisma.serviceOrder.updateMany({
          where: {
            id: candidate.id,
            tenantId: tenant.id,
            externalId: null,
            status: candidate.status,
            updatedAt: candidate.updatedAt,
          },
          data: { status: 'PROCESSANDO_ILUX' },
        });

        if (claimed.count === 1) {
          const claimedOrder = await prisma.serviceOrder.findUnique({
            where: { id: candidate.id },
            include: {
              contact: { include: { crmCustomer: true } },
              equipment: true,
              user: true,
            },
          });
          if (claimedOrder) pendingOS = [claimedOrder];
        }
      }

      const pdfCandidate = await prisma.externalSyncRecord.findFirst({
        where: {
          tenantId: tenant.id,
          source: 'crm',
          entity: 'billingPdfRequest',
          payload: { path: ['status'], equals: 'pending' },
        },
        orderBy: { receivedAt: 'asc' },
        select: { id: true, payload: true },
      });
      if (pdfCandidate) {
        pendingBillingPdf = await prisma.externalSyncRecord.update({
          where: { id: pdfCandidate.id },
          data: {
            payload: {
              ...pdfCandidate.payload,
              status: 'processing',
              processingAt: new Date().toISOString(),
            },
          },
          select: { id: true, payload: true },
        });
      }

      const documentCandidate = await prisma.externalSyncRecord.findFirst({
        where: {
          tenantId: tenant.id,
          source: 'crm',
          entity: billingDocumentService.REQUEST_ENTITY,
          payload: { path: ['status'], equals: 'pending' },
        },
        orderBy: { receivedAt: 'asc' },
        select: { id: true, payload: true },
      });
      if (documentCandidate) {
        pendingBillingDocument = await prisma.externalSyncRecord.update({
          where: { id: documentCandidate.id },
          data: {
            payload: {
              ...documentCandidate.payload,
              status: 'processing',
              processingAt: new Date().toISOString(),
            },
          },
          select: { id: true, payload: true },
        });
      }

      const companyCandidate = await prisma.externalSyncRecord.findFirst({
        where: {
          tenantId: tenant.id,
          source: 'crm',
          entity: COMPANY_REQUEST_ENTITY,
          payload: { path: ['status'], equals: 'pending' },
        },
        orderBy: { receivedAt: 'asc' },
        select: { id: true, payload: true },
      });
      if (companyCandidate) {
        pendingCompanyProfile = await prisma.externalSyncRecord.update({
          where: { id: companyCandidate.id },
          data: {
            payload: {
              ...companyCandidate.payload,
              status: 'processing',
              processingAt: new Date().toISOString(),
            },
          },
          select: { id: true, payload: true },
        });
      }

      const installId = String(req.header('x-ilux-agent-id') || '').trim();
      if (installId) {
        const agent = await prisma.firebirdAgent.findUnique({
          where: { tenantId_installId: { tenantId: tenant.id, installId } },
          select: { id: true },
        });
        if (agent) {
          const candidate = await prisma.agentVersionAction.findFirst({
            where: { tenantId: tenant.id, firebirdAgentId: agent.id, status: 'pending' },
            orderBy: { createdAt: 'asc' },
          });
          // Mantem pendente ate o callback do atualizador externo. Se a rede
          // cair durante o download, o mesmo agente recebe o comando de novo.
          if (candidate) pendingAgentVersion = candidate;
        }
      }

      if (pendingOS.length > 0 || pendingBillingPdf || pendingBillingDocument || pendingCompanyProfile || pendingAgentVersion || tenant.settings?.firebirdQueueBillingProcess || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    } while (true);

    const equipmentExternalIds = pendingOS.map(os => os.equipment.externalId).filter(Boolean);
    const crmEquipments = await prisma.crmEquipment.findMany({
      where: {
        tenantId: tenant.id,
        externalId: { in: equipmentExternalIds }
      }
    });
    const crmEquipMap = new Map(crmEquipments.map(e => [e.externalId, e]));

    const commands = pendingOS.map((os) => {
      const crmEq = crmEquipMap.get(os.equipment.externalId);
      return {
      id: os.id,
      type: 'CREATE_OS',
      payload: {
        cdCliente: os.contact.externalId || os.contact.crmCustomer?.externalId || null,
        cdEquipamento: os.equipment.externalId,
        cdOstp: os.cdOstp || '02',
        cdDefeito: os.cdDefeito || '',
        nmsuportet: os.nmsuportet || '',
        defect: os.defect || '',
        attendantName: os.user?.firebirdSupportName || os.user?.name || '',
        // duplicados do cliente
        nmCliente: os.contact.crmCustomer?.name || os.contact.name || '',
        // O endereço da visita deve ser o do EQUIPAMENTO, não o do cadastro
        // principal do cliente - clientes com múltiplas filiais/unidades têm
        // equipamentos instalados em endereços diferentes do cadastro. Cai
        // pro endereço do cliente só quando o equipamento não tem um próprio
        // (a maioria dos casos, cliente com endereço único).
        endereco: crmEq?.address || os.contact.crmCustomer?.address || os.contact.address || '',
        num: crmEq?.raw?.['num'] || crmEq?.raw?.['NUM'] || os.contact.crmCustomer?.raw?.['num'] || os.contact.crmCustomer?.raw?.['NUM'] || '',
        bairro: crmEq?.raw?.['bairro'] || crmEq?.raw?.['BAIRRO'] || os.contact.crmCustomer?.neighborhood || os.contact.neighborhood || '',
        complemento: crmEq?.raw?.['complemento'] || crmEq?.raw?.['COMPLEMENTO'] || os.contact.crmCustomer?.raw?.['complemento'] || os.contact.crmCustomer?.raw?.['COMPLEMENTO'] || '',
        cidade: crmEq?.city || os.contact.crmCustomer?.city || os.contact.city || '',
        uf: crmEq?.state || os.contact.crmCustomer?.state || os.contact.state || '',
        cep: crmEq?.raw?.['cep'] || crmEq?.raw?.['CEP'] || os.contact.crmCustomer?.zipCode || os.contact.zipCode || '',
        ddd: os.contact.crmCustomer?.raw?.['ddd'] || os.contact.crmCustomer?.raw?.['DDD'] || '',
        fone: os.contact.crmCustomer?.phone || os.contact.phone || '',
        celular: os.contact.crmCustomer?.raw?.['celular'] || os.contact.crmCustomer?.raw?.['CELULAR'] || '',
        email: os.contact.crmCustomer?.email || os.contact.email || '',
        contato: os.contact.crmCustomer?.contactName || os.contact.name || '',
        // duplicados do equipamento
        departamento: crmEq?.raw?.['departamento'] || crmEq?.raw?.['DEPARTAMENTO'] || os.equipment.sector || '',
        localInstal: crmEq?.raw?.['localinstal'] || crmEq?.raw?.['LOCALINSTAL'] || crmEq?.installLocation || '',
      },
    };
    });

    if (tenant.settings?.firebirdQueueBillingProcess) {
      commands.push({
        id: 'PROCESS_BILLING',
        type: 'PROCESS_BILLING',
        payload: {}
      });
    }

    if (pendingBillingPdf) {
      commands.push({
        id: pendingBillingPdf.id,
        type: 'FETCH_BILLING_PDF',
        payload: pendingBillingPdf.payload,
      });
    }


    if (pendingBillingDocument) {
      commands.push({
        id: pendingBillingDocument.id,
        type: 'FETCH_BILLING_DOCUMENT',
        payload: pendingBillingDocument.payload,
      });
    }

    if (pendingCompanyProfile) {
      commands.push({
        id: pendingCompanyProfile.id,
        type: 'FETCH_COMPANY_PROFILE',
        payload: pendingCompanyProfile.payload,
      });
    }


    if (pendingAgentVersion) {
      const release = agentController.findRelease(pendingAgentVersion.targetVersion);
      if (release?.sha256) {
        commands.push({
          id: pendingAgentVersion.id,
          type: 'AGENT_VERSION',
          payload: {
            action: pendingAgentVersion.action,
            version: pendingAgentVersion.targetVersion,
            sha256: release.sha256,
            downloadUrl: `/api/integrations/firebird/agent-releases/${encodeURIComponent(pendingAgentVersion.targetVersion)}/download`,
          },
        });
      } else {
        await prisma.agentVersionAction.update({
          where: { id: pendingAgentVersion.id },
          data: { status: 'failed', error: 'Versao nao encontrada no repositorio de agentes.', completedAt: new Date() },
        });
      }
    }

    res.json(commands);
  } catch (err) {
    logPendingCommandError(req, err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function commandCallback(req, res) {
  try {
    const { id } = req.params;
    const { tenantSlug, success, result, error } = req.body || {};

    const { tenant } = await resolveTenantContext(tenantSlug, req, { requireInstance: false });
    assertToken(req, tenant);

    const versionAction = await prisma.agentVersionAction.findFirst({ where: { id, tenantId: tenant.id } });
    if (versionAction) {
      await prisma.agentVersionAction.update({
        where: { id },
        data: {
          status: success ? 'completed' : 'failed',
          error: success ? null : String(error || 'Falha nao informada').slice(0, 2000),
          completedAt: new Date(),
        },
      });
      if (success) {
        await prisma.firebirdAgent.update({
          where: { id: versionAction.firebirdAgentId },
          data: { desiredVersion: null },
        });
      }
      return res.json({ ok: true });
    }

    if (id === 'PROCESS_BILLING') {
      await prisma.tenantSettings.update({
        where: { tenantId: tenant.id },
        data: { firebirdQueueBillingProcess: false }
      });
      console.log(`[pending-commands] Comando PROCESS_BILLING concluído.`);
      return res.json({ ok: true });
    }

    const companyRequest = await prisma.externalSyncRecord.findFirst({
      where: { id, tenantId: tenant.id, source: 'crm', entity: COMPANY_REQUEST_ENTITY },
      select: { id: true, payload: true },
    });
    if (companyRequest) {
      if (success && result?.company && typeof result.company === 'object') {
        const company = normalizeCompanyProfile(result.company);
        const externalId = company.code || result.company.companyCode || result.company.cdeempresa || '1';
        await upsertRawRecord(tenant.id, 'firebird', COMPANY_ENTITY, String(externalId), company);
        // A consulta explícita também atualiza o cadastro manual de fallback.
        // Assim, se o agente ficar temporariamente offline, os documentos
        // continuam usando os últimos dados oficiais conhecidos do iLux.
        await prisma.tenantSettings.upsert({
          where: { tenantId: tenant.id },
          update: {
            companyName: company.name || undefined,
            companyCnpj: company.cnpj || undefined,
            companyIE: company.stateRegistration || undefined,
            companyAddress: company.addressFull || company.address || undefined,
            companyBairro: company.neighborhood || undefined,
            companyCep: company.zipCode || undefined,
            companyPhone: company.phone || undefined,
            companyCity: company.city || undefined,
            companyState: company.state || undefined,
          },
          create: {
            tenantId: tenant.id,
            companyName: company.name || null,
            companyCnpj: company.cnpj || null,
            companyIE: company.stateRegistration || null,
            companyAddress: company.addressFull || company.address || null,
            companyBairro: company.neighborhood || null,
            companyCep: company.zipCode || null,
            companyPhone: company.phone || null,
            companyCity: company.city || null,
            companyState: company.state || null,
          },
        });
        await prisma.externalSyncRecord.update({
          where: { id: companyRequest.id },
          data: {
            payload: {
              ...companyRequest.payload,
              status: 'success',
              completedAt: new Date().toISOString(),
              companyCode: String(externalId),
            },
          },
        });
      } else {
        await prisma.externalSyncRecord.update({
          where: { id: companyRequest.id },
          data: {
            payload: {
              ...companyRequest.payload,
              status: 'failed',
              completedAt: new Date().toISOString(),
              error: String(error || 'Nao foi possivel consultar os dados da empresa no Firebird.'),
            },
          },
        });
      }
      return res.json({ ok: true });
    }

    const billingPdfRequest = await prisma.externalSyncRecord.findFirst({
      where: { id, tenantId: tenant.id, source: 'crm', entity: 'billingPdfRequest' },
      select: { id: true, externalId: true, payload: true },
    });
    if (billingPdfRequest) {
      if (success && result?.pdfBase64) {
        const pdfBuffer = Buffer.from(String(result.pdfBase64), 'base64');
        if (!pdfBuffer.subarray(0, 4).equals(Buffer.from('%PDF'))) {
          throw new Error('O agente devolveu um arquivo de boleto invalido.');
        }
        if (pdfBuffer.length > 20 * 1024 * 1024) {
          throw new Error('O PDF do boleto excedeu o limite de 20 MB.');
        }
        const storedFilename = `boleto-${billingPdfRequest.externalId}-${Date.now()}.pdf`;
        await fs.promises.writeFile(path.join(mediaPath, storedFilename), pdfBuffer);
        await prisma.externalSyncRecord.update({
          where: { id: billingPdfRequest.id },
          data: {
            payload: {
              ...billingPdfRequest.payload,
              status: 'success',
              completedAt: new Date().toISOString(),
              mediaUrl: `/uploads/media/${storedFilename}`,
              fileName: path.basename(String(result.fileName || `BOLETO ${billingPdfRequest.externalId}.pdf`)),
            },
          },
        });
      } else {
        await prisma.externalSyncRecord.update({
          where: { id: billingPdfRequest.id },
          data: {
            payload: {
              ...billingPdfRequest.payload,
              status: 'failed',
              completedAt: new Date().toISOString(),
              error: String(error || 'Nao foi possivel recuperar o boleto.'),
            },
          },
        });
      }
      return res.json({ ok: true });
    }

    const billingDocumentRequest = await prisma.externalSyncRecord.findFirst({
      where: { id, tenantId: tenant.id, source: 'crm', entity: billingDocumentService.REQUEST_ENTITY },
      select: { id: true, externalId: true, payload: true },
    });
    if (billingDocumentRequest) {
      try {
        await billingDocumentService.completeDocumentRequest({
          request: billingDocumentRequest,
          success,
          result,
          error,
        });
      } catch (documentError) {
        await billingDocumentService.completeDocumentRequest({
          request: billingDocumentRequest,
          success: false,
          result: null,
          error: documentError.message,
        });
      }
      return res.json({ ok: true });
    }

    if (success && result?.seqOs) {
      // O agente guarda o SEQOS localmente e reenvia esse callback em todo
      // ciclo ate confirmar - se o registro da O.S. sumiu do nosso banco
      // nesse meio tempo (ex.: contato/equipamento foi apagado ou mesclado,
      // que apaga a O.S. em cascata), `update` lanca "record not found" e
      // isso virava um 500 opaco que o agente reenviava para sempre, sem
      // nunca conseguir se resolver sozinho.
      const existingServiceOrder = await prisma.serviceOrder.findFirst({
        where: { id, tenantId: tenant.id },
        select: {
          id: true,
          externalId: true,
          externalSource: true,
          requestKey: true,
          ticketId: true,
          userId: true,
          equipmentId: true,
          defect: true,
          createdAt: true,
        },
      });
      if (!existingServiceOrder) {
        console.warn(`[pending-commands] O.S. ${id} (SEQOS ${result.seqOs} ja criado no Firebird) nao existe mais no CRM - provavelmente o contato ou equipamento foi removido/mesclado. Confirmando o callback para o agente parar de reenviar.`);
        return res.json({ ok: true, note: 'Registro da O.S. nao existe mais no CRM; nada a atualizar.' });
      }

      let serviceOrder;
      try {
        serviceOrder = await prisma.serviceOrder.update({
          where: { id, tenantId: tenant.id },
          data: {
            externalId: String(result.seqOs),
            status: 'PENDENTE',
          },
        });
      } catch (updateError) {
        // Duas O.S. no CRM (normalmente uma vinda de uma conversa e outra
        // criada direto pela tela, ambas pro mesmo cliente/equipamento)
        // podem acabar resultando no mesmo SEQOS no Firebird - a constraint
        // unica (tenantId, externalSource, externalId) barra a segunda. Sem
        // tratar isso, o agente ficava reenviando esse callback para sempre
        // e o usuario so via um 500 generico, sem nenhuma pista do motivo.
        if (updateError?.code === 'P2002') {
          const holder = await prisma.serviceOrder.findFirst({
            where: { tenantId: tenant.id, externalSource: 'firebird', externalId: String(result.seqOs) },
            select: {
              id: true,
              externalId: true,
              externalSource: true,
              requestKey: true,
              ticketId: true,
              userId: true,
              equipmentId: true,
              defect: true,
              createdAt: true,
            },
          });
          const merged = await mergeImportedServiceOrderMirror(
            tenant.id,
            existingServiceOrder,
            holder,
            result.seqOs,
          );
          if (merged) {
            serviceOrder = merged;
            console.log(
              `[pending-commands] O.S. ${id}: espelho sincronizado ${holder.id} mesclado automaticamente no SEQOS ${result.seqOs}.`,
            );
          } else {
            await prisma.serviceOrder.updateMany({
              where: { id, tenantId: tenant.id },
              data: {
                status: 'ERRO_INTEGRACAO',
                technicalNotes: `SEQOS ${result.seqOs} ja foi criado no Firebird, mas ja pertence a outra O.S. no CRM (id ${holder?.id || 'desconhecido'}) - provavelmente duas solicitacoes para o mesmo cliente/equipamento. Verifique manualmente no iLux.`,
              },
            });
            console.warn(`[pending-commands] O.S. ${id}: SEQOS ${result.seqOs} ja pertence a outra O.S. do CRM (${holder?.id}). Marcada como ERRO_INTEGRACAO para revisao manual em vez de reenfileirar para sempre.`);
            return res.json({ ok: true, note: 'SEQOS ja associado a outra O.S. no CRM; marcada para revisao manual.' });
          }
        } else {
          throw updateError;
        }
      }
      if (result.printData && typeof result.printData === 'object') {
        try {
          await upsertRawRecord(
            tenant.id,
            'firebird',
            'osPrintData',
            String(result.seqOs),
            result.printData,
          );
        } catch (printDataError) {
          console.warn(
            `[pending-commands] O.S. ${result.seqOs} confirmada, mas o histórico de impressão não foi armazenado:`,
            printDataError.message,
          );
        }
      }
      if (serviceOrder.ticketId) {
        const payload = JSON.stringify({
          serviceOrderId: serviceOrder.id,
          seqOs: String(result.seqOs),
        });
        const existingEvent = await prisma.ticketEvent.findFirst({
          where: {
            ticketId: serviceOrder.ticketId,
            tenantId: tenant.id,
            type: 'os_created',
            payload,
          },
        });
        if (!existingEvent) {
          await prisma.ticketEvent.create({
            data: {
              ticketId: serviceOrder.ticketId,
              tenantId: tenant.id,
              type: 'os_created',
              payload,
            },
          });
        }
      }
      setImmediate(() => {
        sendServiceOrderManagerCopy(tenant.id, serviceOrder.id).catch((managerCopyError) => {
          console.error(
            `[pending-commands] O.S. ${result.seqOs} confirmada, mas a cópia para o gestor não foi enviada:`,
            managerCopyError.message,
          );
        });
      });
      console.log(`[pending-commands] OS ${id} associada ao SEQOS ${result.seqOs} com sucesso.`);
    } else {
      await prisma.serviceOrder.updateMany({
        where: { id, tenantId: tenant.id, externalId: null },
        data: { status: 'ERRO_INTEGRACAO' },
      });
      console.warn(`[pending-commands] Falha ao processar comando OS ${id}:`, error);
    }

    res.json({ ok: true });
  } catch (err) {
    // err.message sozinho as vezes nao diz muito (ex.: erros do Prisma);
    // o stack completo é o que realmente ajuda a diagnosticar um 500 aqui
    // depois, sem precisar reproduzir o cenario as cegas.
    console.error('[pending-commands-callback] erro:', err.stack || err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

// Normaliza a identidade que o agente Firebird ja envia em cada ping (corpo +
// headers x-ilux-agent-*). O corpo tem precedencia sobre o header; campos
// ausentes viram null para nao sobrescrever dados bons num payload parcial.
function agentIdentityFromPing(req) {
  const body = req.body || {};
  const health = body.health && typeof body.health === 'object' ? body.health : {};
  const header = (name) => (typeof req.header === 'function' ? req.header(name) : undefined);

  const installId = pick(health.installId, header('x-ilux-agent-id'));
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.map((item) => String(item).trim()).filter(Boolean).slice(0, 50)
    : null;
  const processIdNumber = Number.parseInt(health.processId, 10);

  return {
    installId: installId ? installId.slice(0, 200) : null,
    version: pick(body.version, header('x-ilux-agent-version')),
    protocolVersion: pick(body.protocolVersion, header('x-ilux-agent-protocol')),
    capabilities: capabilities && capabilities.length ? capabilities : null,
    runtime: pick(health.runtime),
    processId: Number.isInteger(processIdNumber) ? processIdNumber : null,
    healthStatus: pick(health.status),
    hostname: pick(health.hostname, body.hostname),
    compatibility: body.compatibility && typeof body.compatibility === 'object' ? body.compatibility : null,
    ip: String(req.ip || req.socket?.remoteAddress || '').trim() || null,
  };
}

// Chave da instalacao no inventario. Idealmente o installId que o agente
// persiste (x-ilux-agent-id / health.installId). Mas hoje ensure_agent_install_id
// so roda no entrypoint CLI: quem abre o agente pela GUI (caso normal) nao
// manda installId. Nesse caso usamos uma chave sintetica "legacy:<host|ip>"
// para a instalacao ainda aparecer com versao e drift - o que a Fase 1 quer.
// Quando o agente passar a mandar installId, cada instalacao ganha sua linha.
function agentInventoryKey(identity) {
  if (identity.installId) return identity.installId;
  return `legacy:${identity.hostname || identity.ip || 'desconhecido'}`;
}

// Registro de inventario da instalacao. E telemetria de melhor esforco: uma
// falha aqui nunca pode derrubar o ping (que e o sinal de saude do agente).
async function recordAgentInventory(tenantId, identity) {
  const installId = agentInventoryKey(identity);
  const data = {
    version: identity.version,
    protocolVersion: identity.protocolVersion,
    capabilities: identity.capabilities ?? undefined,
    runtime: identity.runtime,
    processId: identity.processId,
    healthStatus: identity.healthStatus,
    hostname: identity.hostname,
    compatibility: identity.compatibility ?? undefined,
    lastPingIp: identity.ip,
    lastSeenAt: new Date(),
  };
  const patch = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== null && value !== undefined),
  );
  try {
    await prisma.firebirdAgent.upsert({
      where: { tenantId_installId: { tenantId, installId } },
      create: { tenantId, installId, ...data },
      update: patch,
    });
  } catch (err) {
    console.error('[agent-ping] falha ao registrar inventario do agente:', err.message);
  }
}

async function agentPing(req, res) {
  try {
    const { tenantSlug } = req.body || {};
    const { tenant } = await resolveTenantContext(tenantSlug, req, { requireInstance: false });
    assertToken(req, tenant);

    await prisma.tenantSettings.update({
      where: { tenantId: tenant.id },
      data: {
        firebirdLastSyncAt: new Date(),
        firebirdLastSyncStatus: 'online'
      }
    });

    const identity = agentIdentityFromPing(req);
    await recordAgentInventory(tenant.id, identity);

    // Sinal de "agente desatualizado" na propria resposta do ping: o agente ja
    // manda a versao que roda; aqui comparamos com o release.json publicado no
    // volume. Best-effort - sem manifesto, so devolve { ok: true }.
    const response = { ok: true };
    let latestVersion = null;
    try {
      latestVersion = agentController.readReleaseManifest()?.version || null;
    } catch (err) {
      console.error('[agent-ping] falha ao ler o manifesto de release:', err.message);
    }
    if (latestVersion) {
      response.latestVersion = latestVersion;
      response.updateAvailable = isOutdated(identity.version, latestVersion);
    }

    res.json(response);
  } catch (err) {
    console.error('[agent-ping] erro:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

async function downloadAgentRelease(req, res) {
  try {
    const { tenant } = await resolveTenantContext(req.query.tenantSlug, req, { requireInstance: false });
    assertToken(req, tenant);
    return agentController.downloadAgentRelease(req, res);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
}

module.exports = {
  pushBatch,
  reconcileReceivablesSnapshot,
  reconcileEquipmentsSnapshot,
  reconcileTechniciansSnapshot,
  getPendingCommands,
  commandCallback,
  agentPing,
  downloadAgentRelease,
  agentIdentityFromPing,
  agentInventoryKey,
  recordAgentInventory,
  resolveTenantContext,
  firebirdTokenFromRequest,
  isImportedServiceOrderMirror,
  mergeImportedServiceOrderMirror,
};
