const prisma = require('../lib/prisma');
const { mapEquipmentType } = require('../utils/equipmentMapper');
const { listCustomerEquipmentsFromIluxWeb, fetchCatalogFromIluxWeb } = require('./iluxWebService');

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
    const installLocation = eq.installLocation || null;
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
        installLocation,
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
        installLocation,
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

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/**
 * Sincroniza o catálogo completo de clientes, contratos e equipamentos ativos
 * diretamente do LCDWEB (fonte oficial), criando clientes novos sem código legado
 * e atualizando contratos/equipamentos sem duplicar registros do Firebird.
 */
async function syncCatalogFromLcdWeb(tenantId) {
  if (!tenantId) return { ok: false, reason: 'tenantId ausente' };

  const catalog = await fetchCatalogFromIluxWeb();
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  if (items.length === 0) {
    return { ok: true, customersCreated: 0, customersUpdated: 0, contractsSynced: 0, equipmentsSynced: 0 };
  }

  const existingCustomers = await prisma.crmCustomer.findMany({
    where: { tenantId },
    select: { id: true, externalSource: true, externalId: true, cpfCnpj: true },
  });

  const byExternalId = new Map();
  const byCpfCnpj = new Map();
  for (const c of existingCustomers) {
    const ext = String(c.externalId || '').trim();
    if (ext) byExternalId.set(ext, c);
    const doc = onlyDigits(c.cpfCnpj);
    if (doc && doc.length >= 11 && !byCpfCnpj.has(doc)) {
      byCpfCnpj.set(doc, c);
    }
  }

  let customersCreated = 0;
  let customersUpdated = 0;
  let contractsSynced = 0;
  let equipmentsSynced = 0;
  const now = new Date();

  for (const item of items) {
    const docDigits = onlyDigits(item.cpfCnpj);
    const legacyExt = item.codigoLegado != null ? String(item.codigoLegado).trim() : '';
    const lcdExt = String(item.id || '').trim();
    if (!lcdExt) continue;

    let customer =
      (legacyExt && byExternalId.get(legacyExt)) ||
      byExternalId.get(lcdExt) ||
      (docDigits.length >= 11 && byCpfCnpj.get(docDigits)) ||
      null;

    const customerData = {
      name: item.name || 'Cliente',
      fantasyName: item.fantasyName || null,
      cpfCnpj: item.cpfCnpj || null,
      email: item.email || null,
      phone: item.phone || null,
      address: item.address || null,
      neighborhood: item.neighborhood || null,
      city: item.city || null,
      state: item.state || null,
      zipCode: item.zipCode || null,
      contactName: item.contactName || null,
      externalUpdatedAt: item.updatedAt ? new Date(item.updatedAt) : now,
    };

    if (customer) {
      await prisma.crmCustomer.update({
        where: { id: customer.id },
        data: customerData,
      });
      customersUpdated++;
    } else {
      customer = await prisma.crmCustomer.create({
        data: {
          tenantId,
          externalSource: 'LCDDIGITALWEB',
          externalId: lcdExt,
          ...customerData,
        },
        select: { id: true, externalSource: true, externalId: true, cpfCnpj: true },
      });
      byExternalId.set(lcdExt, customer);
      if (docDigits.length >= 11) byCpfCnpj.set(docDigits, customer);
      customersCreated++;
    }

    const customerExtId = String(customer.externalId).trim();
    const contracts = Array.isArray(item.contracts) ? item.contracts : [];
    const activeLcdContractIds = new Set();
    const activeEquipmentExternalIds = new Set();

    for (const ct of contracts) {
      const ctExtId = String(ct.id || '').trim();
      if (!ctExtId) continue;
      if (ct.isActive) activeLcdContractIds.add(ctExtId);

      await prisma.crmContract.upsert({
        where: {
          tenantId_externalSource_externalId: {
            tenantId,
            externalSource: 'LCDDIGITALWEB',
            externalId: ctExtId,
          },
        },
        update: {
          customerExternalId: customerExtId,
          number: ct.number || null,
          type: ct.type || 'LOCACAO',
          modality: ct.modality || null,
          status: ct.status || (ct.isActive ? 'ATIVO' : 'CANCELADO'),
          isActive: Boolean(ct.isActive),
          startsAt: ct.startsAt ? new Date(ct.startsAt) : null,
          endsAt: ct.endsAt ? new Date(ct.endsAt) : null,
          monthlyValue: Number(ct.monthlyValue || 0),
          activeEquipment: Number(ct.activeEquipment || 0),
          externalUpdatedAt: ct.updatedAt ? new Date(ct.updatedAt) : now,
        },
        create: {
          tenantId,
          externalSource: 'LCDDIGITALWEB',
          externalId: ctExtId,
          customerExternalId: customerExtId,
          number: ct.number || null,
          type: ct.type || 'LOCACAO',
          modality: ct.modality || null,
          status: ct.status || (ct.isActive ? 'ATIVO' : 'CANCELADO'),
          isActive: Boolean(ct.isActive),
          startsAt: ct.startsAt ? new Date(ct.startsAt) : null,
          endsAt: ct.endsAt ? new Date(ct.endsAt) : null,
          monthlyValue: Number(ct.monthlyValue || 0),
          activeEquipment: Number(ct.activeEquipment || 0),
          externalUpdatedAt: ct.updatedAt ? new Date(ct.updatedAt) : now,
        },
      });
      contractsSynced++;

      const equips = Array.isArray(ct.equipments) ? ct.equipments : [];
      for (const eq of equips) {
        const eqExtId = String(eq.externalId || eq.id || eq.serialNumber || '').trim();
        if (!eqExtId) continue;
        const eqIsActive = eq.isActive !== false;
        if (eqIsActive) {
          activeEquipmentExternalIds.add(eqExtId);
          if (eq.id) activeEquipmentExternalIds.add(String(eq.id).trim());
          if (eq.codigoLegado) activeEquipmentExternalIds.add(String(eq.codigoLegado).trim());
        } else if (activeEquipmentExternalIds.has(eqExtId)) {
          // Já processado como ativo em outro contrato deste cliente; não sobrescrever com inativo
          continue;
        }

        const equipmentType = mapEquipmentType(eq.type, eq.model);
        const cliFallbackAddr = [item.address, item.neighborhood].filter(Boolean).join(', ') || null;
        const eqAddress = eq.address || cliFallbackAddr || eq.installLocation || null;
        const eqInstallLocation = eq.installLocation || null;
        const eqSector = eq.sector || 'Geral';

        await prisma.crmEquipment.upsert({
          where: {
            tenantId_externalSource_externalId: {
              tenantId,
              externalSource: 'LCDDIGITALWEB',
              externalId: eqExtId,
            },
          },
          update: {
            customerId: customer.id,
            model: eq.model || 'Equipamento',
            manufacturer: eq.manufacturer || null,
            type: equipmentType,
            serialNumber: eq.serialNumber || null,
            assetTag: eq.assetTag || null,
            sector: eqSector,
            installLocation: eqInstallLocation,
            address: eqAddress,
            city: eq.city || item.city || null,
            state: eq.state || item.state || null,
            contractExternalId: eqIsActive ? (eq.contractNumber || ct.number || ctExtId) : null,
            isActive: eqIsActive,
            externalUpdatedAt: now,
          },
          create: {
            tenantId,
            customerId: customer.id,
            externalSource: 'LCDDIGITALWEB',
            externalId: eqExtId,
            model: eq.model || 'Equipamento',
            manufacturer: eq.manufacturer || null,
            type: equipmentType,
            serialNumber: eq.serialNumber || null,
            assetTag: eq.assetTag || null,
            sector: eqSector,
            installLocation: eqInstallLocation,
            address: eqAddress,
            city: eq.city || item.city || null,
            state: eq.state || item.state || null,
            contractExternalId: eqIsActive ? (eq.contractNumber || ct.number || ctExtId) : null,
            isActive: eqIsActive,
            externalUpdatedAt: now,
          },
        });
        equipmentsSynced++;
      }
    }

    // Equipamentos diretos / avulsos vinculados ao cliente (sem contrato ativo)
    const directEquips = Array.isArray(item.directEquipments) ? item.directEquipments : [];
    for (const eq of directEquips) {
      const eqExtId = String(eq.externalId || eq.id || eq.serialNumber || '').trim();
      if (!eqExtId || activeEquipmentExternalIds.has(eqExtId)) continue;
      const eqIsActive = eq.isActive !== false;
      if (eqIsActive) {
        activeEquipmentExternalIds.add(eqExtId);
        if (eq.id) activeEquipmentExternalIds.add(String(eq.id).trim());
        if (eq.codigoLegado) activeEquipmentExternalIds.add(String(eq.codigoLegado).trim());
      }
      const equipmentType = mapEquipmentType(eq.type, eq.model);
      const cliFallbackAddr = [item.address, item.neighborhood].filter(Boolean).join(', ') || null;
      const eqAddress = eq.address || cliFallbackAddr || eq.installLocation || null;
      const eqInstallLocation = eq.installLocation || null;
      const eqSector = eq.sector || 'Geral';

      await prisma.crmEquipment.upsert({
        where: {
          tenantId_externalSource_externalId: {
            tenantId,
            externalSource: 'LCDDIGITALWEB',
            externalId: eqExtId,
          },
        },
        update: {
          customerId: customer.id,
          model: eq.model || 'Equipamento',
          manufacturer: eq.manufacturer || null,
          type: equipmentType,
          serialNumber: eq.serialNumber || null,
          assetTag: eq.assetTag || null,
          sector: eqSector,
          installLocation: eqInstallLocation,
          address: eqAddress,
          city: eq.city || item.city || null,
          state: eq.state || item.state || null,
          contractExternalId: null,
          isActive: eqIsActive,
          externalUpdatedAt: now,
        },
        create: {
          tenantId,
          customerId: customer.id,
          externalSource: 'LCDDIGITALWEB',
          externalId: eqExtId,
          model: eq.model || 'Equipamento',
          manufacturer: eq.manufacturer || null,
          type: equipmentType,
          serialNumber: eq.serialNumber || null,
          assetTag: eq.assetTag || null,
          sector: eqSector,
          installLocation: eqInstallLocation,
          address: eqAddress,
          city: eq.city || item.city || null,
          state: eq.state || item.state || null,
          contractExternalId: null,
          isActive: eqIsActive,
          externalUpdatedAt: now,
        },
      });
      equipmentsSynced++;
    }

    // Desativa contratos antigos do Firebird deste cliente para evitar contagem duplicada com o LCDWEB
    if (contracts.length > 0) {
      await prisma.crmContract.updateMany({
        where: {
          tenantId,
          customerExternalId: customerExtId,
          externalSource: { not: 'LCDDIGITALWEB' },
          isActive: true,
        },
        data: { isActive: false },
      });
    }

    // Reconcilia equipamentos inativos e preenche endereço faltante com o endereço principal do cliente
    const cliFallbackAddr = [item.address, item.neighborhood].filter(Boolean).join(', ') || null;
    const customerEquips = await prisma.crmEquipment.findMany({
      where: { tenantId, customerId: customer.id },
      select: { id: true, externalId: true, isActive: true, address: true, sector: true, city: true, state: true },
    });
    for (const oldEq of customerEquips) {
      const updates = {};
      if (oldEq.isActive && !activeEquipmentExternalIds.has(String(oldEq.externalId || '').trim())) {
        updates.isActive = false;
      }
      const addrClean = String(oldEq.address || '').trim();
      const sectorClean = String(oldEq.sector || '').trim();
      if (cliFallbackAddr && (!addrClean || (sectorClean && addrClean.toUpperCase() === sectorClean.toUpperCase()))) {
        updates.address = cliFallbackAddr;
      }
      if (!oldEq.city && item.city) updates.city = item.city;
      if (!oldEq.state && item.state) updates.state = item.state;
      if (Object.keys(updates).length > 0) {
        await prisma.crmEquipment.update({
          where: { id: oldEq.id },
          data: updates,
        });
      }
    }
  }

  console.log(
    `[crmSyncService] Catálogo LCDWEB sincronizado (tenant ${tenantId}): ` +
    `${customersCreated} clientes criados, ${customersUpdated} atualizados, ` +
    `${contractsSynced} contratos, ${equipmentsSynced} equipamentos ativos.`
  );
  return { ok: true, customersCreated, customersUpdated, contractsSynced, equipmentsSynced };
}

let catalogSyncRunning = false;
async function syncAllTenantsCatalogFromLcdWeb() {
  if (catalogSyncRunning) return;
  catalogSyncRunning = true;
  try {
    const targetTenantId = String(process.env.ILUX_WEB_TENANT_ID || process.env.LCD_TENANT_ID || 'cmonvybip0000gmivu3q6sqly').trim();
    const tenant = await prisma.tenant.findUnique({ where: { id: targetTenantId }, select: { id: true } });
    if (tenant) {
      await syncCatalogFromLcdWeb(tenant.id);
    }
  } catch (err) {
    console.error('[crmSyncService] Erro na sincronização periódica do catálogo LCDWEB:', err?.message || err);
  } finally {
    catalogSyncRunning = false;
  }
}

module.exports = {
  syncCustomerEquipmentsFromIluxWeb,
  syncCrmEquipmentsToEquipment,
  syncCatalogFromLcdWeb,
  syncAllTenantsCatalogFromLcdWeb,
};
