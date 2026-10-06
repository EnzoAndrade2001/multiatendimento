const prisma = require('../lib/prisma');
const { mapEquipmentType } = require('../utils/equipmentMapper');
const { listCustomerEquipmentsFromIluxWeb } = require('./iluxWebService');

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

    // 1. Sincroniza em tempo real com o ILUX WEB caso o cliente esteja vinculado
    const customerIdentifier = String(
      contact.crmCustomer?.externalId
      || contact.crmCustomer?.id
      || contact.externalId
      || contact.crmCustomerId,
    ).trim();

    if (customerIdentifier) {
      try {
        const iluxEquipments = await listCustomerEquipmentsFromIluxWeb(customerIdentifier);
        if (Array.isArray(iluxEquipments) && iluxEquipments.length > 0) {
          for (const eq of iluxEquipments) {
            const externalId = String(eq.externalId || eq.id || eq.serialNumber || '').trim();
            if (!externalId) continue;

            const equipmentType = mapEquipmentType(eq.type, eq.model);
            const address = eq.address || eq.installLocation || null;
            const sector = eq.sector || eq.department || 'Geral';

            // Atualiza/Cria em CrmEquipment associado ao crmCustomerId
            await prisma.crmEquipment.upsert({
              where: {
                tenantId_externalSource_externalId: {
                  tenantId,
                  externalSource: 'LCDDIGITALWEB',
                  externalId,
                },
              },
              update: {
                customerId: contact.crmCustomerId,
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
                customerId: contact.crmCustomerId,
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

            // Vincula no Equipment local apontando para este contato WhatsApp
            const existingEquip = await prisma.equipment.findFirst({
              where: {
                tenantId,
                externalId,
              },
            });

            if (existingEquip) {
              await prisma.equipment.update({
                where: { id: existingEquip.id },
                data: {
                  contactId: contact.id,
                  model: eq.model || existingEquip.model,
                  manufacturer: eq.manufacturer || existingEquip.manufacturer,
                  type: equipmentType,
                  serialNumber: eq.serialNumber || existingEquip.serialNumber,
                  sector,
                  address,
                  isActive: eq.isActive !== false,
                },
              });
            } else {
              await prisma.equipment.create({
                data: {
                  tenantId,
                  contactId: contact.id,
                  externalSource: 'LCDDIGITALWEB',
                  externalId,
                  model: eq.model || 'Equipamento',
                  manufacturer: eq.manufacturer || null,
                  type: equipmentType,
                  serialNumber: eq.serialNumber || null,
                  sector,
                  address,
                  isActive: eq.isActive !== false,
                },
              });
            }
          }
        }
      } catch (iluxSyncError) {
        console.warn(`[crmSyncService] Erro ao buscar equipamentos do ILUX WEB para ${customerIdentifier}:`, iluxSyncError?.message || iluxSyncError);
      }
    }

    // 2. Garante que qualquer outro CrmEquipment já em cache para o cliente seja refletido no contato
    const crmEquipments = await prisma.crmEquipment.findMany({
      where: {
        tenantId,
        customerId: contact.crmCustomerId,
        isActive: true,
      },
    });

    for (const crmEquip of crmEquipments) {
      const externalSource = crmEquip.externalSource || 'firebird';
      const externalId = crmEquip.externalId;
      if (!externalId) continue;

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
            isActive: crmEquip.isActive,
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
            isActive: crmEquip.isActive,
          },
        });
      }
    }

    console.log(`[crmSyncService] Sincronização concluída com sucesso para Contact ${contactId}`);
  } catch (err) {
    console.error(`[crmSyncService] Erro ao sincronizar para contato ${contactId}:`, err);
  }
}

module.exports = {
  syncCrmEquipmentsToEquipment,
};
