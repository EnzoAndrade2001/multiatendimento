const prisma = require('../lib/prisma');
const { mapEquipmentType } = require('../utils/equipmentMapper');
const { getCustomer360FromIluxWeb, isIluxWebConfigured } = require('./iluxWebService');
const { isLcdOfficialEquipmentSource } = require('../utils/externalSource');
const { readEquipmentLocation } = require('../utils/equipmentLocation');

const OFFICIAL_EQUIPMENT_SOURCE = 'LCDDIGITALWEB';
const OFFICIAL_EQUIPMENT_SOURCES = ['LCDDIGITALWEB', 'lcd_digital_web', 'lcd-digital-web', 'ilux_web', 'ilux-web', 'iluxweb'];

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? null;
}

function resolveEquipmentMirrorContactId(mirror, relatedContactIds, currentContactId) {
  const relatedIds = new Set((relatedContactIds || []).filter(Boolean).map(String));
  const mirrorContactId = mirror?.contactId ? String(mirror.contactId) : '';
  return mirrorContactId && relatedIds.has(mirrorContactId)
    ? mirror.contactId
    : currentContactId;
}

function isActiveValue(value, fallback = true) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toUpperCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  if (['0', 'N', 'NAO', 'FALSE', 'INACTIVE', 'INATIVO', 'CANCELADO', 'REMOVIDO'].includes(normalized)) return false;
  return !['0', 'N', 'NAO', 'NÃO', 'FALSE', 'INACTIVE', 'INATIVO', 'CANCELADO', 'REMOVIDO'].includes(
    String(value).trim().toUpperCase(),
  );
}

function normalizeOfficialEquipment(source, customerExternalId) {
  const raw = source || {};
  const externalId = firstValue(raw.externalId, raw.codigoLegado, raw.codigo, raw.id);
  if (!externalId) return null;
  const location = readEquipmentLocation(raw);

  const updatedAtValue = firstValue(raw.updatedAt, raw.atualizadoEm, raw.updated_at);
  const updatedAt = updatedAtValue ? new Date(updatedAtValue) : null;
  const explicitActive = firstValue(raw.isActive, raw.active, raw.ativo);
  const explicitInactive = raw.inactive === true
    || ['INATIVO', 'INACTIVE', 'CANCELADO', 'REMOVIDO'].includes(String(raw.status || '').trim().toUpperCase());
  return {
    externalId: String(externalId),
    externalSource: OFFICIAL_EQUIPMENT_SOURCE,
    customerExternalId: firstValue(raw.customerExternalId, raw.clienteCodigoLegado, customerExternalId),
    externalUpdatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
    model: firstValue(raw.model, raw.modelo, raw.description, raw.descricao) || `Equipamento ${externalId}`,
    manufacturer: firstValue(raw.manufacturer, raw.fabricante, raw.marca),
    type: firstValue(raw.type, raw.tipo),
    serialNumber: firstValue(raw.serialNumber, raw.numeroSerie, raw.serie),
    assetTag: firstValue(raw.assetTag, raw.patrimonio),
    sector: firstValue(raw.sector, raw.departamento, raw.depto),
    installLocation: location.installLocation,
    address: location.address,
    city: location.city,
    state: location.state,
    isActive: isActiveValue(explicitActive, !explicitInactive),
    raw,
  };
}

/**
 * LCD Digital Web is the canonical source for customer/equipment links.
 * The CRM keeps a local mirror for fast selectors, but never invents or
 * preserves an active link that is absent from the official LCD response.
 */
async function syncOfficialEquipments(tenantId, customerId) {
  const customer = await prisma.crmCustomer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, externalId: true },
  });
  if (!customer?.externalId || !isIluxWebConfigured()) {
    return {
      available: false,
      source: OFFICIAL_EQUIPMENT_SOURCE,
      equipmentIds: new Set(),
      error: new Error('LCDDIGITALWEB não está configurado como fonte oficial do CRM.'),
    };
  }

  let result;
  try {
    result = await getCustomer360FromIluxWeb(customer.externalId);
  } catch (error) {
    console.warn(`[crmSyncService] LCD Digital Web indisponível para cliente ${customer.externalId}; usando cache local:`, error.message);
    return { available: false, source: OFFICIAL_EQUIPMENT_SOURCE, equipmentIds: new Set(), error };
  }

  const rawEquipments = result?.item?.equipments;
  if (!Array.isArray(rawEquipments)) {
    return {
      available: false,
      source: OFFICIAL_EQUIPMENT_SOURCE,
      equipmentIds: new Set(),
      error: new Error('LCDDIGITALWEB não devolveu a lista oficial de equipamentos.'),
    };
  }

  const officialEquipments = rawEquipments
    .map((equipment) => normalizeOfficialEquipment(equipment, customer.externalId))
    .filter(Boolean);
  const officialIds = new Set(
    officialEquipments.filter((equipment) => equipment.isActive).map((equipment) => equipment.externalId),
  );

  // Any active local record for this customer that is absent from the
  // authoritative LCD list is stale (removed, transferred, or unlinked).
  await prisma.crmEquipment.updateMany({
    where: {
      tenantId,
      customerId: customer.id,
      externalSource: { in: OFFICIAL_EQUIPMENT_SOURCES },
      isActive: true,
      ...(officialIds.size ? { externalId: { notIn: [...officialIds] } } : {}),
    },
    data: { isActive: false },
  });

  for (const official of officialEquipments) {
    const candidates = await prisma.crmEquipment.findMany({
      where: { tenantId, externalId: official.externalId },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });
    const canonical = candidates.find((record) => isLcdOfficialEquipmentSource(record.externalSource))
      || candidates.find((record) => record.customerId === customer.id)
      || candidates[0]
      || null;
    const data = {
      customerId: customer.id,
      externalSource: official.externalSource,
      externalUpdatedAt: official.externalUpdatedAt,
      model: official.model,
      manufacturer: official.manufacturer,
      type: official.type,
      serialNumber: official.serialNumber,
      assetTag: official.assetTag,
      sector: official.sector,
      installLocation: official.installLocation,
      address: official.address,
      city: official.city,
      state: official.state,
      raw: official.raw,
      isActive: official.isActive,
    };

    const saved = canonical
      ? await prisma.crmEquipment.update({ where: { id: canonical.id }, data })
      : await prisma.crmEquipment.create({
        data: { tenantId, externalSource: official.externalSource, externalId: official.externalId, ...data },
      });

    // Do not leave two active customer links for the same physical equipment.
    const duplicateIds = candidates.filter((record) => record.id !== saved.id).map((record) => record.id);
    if (duplicateIds.length) {
      await prisma.crmEquipment.updateMany({
        where: { tenantId, id: { in: duplicateIds } },
        data: { isActive: false },
      });
    }
  }

  return { available: true, equipmentIds: officialIds };
}

