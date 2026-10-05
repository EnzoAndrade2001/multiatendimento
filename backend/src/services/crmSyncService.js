const prisma = require('../lib/prisma');
const { mapEquipmentType } = require('../utils/equipmentMapper');

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

    const crmEquipments = await prisma.crmEquipment.findMany({
      where: {
        tenantId,
        customerId: contact.crmCustomerId,
        isActive: true
      }
    });

    const validExternalIds = crmEquipments.map((e) => e.externalId).filter(Boolean);
    if (validExternalIds.length > 0) {
      await prisma.equipment.deleteMany({
        where: {
          tenantId,
          contactId: contact.id,
          externalId: { notIn: validExternalIds }
        }
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
  syncCrmEquipmentsToEquipment
};
