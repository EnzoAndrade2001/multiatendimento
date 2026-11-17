const prisma = require('../lib/prisma');
const { mapEquipmentType } = require('../utils/equipmentMapper');
const { listCustomerEquipmentsFromIluxWeb } = require('./iluxWebService');

/**
 * Sincroniza os equipamentos do cliente com o LCDWEB e concilia o banco de dados do CRM.
 * Equipamentos de contratos cancelados ou que não constam mais na frota ativa do LCDWEB
 * são automaticamente marcados como isActive: false.
 */
async function syncCustomerEquipmentsFromIluxWeb(tenantId, customerId, customerExternalId) {
  if (!customerId) return [];
  const identifier = String(customerExternalId || customerId).trim();
  if (!identifier) return [];

  const iluxEquipments = await listCustomerEquipmentsFromIluxWeb(identifier);
  if (!Array.isArray(iluxEquipments)) return [];

  const activeExternalIds = new Set();
  const activeSerials = new Set();

  for (const eq of iluxEquipments) {
    const externalId = String(eq.externalId || eq.id || eq.serialNumber || '').trim();
    if (!externalId) continue;

    activeExternalIds.add(externalId);
    if (eq.id) activeExternalIds.add(String(eq.id).trim());
    if (eq.codigoLegado) activeExternalIds.add(String(eq.codigoLegado).trim());
    if (eq.serialNumber) {
      activeSerials.add(String(eq.serialNumber).trim().toUpperCase());
    }

    const equipmentType = mapEquipmentType(eq.type, eq.model);
    const address = eq.address || eq.installLocation || null;
    const sector = eq.sector || eq.department || 'Geral';

    await prisma.crmEquipment.upsert({
      where: {
        tenantId_externalSource_externalId: {
          tenantId,
          externalSource: 'LCDDIGITALWEB',
          externalId,
        },
      },
      update: {
        customerId,
        model: eq.model || 'Equipamento',
        manufacturer: eq.manufacturer || null,
        type: equipmentType,
        serialNumber: eq.serialNumber || null,
        assetTag: eq.assetTag || null,
        sector,
        installLocation: address,
        address,
        city: eq.city || null,
        state: eq.state || null,
        contractExternalId: eq.contractNumber || eq.contractExternalId || null,
        isActive: eq.isActive !== false,
      },
      create: {
        tenantId,
        customerId,
        externalSource: 'LCDDIGITALWEB',
        externalId,
        model: eq.model || 'Equipamento',
        manufacturer: eq.manufacturer || null,
        type: equipmentType,
        serialNumber: eq.serialNumber || null,
        assetTag: eq.assetTag || null,
        sector,
        installLocation: address,
        address,
        city: eq.city || null,
        state: eq.state || null,
        contractExternalId: eq.contractNumber || eq.contractExternalId || null,
        isActive: eq.isActive !== false,
      },
    });
  }

  // RECONCILIAÇÃO: Se o LCDWEB respondeu com a lista oficial de equipamentos ativos,
  // qualquer CrmEquipment deste cliente que NÃO esteja na resposta do LCDWEB (ou seja,
  // pertence a contrato cancelado, máquina recolhida ou código legado órfão)
  // DEVE ser marcado como isActive: false.
  const allCustomerEquips = await prisma.crmEquipment.findMany({
    where: {
      tenantId,
      customerId,
    },
  });

  for (const oldEquip of allCustomerEquips) {
    const oldExtId = String(oldEquip.externalId || '').trim();
    const oldSerial = String(oldEquip.serialNumber || '').trim().toUpperCase();

    // Está na lista de equipamentos confirmados ativos pelo LCDWEB?
    const isReturnedActive = activeExternalIds.has(oldExtId)
      || (oldSerial && activeSerials.has(oldSerial) && activeExternalIds.has(oldExtId));

    if (!isReturnedActive && oldEquip.isActive) {
      await prisma.crmEquipment.update({
        where: { id: oldEquip.id },
        data: { isActive: false },
      });
    }
  }

  return iluxEquipments;
}

async function syncCrmEquipmentsToEquipment(tenantId, contactId) {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      include: { crmCustomer: true },
    });

    if (!contact || !contact.crmCustomerId) {
      console.log(`[crmSyncService] Contato ${contactId} não está vinculado a um cliente CRM ou não existe.`);
      return;
    }

    console.log(`[crmSyncService] Sincronizando equipamentos para contato ${contactId} (cliente ${contact.crmCustomerId})`);

    const customerIdentifier = String(
      contact.crmCustomer?.externalId
      || contact.crmCustomer?.id
      || contact.externalId
      || contact.crmCustomerId,
    ).trim();

    if (customerIdentifier) {
      try {
        await syncCustomerEquipmentsFromIluxWeb(tenantId, contact.crmCustomerId, customerIdentifier);
      } catch (iluxSyncError) {
        console.warn(`[crmSyncService] Erro ao buscar equipamentos do ILUX WEB para ${customerIdentifier}:`, iluxSyncError?.message || iluxSyncError);
      }
    }

    // Reflete no Equipment do contato APENAS os equipamentos que estão ativos em CrmEquipment
    const activeCrmEquipments = await prisma.crmEquipment.findMany({
      where: {
        tenantId,
        customerId: contact.crmCustomerId,
        isActive: true,
      },
    });

    const activeExternalIds = new Set();
    const activeSerials = new Set();

    for (const crmEquip of activeCrmEquipments) {
      const externalSource = crmEquip.externalSource || 'LCDDIGITALWEB';
      const externalId = crmEquip.externalId;
      if (!externalId) continue;

      activeExternalIds.add(externalId);
      if (crmEquip.serialNumber) {
        activeSerials.add(crmEquip.serialNumber.trim().toUpperCase());
      }

      const existing = await prisma.equipment.findFirst({
        where: { tenantId, externalId },
      });

      if (existing) {
        await prisma.equipment.update({
          where: { id: existing.id },
          data: {
            contactId: contact.id,
            model: crmEquip.model || existing.model,
            manufacturer: crmEquip.manufacturer || existing.manufacturer,
            type: mapEquipmentType(crmEquip.type, crmEquip.model),
            serialNumber: crmEquip.serialNumber || existing.serialNumber,
            sector: crmEquip.sector || crmEquip.installLocation || 'Geral',
            address: crmEquip.address || existing.address,
            isActive: true,
          },
        });
      } else {
        await prisma.equipment.create({
          data: {
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
            isActive: true,
          },
        });
      }
    }

    // Inativa qualquer Equipment deste contato que não esteja na lista de equipamentos ativos
    const allContactEquips = await prisma.equipment.findMany({
      where: { tenantId, contactId: contact.id, isActive: true },
    });

    for (const cEq of allContactEquips) {
      const isStillActive = activeExternalIds.has(cEq.externalId)
        || (cEq.serialNumber && activeSerials.has(cEq.serialNumber.trim().toUpperCase()) && activeExternalIds.has(cEq.externalId));

      if (!isStillActive) {
        await prisma.equipment.update({
          where: { id: cEq.id },
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
  syncCustomerEquipmentsFromIluxWeb,
  syncCrmEquipmentsToEquipment,
};