async function syncCrmEquipmentsToEquipment(tenantId, contactId) {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId },
    });
    
    if (!contact || !contact.crmCustomerId) {
      console.log(`[crmSyncService] Contato ${contactId} não está vinculado a um cliente CRM ou não existe.`);
      return;
    }

    console.log(`[crmSyncService] Sincronizando equipamentos para contato ${contactId}`);

    const officialSync = await syncOfficialEquipments(tenantId, contact.crmCustomerId);

    // O cadastro Firebird não é fallback operacional da instalação LCD. Se o
    // LCDDIGITALWEB estiver indisponível, preservamos apenas o último espelho
    // oficial já gravado e nunca promovemos equipamento Firebird para a tela.
    if (!officialSync.available) {
      console.warn(`[crmSyncService] sincronização oficial indisponível para contato ${contactId}:`, officialSync.error?.message || 'sem resposta');
      return;
    }

    const relatedContacts = await prisma.contact.findMany({
      where: { tenantId, crmCustomerId: contact.crmCustomerId },
      select: { id: true },
    });
    const relatedContactIds = relatedContacts.map((item) => item.id);

    const crmEquipments = await prisma.crmEquipment.findMany({
      where: {
        tenantId,
        customerId: contact.crmCustomerId,
        externalSource: { in: OFFICIAL_EQUIPMENT_SOURCES },
        isActive: true
      }
    });

    if (officialSync.available) {
      // Keep the local OS selector aligned with the official LCD list too.
      // A local row is only a cache and must not survive as active after the
      // LCD says that the equipment is no longer linked to this contact.
      await prisma.equipment.updateMany({
        where: {
          tenantId,
          contactId: { in: relatedContactIds.length ? relatedContactIds : [contact.id] },
          isActive: true,
          ...(officialSync.equipmentIds.size
            ? { externalId: { notIn: [...officialSync.equipmentIds] } }
            : {}),
        },
        data: { isActive: false },
      });
    }

    for (const crmEquip of crmEquipments) {
      // Official LCD rows are tagged explicitly. Preserve that identity in
      // the OS mirror so a later Firebird push cannot create a second active
      // row for the same physical machine.
      const externalSource = OFFICIAL_EQUIPMENT_SOURCE;
      const externalId = crmEquip.externalId;
      const equipmentData = {
        externalSource,
        model: crmEquip.model,
        manufacturer: crmEquip.manufacturer,
        type: mapEquipmentType(crmEquip.type, crmEquip.model),
        serialNumber: crmEquip.serialNumber,
        sector: crmEquip.sector || crmEquip.installLocation || 'Geral',
        address: crmEquip.address,
        isActive: crmEquip.isActive,
      };
      const existingMirrors = await prisma.equipment.findMany({
        where: { tenantId, externalId },
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      });
      const canonicalMirror = existingMirrors.find((record) => isLcdOfficialEquipmentSource(record.externalSource))
        || existingMirrors.find((record) => record.contactId === contact.id)
        || existingMirrors[0]
        || null;
      const mirrorContactId = resolveEquipmentMirrorContactId(canonicalMirror, relatedContactIds, contact.id);
      const savedMirror = canonicalMirror
        ? await prisma.equipment.update({
          where: { id: canonicalMirror.id },
          data: { ...equipmentData, contactId: mirrorContactId },
        })
        : await prisma.equipment.create({ data: { tenantId, externalId, ...equipmentData, contactId: contact.id } });
      const duplicateMirrorIds = existingMirrors
        .filter((record) => record.id !== savedMirror.id)
        .map((record) => record.id);
      if (duplicateMirrorIds.length) {
        await prisma.serviceOrder.updateMany({
          where: { tenantId, equipmentId: { in: duplicateMirrorIds } },
          data: { equipmentId: savedMirror.id },
        });
        await prisma.equipment.updateMany({
          where: { tenantId, id: { in: duplicateMirrorIds } },
          data: { isActive: false },
        });
      }
    }
    console.log(`[crmSyncService] Sincronização concluída com sucesso para Contact ${contactId}`);
  } catch (err) {
    console.error(`[crmSyncService] Erro ao sincronizar para contato ${contactId}:`, err);
  }
}

module.exports = {
  normalizeOfficialEquipment,
  resolveEquipmentMirrorContactId,
  syncOfficialEquipments,
  syncCrmEquipmentsToEquipment
};
