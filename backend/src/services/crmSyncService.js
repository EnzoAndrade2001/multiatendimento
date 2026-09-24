const prisma = require('../lib/prisma');
const { mapEquipmentType } = require('../utils/equipmentMapper');
const { getCustomer360FromIluxWeb } = require('./iluxWebService');

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? null;
}

function normalizeOfficialEquipment(source, customerExternalId) {
  const raw = source || {};
  const externalId = firstValue(raw.externalId, raw.codigoLegado, raw.codigo, raw.id);
  if (!externalId) return null;

  const updatedAtValue = firstValue(raw.updatedAt, raw.atualizadoEm, raw.updated_at);
  const updatedAt = updatedAtValue ? new Date(updatedAtValue) : null;
  return {
    externalId: String(externalId),
    externalSource: 'LCDDIGITALWEB',
    customerExternalId: firstValue(raw.customerExternalId, raw.clienteCodigoLegado, customerExternalId),
    externalUpdatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
    model: firstValue(raw.model, raw.modelo, raw.description, raw.descricao) || `Equipamento ${externalId}`,
    manufacturer: firstValue(raw.manufacturer, raw.fabricante, raw.marca),
    type: firstValue(raw.type, raw.tipo),
    serialNumber: firstValue(raw.serialNumber, raw.numeroSerie, raw.serie),
    assetTag: firstValue(raw.assetTag, raw.patrimonio),
    sector: firstValue(raw.sector, raw.departamento, raw.depto),
    installLocation: firstValue(raw.installLocation, raw.enderecoInstalacao, raw.address, raw.localInstalacao),
    address: firstValue(raw.address, raw.enderecoInstalacao, raw.installLocation, raw.localInstalacao),
    city: firstValue(raw.city, raw.cidade),
    state: firstValue(raw.state, raw.uf),
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
  if (!customer?.externalId) return { available: false, equipmentIds: new Set() };

  let result;
  try {
    result = await getCustomer360FromIluxWeb(customer.externalId);
  } catch (error) {
    console.warn(`[crmSyncService] LCD Digital Web indisponível para cliente ${customer.externalId}; usando cache local:`, error.message);
    return { available: false, equipmentIds: new Set(), error };
  }

  const rawEquipments = result?.item?.equipments;
  if (!Array.isArray(rawEquipments)) {
    return { available: false, equipmentIds: new Set() };
  }

  const officialEquipments = rawEquipments
    .map((equipment) => normalizeOfficialEquipment(equipment, customer.externalId))
    .filter(Boolean);
  const officialIds = new Set(officialEquipments.map((equipment) => equipment.externalId));

  // Any active local record for this customer that is absent from the
  // authoritative LCD list is stale (removed, transferred, or unlinked).
  await prisma.crmEquipment.updateMany({
    where: {
      tenantId,
      customerId: customer.id,
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
    const canonical = candidates.find((record) => record.customerId === customer.id) || candidates[0] || null;
    const data = {
      customerId: customer.id,
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
      isActive: true,
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
    const contact = await prisma.contact.findUnique({
      where: { id: contactId }
    });
    
    if (!contact || !contact.crmCustomerId) {
      console.log(`[crmSyncService] Contato ${contactId} não está vinculado a um cliente CRM ou não existe.`);
      return;
    }

    console.log(`[crmSyncService] Sincronizando equipamentos para contato ${contactId}`);

    const officialSync = await syncOfficialEquipments(tenantId, contact.crmCustomerId);

    const crmEquipments = await prisma.crmEquipment.findMany({
      where: {
        tenantId,
        customerId: contact.crmCustomerId,
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
          contactId: contact.id,
          isActive: true,
          ...(officialSync.equipmentIds.size
            ? { externalId: { notIn: [...officialSync.equipmentIds] } }
            : {}),
        },
        data: { isActive: false },
      });
    }

    for (const crmEquip of crmEquipments) {
      const externalSource = crmEquip.externalSource || 'firebird';
      const externalId = crmEquip.externalId;

      await prisma.equipment.upsert({
        where: {
          tenantId_externalSource_externalId: {
            tenantId,
            externalSource,
            externalId
          }
        },
        update: {
          contactId: contact.id,
          model: crmEquip.model,
          manufacturer: crmEquip.manufacturer,
          type: mapEquipmentType(crmEquip.type, crmEquip.model),
          serialNumber: crmEquip.serialNumber,
          sector: crmEquip.sector || crmEquip.installLocation || 'Geral',
          address: crmEquip.address,
          isActive: crmEquip.isActive
        },
        create: {
          tenantId,
          contactId: contact.id,
          externalSource,
          externalId,
          model: crmEquip.model,
          manufacturer: crmEquip.manufacturer,
          type: mapEquipmentType(crmEquip.type, crmEquip.model),
          serialNumber: crmEquip.serialNumber,
          sector: crmEquip.sector || crmEquip.installLocation || 'Geral',
          address: crmEquip.address,
          isActive: crmEquip.isActive
        }
      });
    }
    console.log(`[crmSyncService] Sincronização concluída com sucesso para Contact ${contactId}`);
  } catch (err) {
    console.error(`[crmSyncService] Erro ao sincronizar para contato ${contactId}:`, err);
  }
}

module.exports = {
  syncOfficialEquipments,
  syncCrmEquipmentsToEquipment
};
