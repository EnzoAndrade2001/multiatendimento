const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const evolutionService = require('../services/evolutionService');
const { sendServiceOrderManagerCopy } = require('../services/serviceOrderManagerCopyService');
const { mapEquipmentType } = require('../utils/equipmentMapper');
const { mediaPath } = require('../utils/uploads');
const billingDocumentService = require('../services/billingDocumentService');
const { COMPANY_ENTITY, COMPANY_REQUEST_ENTITY, normalizeCompanyProfile } = require('../services/companyProfileService');

function pick(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const text = String(value).trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, dd, mm, yyyy, hh, mi, ss] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
}

function normalizePhone(value, fallback) {
  const phone = evolutionService.normalizePhoneNumber(value);
  if (phone) return phone;
  return fallback ? `FB-${fallback}` : null;
}

function normalizeStatus(value) {
  const text = pick(value)?.toUpperCase() || '';

  if (text.includes('CONCLU') || text.includes('FINALIZ')) return 'FINALIZADA';
  if (text.includes('AGUARD')) return 'AGUARDANDO_RETORNO';
  if (text.includes('ATEND')) return 'EM_ATENDIMENTO';
  return 'PENDENTE';
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

async function resolveTenantContext(tenantSlug) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    include: { settings: true, instances: true },
  });

  if (!tenant) {
    throw new Error('Tenant não encontrado para o slug informado.');
  }

  const instance =
    tenant.instances.find((item) => String(item.status).toLowerCase() === 'connected') ||
    tenant.instances[0];

  if (!instance) {
    throw new Error('Nenhuma instância de WhatsApp encontrada para esse tenant.');
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
    throw new Error('Token de sincronização não configurado no CRM.');
  }

  if (!provided || provided !== expected) {
    throw new Error('Token de sincronização inválido.');
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
    contractExternalId: pick(data.contractExternalId, data.seqContrato, data.seqcontrato),
    isActive: !['S', 'SIM', 'TRUE', '1'].includes(String(pick(data.inactive, data.tfinativo) || '').toUpperCase()),
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

  const defaults = {
    tenantId: tenant.id,
    contactId: contact.id,
    equipmentId: equipment.id,
    externalSource: 'firebird',
    externalId,
    externalUpdatedAt: normalizeDate(pick(data.updatedAt, data.atualizado, data.dtAtendimento, data.dtatendimento)),
    status: normalizeStatus(pick(data.status, data.nmStatus, data.tffaturar)),
    defect: pick(data.defect, data.nmDefeito, data.causa, data.sintoma),
    technicalNotes: [pick(data.action, data.acao), pick(data.observacao), pick(data.nmSuporteT)].filter(Boolean).join(' | ') || null,
    resolvedAt: normalizeDate(pick(data.resolvedAt, data.dtAtendimento, data.dtatendimento)),
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
        defect: defaults.defect || existing.defect,
        technicalNotes: defaults.technicalNotes || existing.technicalNotes,
        resolvedAt: defaults.resolvedAt || existing.resolvedAt,
      },
    });
  }

  return prisma.serviceOrder.create({ data: defaults });
}

async function pushBatch(req, res) {
  try {
    const { tenantSlug, entity, records } = req.body || {};

    if (!tenantSlug) {
      return res.status(400).json({ error: 'tenantSlug é obrigatório.' });
    }

    if (!entity || typeof entity !== 'string') {
      return res.status(400).json({ error: 'entity é obrigatório.' });
    }

    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'records deve ser uma lista.' });
    }

    const { tenant, instance } = await resolveTenantContext(tenantSlug);
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
      skipped: 0,
      errors: [],
    };

    for (const record of records) {
      try {
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
        } else if (entity === 'serviceOrders') {
          await upsertServiceOrder(tenant, instance, record);
          stats.serviceOrders += 1;
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

    res.json({
      ok: true,
      tenant: tenant.slug,
      entity,
      stats,
    });
  } catch (err) {
    console.error('[firebird-sync] erro:', err.message);
    res.status(500).json({ error: err.message });
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

async function getPendingCommands(req, res) {
  try {
    const { tenantSlug } = req.query;
    const waitSeconds = Math.max(0, Math.min(Number.parseInt(req.query.wait, 10) || 0, 25));
    if (!tenantSlug) {
      return res.status(400).json({ error: 'tenantSlug é obrigatório.' });
    }
    const { tenant } = await resolveTenantContext(tenantSlug);
    assertToken(req, tenant);

    const deadline = Date.now() + (waitSeconds * 1000);
    let pendingOS = [];
    let pendingBillingPdf = null;
    let pendingBillingDocument = null;
    let pendingCompanyProfile = null;

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

      if (pendingOS.length > 0 || pendingBillingPdf || pendingBillingDocument || pendingCompanyProfile || tenant.settings?.firebirdQueueBillingProcess || Date.now() >= deadline) break;
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

    res.json(commands);
  } catch (err) {
    console.error('[pending-commands] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function commandCallback(req, res) {
  try {
    const { id } = req.params;
    const { tenantSlug, success, result, error } = req.body || {};

    if (!tenantSlug) {
      return res.status(400).json({ error: 'tenantSlug é obrigatório.' });
    }
    const { tenant } = await resolveTenantContext(tenantSlug);
    assertToken(req, tenant);

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
    res.status(500).json({ error: err.message });
  }
}

async function agentPing(req, res) {
  try {
    const { tenantSlug } = req.body || {};
    if (!tenantSlug) {
      return res.status(400).json({ error: 'tenantSlug é obrigatório.' });
    }
    const { tenant } = await resolveTenantContext(tenantSlug);
    assertToken(req, tenant);

    await prisma.tenantSettings.update({
      where: { tenantId: tenant.id },
      data: {
        firebirdLastSyncAt: new Date(),
        firebirdLastSyncStatus: 'online'
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[agent-ping] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  pushBatch,
  getPendingCommands,
  commandCallback,
  agentPing,
  isImportedServiceOrderMirror,
  mergeImportedServiceOrderMirror,
};
