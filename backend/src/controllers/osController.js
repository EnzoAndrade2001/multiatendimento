const prisma = require('../lib/prisma');
const { isServiceOrderClosed, normalizeServiceOrderStatus } = require('../utils/serviceOrderStatus');
const { reconcileServiceOrderStatuses } = require('../services/serviceOrderStatusReconciliationService');
const pdfmake = require('pdfmake');
const path = require('path');
const fs = require('fs');
const aiService = require('../services/aiService');
const { draftServiceOrder } = aiService;
const { renderOfficialOsTemplate } = require('../templates/officialOsTemplate');
const { getLatestCompanyProfile } = require('../services/companyProfileService');
const { parseFirebirdDate } = require('../utils/firebirdDate');
const {
  createServiceOrderInIluxWeb,
  getCompanyProfileFromIluxWeb,
  isIluxWebConfigured,
  listContractsFromIluxWeb,
  listDefectTypesFromIluxWeb,
  listServiceOrdersFromIluxWeb,
} = require('../services/iluxWebService');

const OS_CONFIRMATION_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.OS_CONFIRMATION_TIMEOUT_MS, 10) || 30_000
);
const OS_DRAFT_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(Number.parseInt(process.env.OS_DRAFT_TIMEOUT_MS, 10) || 20_000, 60_000)
);

const ILUX_WEB_EQUIPMENT_SOURCES = new Set([
  'firebird',
  'ilux_web',
  'ilux-web',
  'iluxweb',
  'lcddigitalweb',
]);

const CRM_EXTERNAL_SOURCES = [
  'firebird',
  'LCDDIGITALWEB',
  'ilux_web',
  'ilux-web',
  'iluxweb',
  'lcddigitalweb',
];

function cleanLegacyDefect(value) {
  const text = String(value || '').trim();
  return text.replace(/^\s*\[Defeito\s+[^\]]+\]\s*/i, '').trim();
}

function isIluxWebEquipment(equipment) {
  const source = String(equipment?.externalSource || '').trim().toLowerCase();
  return Boolean(equipment?.externalId && ILUX_WEB_EQUIPMENT_SOURCES.has(source));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function osPdfFilename(number, customerName) {
  const safeCustomer = String(customerName || 'CLIENTE')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 80) || 'CLIENTE';
  return `OS ${number || 'SEM NUMERO'} - ${safeCustomer}.pdf`;
}

async function waitForIluxConfirmation(id, tenantId) {
  const deadline = Date.now() + OS_CONFIRMATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const order = await prisma.serviceOrder.findFirst({
      where: { id, tenantId },
      include: { contact: true, equipment: true },
    });
    if (!order) return null;
    if (order.externalId || order.status === 'ERRO_INTEGRACAO') return order;
    await sleep(250);
  }
  return prisma.serviceOrder.findFirst({
    where: { id, tenantId },
    include: { contact: true, equipment: true },
  });
}

function firstPdfValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function pdfDate(value, fallback = new Date()) {
  if (!value) return fallback;
  return parseFirebirdDate(value) || fallback;
}

function pdfOrderStatus(value) {
  return normalizeServiceOrderStatus(value);
}

async function resolveServiceOrderForPdf(tenantId, id) {
  const persisted = await prisma.serviceOrder.findFirst({
    where: {
      tenantId,
      OR: [{ id }, { externalId: String(id) }],
    },
    include: {
      contact: { include: { crmCustomer: true } },
      equipment: true,
      tenant: { include: { settings: true } },
      user: true,
    },
  });
  if (persisted) return { order: persisted, historicalRecord: null };

  // O CRM 360 mantem o historico completo em ExternalSyncRecord. Registros
  // antigos podem nao existir mais na tabela operacional (por exemplo, apos
  // uma desvinculacao/recriacao de equipamento), mas continuam validos no
  // Firebird e devem permanecer reimprimiveis.
  if (!/^\d+$/.test(String(id || ''))) return null;
  const historicalRecord = await prisma.externalSyncRecord.findUnique({
    where: {
      tenantId_source_entity_externalId: {
        tenantId,
        source: 'firebird',
        entity: 'serviceOrders',
        externalId: String(id),
      },
    },
  });
  if (!historicalRecord) return null;

  const payload = historicalRecord.payload && typeof historicalRecord.payload === 'object'
    ? historicalRecord.payload
    : {};
  const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const clientExternalId = String(firstPdfValue(payload.clientExternalId, raw.cdcliente, '') || '');
  const equipmentExternalId = String(firstPdfValue(payload.equipmentExternalId, raw.cdequipamento, '') || '');
  const [customer, crmEquipment, tenant] = await Promise.all([
    clientExternalId
      ? prisma.crmCustomer.findFirst({
        where: { tenantId, externalSource: 'firebird', externalId: clientExternalId },
      })
      : null,
    equipmentExternalId
      ? prisma.crmEquipment.findFirst({
        where: { tenantId, externalSource: 'firebird', externalId: equipmentExternalId },
      })
      : null,
    prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { settings: true },
    }),
  ]);
  if (!tenant) return null;

  const createdAt = pdfDate(
    firstPdfValue(raw.dtinclusao, payload.createdAt, historicalRecord.receivedAt),
    historicalRecord.receivedAt,
  );
  const createdAtWithTime = raw.dtinclusao
    ? (parseFirebirdDate(raw.dtinclusao, raw.hrinclusao) || createdAt)
    : createdAt;
  const contact = {
    id: customer?.id || `firebird-client-${clientExternalId || id}`,
    tenantId,
    externalSource: 'firebird',
    externalId: clientExternalId || null,
    crmCustomerId: customer?.id || null,
    crmCustomer: customer || null,
    name: firstPdfValue(customer?.name, payload.clientName, raw.nmcliente, `Cliente ${clientExternalId || id}`),
    fantasyName: customer?.fantasyName || null,
    phone: firstPdfValue(customer?.phone, payload.phone, raw.fone, `FB-${clientExternalId || id}`),
    whatsapp: customer?.phone || null,
    cpfCnpj: customer?.cpfCnpj || null,
    email: firstPdfValue(customer?.email, raw.email, null),
    address: firstPdfValue(customer?.address, payload.address, raw.endereco, null),
    city: firstPdfValue(customer?.city, payload.city, raw.cidade, null),
    state: firstPdfValue(customer?.state, payload.state, raw.uf, null),
    zipCode: firstPdfValue(customer?.zipCode, payload.zipCode, raw.cep, null),
  };
  const equipment = {
    id: crmEquipment?.id || `firebird-equipment-${equipmentExternalId || id}`,
    tenantId,
    contactId: contact.id,
    externalSource: 'firebird',
    externalId: equipmentExternalId || null,
    model: firstPdfValue(crmEquipment?.model, payload.equipmentModel, raw.modeloe, `Equipamento ${equipmentExternalId || id}`),
    manufacturer: firstPdfValue(crmEquipment?.manufacturer, payload.manufacturer, raw.fabricante, null),
    serialNumber: firstPdfValue(crmEquipment?.serialNumber, payload.serialNumber, raw.serie, null),
    sector: firstPdfValue(crmEquipment?.sector, payload.sector, raw.departamento, raw.localinstal, null),
    address: firstPdfValue(crmEquipment?.address, payload.address, raw.endereco, null),
    isActive: crmEquipment?.isActive ?? true,
  };

  return {
    historicalRecord,
    order: {
      id: `firebird-history-${id}`,
      tenantId,
      contactId: contact.id,
      equipmentId: equipment.id,
      externalSource: 'firebird',
      externalId: String(id),
      externalUpdatedAt: historicalRecord.syncedAt,
      requestKey: null,
      ticketId: null,
      cdOstp: null,
      nmsuportet: firstPdfValue(payload.nmSuporteT, raw.nmsuportet, null),
      defect: firstPdfValue(payload.defect, raw.obsdefeitocli, ''),
      status: pdfOrderStatus(firstPdfValue(payload.status, raw.nmstatus, raw.status)),
      technicalNotes: firstPdfValue(payload.action, payload.observacao, raw.obsdefeitoats, null),
      meters: null,
      userId: null,
      createdAt: createdAtWithTime,
      updatedAt: pdfDate(historicalRecord.syncedAt, createdAtWithTime),
      resolvedAt: payload.resolvedAt
        ? (parseFirebirdDate(payload.resolvedAt, raw.hratendimento) || pdfDate(payload.resolvedAt, null))
        : null,
      contact,
      equipment,
      tenant,
      user: null,
    },
  };
}

async function getEquipments(req, res) {
  const { contactId } = req.params;
  const { tenantId } = req.user;

  try {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return res.json([]);

    // Sincroniza os equipamentos do CRM para o contato
    const { syncCrmEquipmentsToEquipment } = require('../services/crmSyncService');
    await syncCrmEquipmentsToEquipment(tenantId, contactId);

    const equipments = await prisma.equipment.findMany({
      where: {
        tenantId,
        isActive: true,
        contactId
      },
      orderBy: { createdAt: 'desc' }
    });

    const externalIds = equipments
      .map((equipment) => equipment.externalId)
      .filter(Boolean);

    // Os equipamentos migrados do LCDDIGITALWEB usam externalSource
    // "LCDDIGITALWEB" (e os antigos usam "firebird"). O filtro anterior
    // considerava somente firebird, então descartava justamente as máquinas
    // que tinham endereço no vínculo do contrato.
    const crmEquipments = externalIds.length > 0
      ? await prisma.crmEquipment.findMany({
          where: {
            tenantId,
            externalSource: { in: CRM_EXTERNAL_SOURCES },
            externalId: { in: externalIds },
          },
          select: {
            externalId: true,
            address: true,
            city: true,
            state: true,
            sector: true,
            installLocation: true,
            raw: true,
          },
        })
      : [];
    const crmByExternalId = new Map(crmEquipments.map((equipment) => [equipment.externalId, equipment]));

    // O endereço operacional é mantido no vínculo equipamento-contrato do
    // iLux Web. Busca-o sob demanda para que a abertura da O.S. mostre a
    // filial correta mesmo quando o cache antigo do CRM não tinha endereço.
    const contractEquipmentByExternalId = new Map();
    let crmCustomer = null;
    if (contact.crmCustomerId) {
      crmCustomer = await prisma.crmCustomer.findFirst({
        where: { tenantId, id: contact.crmCustomerId },
        select: { externalId: true, address: true, city: true, state: true },
      });
    }
    if (crmCustomer?.externalId && isIluxWebConfigured()) {
      try {
        const contracts = await listContractsFromIluxWeb(crmCustomer.externalId, { limit: 250 });
        for (const contract of contracts.items || []) {
          for (const item of contract.equipments || []) {
            const id = String(item.externalId || item.id || '').trim();
            if (id && !contractEquipmentByExternalId.has(id)) contractEquipmentByExternalId.set(id, item);
          }
        }
      } catch (error) {
        // A falha transitória do iLux não impede abrir a O.S.; o cache local
        // continua disponível como fallback.
        console.warn('[getEquipments] endereço do vínculo indisponível:', error?.message || error);
      }
    }

    res.json(equipments.map((equipment) => {
      const crmEquipment = crmByExternalId.get(equipment.externalId);
      const contractEquipment = contractEquipmentByExternalId.get(String(equipment.externalId || '').trim());
      const raw = crmEquipment?.raw && typeof crmEquipment.raw === 'object' ? crmEquipment.raw : {};
      const address = contractEquipment?.address
        || contractEquipment?.installLocation
        || crmEquipment?.address
        || equipment.address
        || crmCustomer?.address
        || null;
      return {
        ...equipment,
        address,
        city: contractEquipment?.city || crmEquipment?.city || raw.cidade || raw.CIDADE || crmCustomer?.city || null,
        state: contractEquipment?.state || crmEquipment?.state || raw.uf || raw.UF || crmCustomer?.state || null,
        complement: contractEquipment?.complement || raw.complemento || raw.COMPLEMENTO || null,
        department: contractEquipment?.department || raw.departamento || raw.DEPARTAMENTO || crmEquipment?.sector || equipment.sector || null,
        installLocation: contractEquipment?.installLocation || crmEquipment?.installLocation || raw.localinstal || raw.LOCALINSTAL || null,
      };
    }));
  } catch (err) {
    console.error('[getEquipments] erro crítico:', err);
    res.status(500).json({ error: 'Erro ao buscar equipamentos' });
  }
}

async function addEquipment(req, res) {
  const { contactId } = req.params;
  const { manufacturer, model, serialNumber, sector, address, type } = req.body;
  const equipment = await prisma.equipment.create({
    data: {
      tenantId: req.user.tenantId,
      contactId,
      manufacturer,
      model,
      serialNumber,
      sector,
      address,
      type
    }
  });
  res.json(equipment);
}

async function updateEquipment(req, res) {
  const { id } = req.params;
  const { manufacturer, model, serialNumber, sector, address, type, isActive } = req.body;
  const equipment = await prisma.equipment.update({
    where: { id, tenantId: req.user.tenantId },
    data: { manufacturer, model, serialNumber, sector, address, type, isActive }
  });
  res.json(equipment);
}

async function deleteEquipment(req, res) {
  const { id } = req.params;
  const { tenantId } = req.user;
  try {
    await prisma.equipment.delete({ where: { id, tenantId } });
    res.json({ message: 'Equipamento excluído com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir equipamento' });
  }
}

async function getOpenOrdersForEquipment(req, res) {
  const { tenantId } = req.user;
  const { equipmentId } = req.params;
  const equipment = await prisma.equipment.findFirst({ where: { id: equipmentId, tenantId }, select: { id: true } });
  if (!equipment) return res.status(404).json({ error: 'Equipamento não encontrado.' });
  await reconcileServiceOrderStatuses(tenantId, { equipmentId });
  const orders = await prisma.serviceOrder.findMany({
    where: { tenantId, equipmentId, closedAt: null, resolvedAt: null },
    select: { id: true, externalId: true, status: true, cdOstp: true, defect: true, createdAt: true, ticketId: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });
  res.json(orders.filter((order) => !isServiceOrderClosed(order)).slice(0, 6));
}

async function getOSList(req, res) {
  const { startDate, endDate, search, status } = req.query;
  const { tenantId } = req.user;

  const where = { tenantId };

  if (status) {
    where.status = status;
  }

  if (startDate && startDate.length > 0) {
    if (!where.createdAt) where.createdAt = {};
    where.createdAt.gte = new Date(startDate);
  }
  if (endDate && endDate.length > 0) {
    if (!where.createdAt) where.createdAt = {};
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    where.createdAt.lte = end;
  }

  if (search) {
    where.OR = [
      { id: { contains: search, mode: 'insensitive' } },
      { contact: { name: { contains: search, mode: 'insensitive' } } },
      { contact: { fantasyName: { contains: search, mode: 'insensitive' } } },
      { equipment: { model: { contains: search, mode: 'insensitive' } } },
      { equipment: { serialNumber: { contains: search, mode: 'insensitive' } } },
      { equipment: { contact: { name: { contains: search, mode: 'insensitive' } } } },
      { equipment: { contact: { fantasyName: { contains: search, mode: 'insensitive' } } } }
    ];
  }

  const orders = await prisma.serviceOrder.findMany({
    where,
    include: {
      contact: true,
      equipment: {
        include: {
          contact: true
        }
      },
      user: { select: { name: true } },
      closedBy: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(orders);
}

async function createOS(req, res) {
  const { contactId, equipmentId, ticketId, requestKey, defect, cdOstp, cdDefeito, nmsuportet } = req.body;
  const { tenantId } = req.user;

  try {
    if (!contactId || !equipmentId || !ticketId || !requestKey || !cdOstp || !cdDefeito || !String(defect || '').trim()) {
      return res.status(400).json({ error: 'Cliente, equipamento, ticket, identificador, tipo de O.S., tipo de defeito e relato são obrigatórios.' });
    }
    const normalizedRequestKey = String(requestKey).trim().slice(0, 120);

    const [ticket, contact, equipment, osType, iluxDefectTypes] = await Promise.all([
      prisma.ticket.findFirst({ where: { id: ticketId, tenantId } }),
      prisma.contact.findFirst({
        where: { id: contactId, tenantId },
        include: { crmCustomer: true },
      }),
      prisma.equipment.findFirst({ where: { id: equipmentId, tenantId } }),
      prisma.crmOsType.findFirst({ where: { tenantId, code: String(cdOstp) } }),
      listDefectTypesFromIluxWeb(),
    ]);
    const defectType = iluxDefectTypes.find((item) => item.code === String(cdDefeito).trim().toUpperCase());

    if (!ticket || ticket.contactId !== contactId) {
      return res.status(400).json({ error: 'O ticket não pertence ao cliente informado.' });
    }
    if (!contact) return res.status(404).json({ error: 'Cliente não encontrado.' });
    if (!contact.externalId && !contact.crmCustomer?.externalId) {
      return res.status(400).json({ error: 'Vincule a conversa a um cliente do ILUX WEB antes de abrir a O.S.' });
    }
    if (!equipment) return res.status(404).json({ error: 'Equipamento não encontrado.' });
    if (!defectType) return res.status(400).json({ error: 'Selecione um tipo de defeito ativo do ILUX WEB.' });
    if (!isIluxWebEquipment(equipment)) {
      return res.status(400).json({ error: 'Selecione um equipamento sincronizado com o ILUX WEB.' });
    }
    // O vínculo confiável é a identidade do cliente no ILUX WEB, não Equipment.contactId:
    // Equipment é uma linha por máquina (única por externalId) e esse contactId é
    // reescrito toda vez que QUALQUER contato do mesmo cliente abre este modal
    // (syncCrmEquipmentsToEquipment). Comparar por contactId fazia dois atendentes
    // ou dois contatos da mesma empresa colidirem em "não pertence ao cliente".
    let equipmentBelongsToCustomer = equipment.contactId === contactId;
    if (!equipmentBelongsToCustomer) {
      const crmEquip = await prisma.crmEquipment.findFirst({
        where: {
          tenantId,
          externalId: equipment.externalId,
          externalSource: { in: [...ILUX_WEB_EQUIPMENT_SOURCES] },
        },
        select: { customerId: true, customer: { select: { externalId: true } } },
      });
      const contactCustomerId = contact.crmCustomerId || null;
      const contactCustomerExternalId = String(contact.crmCustomer?.externalId || contact.externalId || '').trim();
      equipmentBelongsToCustomer = Boolean(
        (crmEquip?.customerId && contactCustomerId && crmEquip.customerId === contactCustomerId)
        || (crmEquip?.customer?.externalId && contactCustomerExternalId
          && String(crmEquip.customer.externalId).trim() === contactCustomerExternalId),
      );
    }
    if (!equipmentBelongsToCustomer) {
      return res.status(400).json({ error: 'O equipamento não pertence ao cliente desta conversa.' });
    }
    if (!osType) return res.status(400).json({ error: 'O tipo de O.S. não existe no cadastro sincronizado do ILUX WEB.' });

    if (nmsuportet) {
      const technician = await prisma.crmTechnician.findFirst({
        where: { tenantId, name: nmsuportet, isActive: true },
      });
      if (!technician) return res.status(400).json({ error: 'O técnico selecionado não está ativo no ILUX WEB.' });
    }

    let os = await prisma.serviceOrder.findFirst({
      where: { tenantId, requestKey: normalizedRequestKey },
      orderBy: { createdAt: 'desc' },
      include: { contact: true, equipment: true },
    });

    if (os && (os.ticketId !== ticketId || os.contactId !== contactId || os.equipmentId !== equipmentId)) {
      console.warn('[createOS] requestKey rejeitada por pertencer a outro contexto', {
        serviceOrderId: os.id,
        ticketId,
      });
      return res.status(409).json({
        error: 'Esta solicitação de O.S. pertence a outra conversa. Feche o modal e abra uma nova solicitação.',
      });
    }

    if (!os) {
      os = await prisma.serviceOrder.findFirst({
        where: {
          tenantId,
          ticketId,
          externalSource: { in: ['firebird', 'ilux_web'] },
          externalId: null,
          status: { in: ['AGUARDANDO_ILUX', 'PROCESSANDO_ILUX', 'ERRO_INTEGRACAO'] },
        },
        orderBy: { createdAt: 'desc' },
        include: { contact: true, equipment: true },
      });
    }

    if (os?.externalId) {
      return res.json({ ...os, reused: true, confirmed: true });
    }

    if (os) {
      os = await prisma.serviceOrder.update({
        where: { id: os.id },
        data: {
          status: 'AGUARDANDO_ILUX',
          equipmentId,
          defect: String(defect).trim(),
          cdOstp: String(cdOstp),
          cdDefeito: defectType.code,
          nmsuportet: nmsuportet || null,
        },
        include: { contact: true, equipment: true },
      });
    } else {
      os = await prisma.serviceOrder.upsert({
        where: {
          tenantId_requestKey: {
            tenantId,
            requestKey: normalizedRequestKey,
          },
        },
        update: {},
        create: {
          tenantId,
          userId: req.user.userId,
          contactId,
          equipmentId,
          ticketId,
          defect: String(defect).trim(),
          status: 'AGUARDANDO_ILUX',
          cdOstp: String(cdOstp),
          cdDefeito: defectType.code,
          nmsuportet: nmsuportet || null,
          externalSource: 'ilux_web',
          externalId: null,
          requestKey: normalizedRequestKey,
        },
        include: { contact: true, equipment: true },
      });
    }

    // Na operação da LCD o ILUX_WEB é a fonte oficial das O.S. O CRM mantém
    // o espelho para ligar a ordem ao ticket/conversa, mas a confirmação
    // definitiva vem deste POST, sem depender do agente Firebird.
    if (isIluxWebConfigured()) {
      try {
        // O contato pode ter externalId igual ao JID do WhatsApp. Para o ILUX WEB,
        // a identidade oficial é sempre o identificador do cliente sincronizado.
        const clienteIdentificador = String(contact.crmCustomer?.externalId || contact.externalId || '').trim();
        const equipamentoIdentificador = String(equipment.externalId || '').trim();
        const respostaIlux = await createServiceOrderInIluxWeb({
          origem: 'CRM',
          ordemServicoId: os.id,
          clienteIdentificador,
          equipamentoIdentificador,
          // Compatibilidade com o contrato antigo, quando os IDs eram numéricos.
          clienteCodigoLegado: clienteIdentificador,
          equipamentoCodigoLegado: equipamentoIdentificador,
          cdOstp: String(cdOstp),
          cdDefeito: defectType.code,
          nmsuportet: nmsuportet || null,
          abertoPor: req.user.name || req.user.email || null,
          solicitante: contact.name || null,
          // Para o documento, prevalece o telefone oficial do cliente ILUX
          // sincronizado no CRM; o telefone do contato WhatsApp pode ser
          // apenas o número do atendente/solicitante.
          telefoneContato: contact.crmCustomer?.phone || contact.phone || contact.whatsapp || null,
          tipoAtendimento: String(cdOstp) === '01' ? 'CONTRATOS' : 'CORRETIVA',
          descricaoProblema: String(defect).trim(),
          dataAbertura: os.createdAt?.toISOString?.() || undefined,
        });
        const externalId = String(
          respostaIlux.seqos
          || respostaIlux.numero
          || respostaIlux.os?.numero
          || '',
        ).trim();
        if (!/^\d+$/.test(externalId)) {
          throw new Error('ILUX_WEB não devolveu o número definitivo da O.S.');
        }

        const confirmada = await prisma.serviceOrder.update({
          where: { id: os.id, tenantId },
          data: {
            externalSource: 'ilux_web',
            externalId,
            externalUpdatedAt: new Date(),
            status: 'PENDENTE',
          },
          include: { contact: true, equipment: true },
        });
        return res.status(201).json({ ...confirmada, confirmed: true, source: 'ilux_web' });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const erroIntegracao = await prisma.serviceOrder.update({
          where: { id: os.id, tenantId },
          data: { status: 'ERRO_INTEGRACAO' },
          include: { contact: true, equipment: true },
        });
        console.error(`[createOS] falha ao abrir O.S. ${os.id} no ILUX_WEB:`, detail);
        return res.status(502).json({
          error: `Não foi possível abrir a O.S. no ILUX_WEB: ${detail}`,
          serviceOrderId: erroIntegracao.id,
        });
      }
    }

    const confirmed = await waitForIluxConfirmation(os.id, tenantId);
    if (!confirmed) return res.status(404).json({ error: 'Solicitação de O.S. não encontrada.' });
    if (confirmed.externalId) {
      const matchesRequestedContext = confirmed.ticketId === ticketId
        && confirmed.contactId === contactId
        && confirmed.equipmentId === equipmentId
        && /^\d+$/.test(String(confirmed.externalId));
      if (!matchesRequestedContext) {
        console.error('[createOS] confirmação do ILUX WEB rejeitada por contexto divergente', {
          serviceOrderId: confirmed.id,
          requested: { ticketId, contactId, equipmentId },
          confirmed: {
            ticketId: confirmed.ticketId,
            contactId: confirmed.contactId,
            equipmentId: confirmed.equipmentId,
            externalId: confirmed.externalId,
          },
        });
        return res.status(409).json({
          error: 'O ILUX WEB confirmou uma O.S. com dados diferentes desta conversa. Nenhuma confirmação foi enviada ao cliente.',
          serviceOrderId: confirmed.id,
        });
      }
      return res.status(201).json({ ...confirmed, confirmed: true });
    }
    if (confirmed.status === 'ERRO_INTEGRACAO') {
      return res.status(502).json({
        error: 'O agente encontrou um erro e a abertura não foi confirmada no ILUX WEB.',
        serviceOrderId: confirmed.id,
      });
    }
    return res.status(504).json({
      error: 'O ILUX WEB não confirmou a abertura dentro do tempo esperado. Verifique a integração antes de tentar novamente.',
      serviceOrderId: confirmed.id,
      status: confirmed.status,
    });
  } catch (err) {
    console.error('[createOS] erro:', err.message);
    res.status(500).json({ error: 'Erro ao criar ordem de serviço.' });
  }
}

async function getOSStatus(req, res) {
  const order = await prisma.serviceOrder.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    select: { id: true, externalId: true, status: true, ticketId: true, contactId: true, equipmentId: true, updatedAt: true },
  });
  if (!order) return res.status(404).json({ error: 'O.S. não encontrada.' });
  return res.json({ ...order, confirmed: Boolean(order.externalId) });
}

async function getOSTypes(req, res) {
  try {
    const types = await prisma.crmOsType.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { code: 'asc' }
    });
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOSTechnicians(req, res) {
  try {
    const techs = await prisma.crmTechnician.findMany({
      where: { tenantId: req.user.tenantId, isActive: true },
      orderBy: { name: 'asc' }
    });
    res.json(techs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOSDefectTypes(req, res) {
  try {
    const types = await listDefectTypesFromIluxWeb();
    res.json(types);
  } catch (err) {
    res.status(502).json({ error: `Não foi possível carregar os tipos de defeito do ILUX WEB: ${err.message}` });
  }
}

async function updateOS(req, res) {
  const { id } = req.params;
  const { status, technicalNotes, meters } = req.body;
  const { tenantId, userId } = req.user;

  // Trava de segurança: Exigir relatório para finalizar ou arquivar
  if ((status === 'FINALIZADA' || status === 'ARQUIVADA') && (!technicalNotes || technicalNotes.trim().length < 5)) {
    return res.status(400).json({ error: 'Relatório Técnico é obrigatório para finalizar ou arquivar a O.S.' });
  }

  const data = {
    status,
    technicalNotes,
    meters: meters ? JSON.stringify(meters) : undefined
  };

  if (status === 'FINALIZADA' || status === 'ARQUIVADA') {
    data.closedAt = new Date();
    data.closedById = userId;
  }

  const os = await prisma.serviceOrder.update({
    where: { id, tenantId },
    data,
    include: { contact: true, equipment: true }
  });
  res.json(os);
}

async function generatePdf(req, res) {
  const { id } = req.params;
  const resolvedOrder = await resolveServiceOrderForPdf(req.user.tenantId, id);
  const os = resolvedOrder?.order || null;

  if (!os) return res.status(404).json({ error: 'O.S. não encontrada' });

  if (!os.externalId || os.status === 'ERRO_INTEGRACAO') {
    return res.status(409).json({
      error: 'Esta O.S. ainda nao foi confirmada pelo ILUX WEB e nao pode ser impressa.',
    });
  }

  // Busca o cliente real (empresa vinculada)
  let clientData = os.contact;
  let solicitante = os.contact.name;
  
  try {
    const filters = [];
    if (os.contact.phone) {
      filters.push({ whatsapp: os.contact.phone });
      filters.push({ phone: os.contact.phone });
    }
    if (os.contact.whatsapp) {
      filters.push({ phone: os.contact.whatsapp });
      filters.push({ whatsapp: os.contact.whatsapp });
    }

    if (filters.length > 0) {
      const linked = await prisma.contact.findFirst({
        where: {
          tenantId: req.user.tenantId,
          id: { not: os.contactId },
          AND: [
            { OR: filters },
            {
              OR: [
                { fantasyName: { not: '' } },
                { cpfCnpj: { not: '' } },
                { name: { contains: 'AFABAN' } }
              ]
            }
          ]
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (linked) {
        clientData = linked;
      }
    }
  } catch (err) {
    console.error('[generatePdf] erro ao buscar empresa vinculada:', err);
  }

  // Busca dados estruturados adicionais do cliente e equipamento no CRM
  let crmCustomer = os.contact.crmCustomer || null;
  let crmEquipment = null;
  try {
    if (!crmCustomer && clientData.externalId) {
      crmCustomer = await prisma.crmCustomer.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: { in: CRM_EXTERNAL_SOURCES },
          externalId: clientData.externalId
        }
      });
    }
    // Fallback 1: Buscar por CPF/CNPJ se o externalId não estiver associado no contato
    if (!crmCustomer && clientData.cpfCnpj) {
      crmCustomer = await prisma.crmCustomer.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: { in: CRM_EXTERNAL_SOURCES },
          cpfCnpj: clientData.cpfCnpj
        }
      });
    }
    // Fallback 2: Buscar por nome aproximado
    if (!crmCustomer && clientData.name) {
      crmCustomer = await prisma.crmCustomer.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: { in: CRM_EXTERNAL_SOURCES },
          name: { contains: clientData.name.trim(), mode: 'insensitive' }
        }
      });
    }

    if (os.equipment.externalId) {
      crmEquipment = await prisma.crmEquipment.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: { in: CRM_EXTERNAL_SOURCES },
          externalId: os.equipment.externalId
        }
      });
    }
  } catch (err) {
    console.error('[generatePdf] erro ao buscar dados estruturados adicionais:', err);
  }

  // O PDF deve refletir a mesma O.S. oficial que o ILUX WEB exibe. O contato
  // do CRM pode ter externalId de WhatsApp; para consultar o ILUX usamos
  // sempre o cliente sincronizado e guardamos a resposta para o histórico.
  let iluxWebOrders = [];
  let iluxWebOrder = null;
  let iluxWebCompany = null;
  try {
    if (isIluxWebConfigured()) {
      const iluxCustomerExternalId = String(
        crmCustomer?.externalId
        || os.contact.crmCustomer?.externalId
        || ''
      ).trim();
      if (iluxCustomerExternalId) {
        const result = await listServiceOrdersFromIluxWeb(iluxCustomerExternalId, { limit: 250 });
        iluxWebOrders = Array.isArray(result?.items) ? result.items : [];
        iluxWebOrder = iluxWebOrders.find((item) => String(item?.externalId || item?.numero || '') === String(os.externalId)) || null;
      }
      iluxWebCompany = await getCompanyProfileFromIluxWeb();
    }
  } catch (err) {
    console.error('[generatePdf] erro ao carregar dados oficiais do ILUX WEB:', err);
  }

  let osPrintData = null;
  let cachedCompanyProfile = null;
  let previousOrders = [];
  try {
    cachedCompanyProfile = await getLatestCompanyProfile(req.user.tenantId);
    if (resolvedOrder.historicalRecord) {
      const historicalPayload = resolvedOrder.historicalRecord.payload || {};
      const historicalRaw = historicalPayload.raw && typeof historicalPayload.raw === 'object'
        ? historicalPayload.raw
        : historicalPayload;
      osPrintData = {
        serviceOrder: historicalRaw,
        client: crmCustomer?.raw || {},
        equipment: crmEquipment?.raw || {},
        osType: { nmostp: historicalRaw.nmostp || historicalPayload.osType || '' },
        history: [],
        attendances: [],
      };
    } else if (os.externalId) {
      const printRecord = await prisma.externalSyncRecord.findUnique({
        where: {
          tenantId_source_entity_externalId: {
            tenantId: req.user.tenantId,
            source: 'firebird',
            entity: 'osPrintData',
            externalId: String(os.externalId),
          },
        },
      });
      osPrintData = printRecord?.payload || null;
    }

    const normalizeHistoryItem = (item) => {
      const raw = item?.raw && typeof item.raw === 'object' ? item.raw : item || {};
      const openedAt = item?.openedAt || item?.dataAbertura || item?.createdAt || item?.updatedAt || raw.dtinclusao || null;
      const openedAtTime = openedAt && !raw.hrinclusao
        ? new Date(openedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
        : '';
      const status = item?.statusLabel || item?.status || raw.nmstatus || raw.status || '';
      const isClosed = /CONCL|FECH|FINALIZ/i.test(String(status));
      return {
        externalId: String(item?.externalId || raw.seqos || ''),
        createdAt: openedAt,
        time: raw.hrinclusao || item?.time || openedAtTime,
        osType: raw.nmostp || item?.osType || item?.type || item?.tipoAtendimento || '',
        equipmentExternalId: String(item?.equipmentExternalId || item?.equipmentCode || raw.cdequipamento || ''),
        attendant: raw.nmsuportea || item?.attendant || '',
        status,
        defect: cleanLegacyDefect(item?.defect || item?.description || raw.obsdefeitocli || ''),
        closing: item?.closing || item?.observacao || raw.obsdefeitoats || '',
        closedBy: raw.usuario_fechamento || raw.nmsuportel || raw.nmsuportet || item?.closedBy || (isClosed ? item?.technician : '') || '',
        technician: item?.technician || item?.nmSuporteT || raw.nmsuportet || raw.nmsuportel || '',
      };
    };

    if (Array.isArray(osPrintData?.history)) {
      previousOrders = osPrintData.history.map(normalizeHistoryItem);
    }

    if (iluxWebOrders.length > 0) {
      previousOrders = [...previousOrders, ...iluxWebOrders.map(normalizeHistoryItem)];
    }

    const clientExternalId = String(
      osPrintData?.serviceOrder?.cdcliente
      || crmCustomer?.externalId
      || os.contact.crmCustomer?.externalId
      || os.contact.externalId
      || ''
    );
    if (previousOrders.length === 0 && clientExternalId) {
      const syncedHistory = await prisma.externalSyncRecord.findMany({
        where: {
          tenantId: req.user.tenantId,
          source: 'firebird',
          entity: 'serviceOrders',
          payload: { path: ['clientExternalId'], equals: clientExternalId },
        },
        select: { payload: true },
      });
      previousOrders = syncedHistory.map((item) => normalizeHistoryItem(item.payload));
    }

    const uniqueOrders = new Map();
    for (const item of previousOrders) {
      if (item.externalId && !uniqueOrders.has(item.externalId)) uniqueOrders.set(item.externalId, item);
    }
    previousOrders = [...uniqueOrders.values()]
      .filter((item) => item.externalId && item.externalId !== String(os.externalId || ''))
      .sort((left, right) => {
        const numericDifference = Number(right.externalId || 0) - Number(left.externalId || 0);
        if (Number.isFinite(numericDifference) && numericDifference !== 0) return numericDifference;
        return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
      })
      .slice(0, 5);
  } catch (err) {
    console.error('[generatePdf] erro ao carregar histórico do ILUX WEB:', err);
    previousOrders = [];
  }

  try {
    const fontsPath = path.join(__dirname, '..', '..', 'node_modules', 'pdfmake', 'fonts', 'Roboto');
    console.log('[generatePdf] Carregando fontes de:', fontsPath);

    const fonts = {
      Roboto: {
        normal: path.join(fontsPath, 'Roboto-Regular.ttf'),
        bold: path.join(fontsPath, 'Roboto-Medium.ttf'),
        italics: path.join(fontsPath, 'Roboto-Italic.ttf'),
        bolditalics: path.join(fontsPath, 'Roboto-MediumItalic.ttf')
      }
    };

    pdfmake.setFonts(fonts);
    
    const dataOS = os.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const horaOS = os.createdAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const emissionDate = new Date().toLocaleString('pt-BR');
    
    let meters = {};
    if (os.meters && os.meters.trim()) {
      try {
        meters = JSON.parse(os.meters);
      } catch (e) {
        console.error('[generatePdf] Erro ao parsear medidores:', os.meters);
      }
    }

    const settings = os.tenant.settings;
    const primaryColor = '#000000'; // Cor padrão preto
    // Cor de destaque configurável por empresa (cabeçalho da marca + bandas de
    // seção). O corpo do documento continua preto; só o acento vermelho vira
    // a cor da empresa. Valor inválido/ausente => vermelho padrão.
    const accentColor = /^#[0-9a-fA-F]{6}$/.test(String(settings?.osAccentColor || ''))
      ? String(settings.osAccentColor).toUpperCase()
      : '#D62828';
    // Texto legível sobre o acento (luminância relativa simplificada).
    const accentTextColor = (() => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(accentColor.slice(i, i + 2), 16) / 255);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return lum > 0.6 ? '#000000' : '#FFFFFF';
    })();
    const firebirdOrder = osPrintData?.serviceOrder || {};
    const firebirdClient = osPrintData?.client || {};
    const firebirdEquipment = osPrintData?.equipment || {};
    const firebirdContract = osPrintData?.contract || {};
    const firebirdOsType = osPrintData?.osType || {};
    // A foto da O.S. tem prioridade para preservar o documento histórico;
    // o perfil sincronizado completa campos que uma base antiga não retornou.
    const firebirdCompany = {
      ...(cachedCompanyProfile || {}),
      ...(osPrintData?.company || {}),
      ...(iluxWebCompany || {}),
    };
    const firstValue = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
    const joinAddress = (record = {}) => {
      const full = firstValue(record.addressFull);
      const base = full || firstValue(record.endereco, record.address, record.logradouro);
      return [
        base,
        full ? null : firstValue(record.num, record.numero),
        record.complemento,
      ].filter((value) => value !== undefined && value !== null && String(value).trim()).join(', ');
    };
    const joinPhone = (record = {}) => {
      const phone = firstValue(record.fone1, record.fone, record.telefone, record.celular, record.phone);
      const ddd = firstValue(record.ddd, record.dddfone, record.areaCode);
      if (!phone) return '';
      const phoneDigits = String(phone).replace(/\D/g, '');
      const dddDigits = String(ddd || '').replace(/\D/g, '');
      if (dddDigits && phoneDigits.startsWith(dddDigits) && phoneDigits.length >= 10) return phoneDigits;
      return ddd && !String(phone).startsWith('(') ? `(${ddd}) ${phone}` : String(phone);
    };

    // Dados da empresa emissora. Prioridade: snapshot do IEMPRESA anexado a
    // O.S. -> cadastro oficial sincronizado -> campos de fallback salvos na
    // tela. NUNCA cair num CNPJ/nome fixo no codigo: isso ja imprimiu a
    // identidade de outra empresa em O.S. de tenants sem cadastro sincronizado.
    // Sem dado, os campos ficam vazios; so nome/marca usam o nome do tenant.
    const tenantName = firstValue(settings?.companyName, os.tenant?.name);
    const officialCompany = iluxWebCompany || {};
    const company = {
      brand: firstValue(officialCompany.printBrand, officialCompany.nomeFantasia, officialCompany.razaoSocial, firebirdCompany.fantasia, firebirdCompany.nmfantasia, firebirdCompany.nomefantasia, firebirdCompany.nomeFantasia, firebirdCompany.tradeName, firebirdCompany.nmempresa, firebirdCompany.name, tenantName, 'Empresa'),
      name: firstValue(officialCompany.printName, officialCompany.razaoSocial, firebirdCompany.nmempresa, firebirdCompany.name, firebirdCompany.razaoSocial, tenantName, 'Empresa'),
      cnpj: firstValue(officialCompany.printCnpj, officialCompany.cnpj, firebirdCompany.cnpj, settings?.companyCnpj),
      ie: firstValue(officialCompany.printStateRegistration, officialCompany.inscricaoEstadual, firebirdCompany.inscest, firebirdCompany.stateRegistration, settings?.companyIE),
      address: firstValue(officialCompany.printAddress, joinAddress(officialCompany), joinAddress(firebirdCompany), firebirdCompany.addressFull, firebirdCompany.address, settings?.companyAddress),
      bairro: firstValue(officialCompany.printNeighborhood, officialCompany.bairro, firebirdCompany.bairro, firebirdCompany.neighborhood, settings?.companyBairro),
      cep: firstValue(officialCompany.printZipCode, officialCompany.cep, firebirdCompany.cep, firebirdCompany.zipCode, settings?.companyCep),
      city: firstValue(officialCompany.printCity, officialCompany.cidade, firebirdCompany.cidade, firebirdCompany.city, settings?.companyCity),
      state: firstValue(officialCompany.printState, officialCompany.uf, firebirdCompany.uf, firebirdCompany.state, settings?.companyState),
      phone: firstValue(officialCompany.printPhone, officialCompany.telefone, joinPhone(firebirdCompany), firebirdCompany.phone, settings?.companyPhone)
    };
    // firstValue devolve undefined quando nada preenche; normaliza para string
    // vazia para nao imprimir "undefined" no cabecalho.
    for (const key of Object.keys(company)) {
      if (company[key] === undefined || company[key] === null) company[key] = '';
    }
    // Sem UF nao imprime "()" solto no cabecalho.
    company.cityLine = [company.city, company.state && `(${company.state})`].filter(Boolean).join(' ');

    // Identificação do atendente com fallback para o usuário atual que está gerando o documento
    let attendantName = firstValue(iluxWebOrder?.attendant, firebirdOrder.nmsuportea, os.user ? (os.user.firebirdSupportName || os.user.name) : null, 'N/A');
    if ((attendantName === 'N/A' || (!os.user && !iluxWebOrder?.attendant)) && req.user?.userId) {
      const activeUser = await prisma.user.findUnique({
        where: { id: req.user.userId }
      });
      if (activeUser) {
        attendantName = activeUser.firebirdSupportName || activeUser.name;
      }
    }

    // Tradução limpa do tipo de O.S.
    let displayOsType = firstValue(firebirdOsType.nmostp, 'ATENDIMENTO AVULSO');
    if (!firebirdOsType.nmostp && os.cdOstp === '01') {
      displayOsType = 'ATENDIMENTO CONTRATOS';
    } else if (!firebirdOsType.nmostp && os.cdOstp) {
      // Se tiver outro código cadastrado, tenta cruzar com o nome do tipo
      const typeRecord = await prisma.crmOsType.findFirst({
        where: { tenantId: req.user.tenantId, code: os.cdOstp }
      });
      if (typeRecord) {
        displayOsType = typeRecord.name.toUpperCase();
      } else {
        displayOsType = `TIPO ${os.cdOstp}`;
      }
    }
    if (iluxWebOrder?.type || iluxWebOrder?.tipoAtendimento) {
      displayOsType = firstValue(iluxWebOrder.type, iluxWebOrder.tipoAtendimento, displayOsType);
    }

    const printAttendances = Array.isArray(osPrintData?.attendances) ? osPrintData.attendances : [];
    const lastPrintAttendance = printAttendances[printAttendances.length - 1] || {};
    const attendanceMeterCode = String(lastPrintAttendance.cdmedidor || (iluxWebOrder ? 'TOTAL' : '')).toUpperCase();
    if (lastPrintAttendance.medidor !== undefined && lastPrintAttendance.medidor !== null) {
      if (attendanceMeterCode.includes('COR')) meters.color = lastPrintAttendance.medidor;
      else if (attendanceMeterCode.includes('SCAN')) meters.scan = lastPrintAttendance.medidor;
      else meters.mono = lastPrintAttendance.medidor;
    }
    const compactText = (value, fallback = '', maxLength = 280) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      if (!text) return fallback;
      return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    };
    const formatHistoryDate = (value) => {
      if (!value) return '-';
      const text = String(value);
      const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
      const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (brMatch) return `${brMatch[1]}/${brMatch[2]}/${brMatch[3]}`;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toLocaleDateString('pt-BR');
    };
    const attendanceFollowUp = printAttendances
      .map((item) => {
        const note = item.observacao || item.acao || item.sintoma || '';
        if (!note) return '';
        const who = item.nmatendente || item.nmsuportet || '';
        return `${formatHistoryDate(item.dtatendimento || item.datahora)}${who ? ` — ${who}` : ''}: ${note}`;
      })
      .filter(Boolean);
    const followUpText = [os.technicalNotes, ...attendanceFollowUp].filter(Boolean).join('\n');
    const historyTableBody = previousOrders.length > 0
      ? previousOrders.map((item) => [
          {
            stack: [
              { text: formatHistoryDate(item.createdAt), bold: true, fontSize: 7 },
              { text: item.time || '', fontSize: 6.5, color: '#555' },
              { text: `O.S. ${item.externalId}`, bold: true, fontSize: 7, margin: [0, 2, 0, 0] },
            ],
            alignment: 'center',
          },
          {
            stack: [
              {
                text: [
                  { text: `Tipo: ${compactText(item.osType, 'N/A', 50)}   `, bold: true },
                  { text: `Equip.: ${compactText(item.equipmentExternalId, 'N/A', 30)}   ` },
                  { text: `Abertura: ${compactText(item.attendant, 'N/A', 30)}   ` },
                  { text: `Status: ${compactText(item.status, 'N/A', 40)}` },
                ],
                fontSize: 6.5,
                margin: [0, 0, 0, 2],
              },
              {
                columns: [
                  { text: [{ text: 'Chamado: ', bold: true }, compactText(item.defect, 'Sem descrição informada.')], width: '*' },
                  { text: [{ text: 'Fechamento: ', bold: true }, compactText(item.closing, 'Sem fechamento registrado.')], width: '*' },
                  {
                    text: [
                      { text: 'Fechada por: ', bold: true }, compactText(item.closedBy, 'Não informado', 40),
                      '\n',
                      { text: 'Técnico: ', bold: true }, compactText(item.technician, 'Não informado', 40),
                    ],
                    width: 105,
                  },
                ],
                columnGap: 7,
                fontSize: 6.5,
              },
            ],
          },
        ])
      : [[
          {
            text: 'Nenhum chamado anterior encontrado para este cliente no ILUX WEB.',
            colSpan: 2,
            alignment: 'center',
            color: '#666',
            fontSize: 7,
          },
          {},
        ]];

    const currentPrintOrder = firebirdOrder;
    const iluxOrderData = iluxWebOrder || {};
    const firstPrintAttendance = printAttendances[0] || {};
    const timeText = (value) => {
      if (!value) return '';
      const match = String(value).match(/(\d{2}:\d{2})/);
      return match ? match[1] : String(value);
    };
    const localTimeFromDate = (value) => {
      if (!value) return '';
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime())
        ? ''
        : parsed.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    };
    const iluxOpenedDate = iluxOrderData.openedAt ? formatHistoryDate(iluxOrderData.openedAt) : '';
    const iluxOpenedTime = localTimeFromDate(iluxOrderData.openedAt);
    const visitDate = (() => {
      const legacyDate = lastPrintAttendance.dtatendimento || lastPrintAttendance.datahora || currentPrintOrder.dtatendimento || '';
      return legacyDate ? formatHistoryDate(legacyDate) : (iluxOpenedDate || '');
    })();
    const visitStart = firstValue(timeText(firstPrintAttendance.hratendimento || firstPrintAttendance.datahora), iluxOpenedTime, '');
    const visitEnd = firstValue(timeText(lastPrintAttendance.hratendimentofin || lastPrintAttendance.hratendimento1), iluxOpenedTime, '');
    const clientExternalId = firstValue(
      iluxOrderData.clientCodigoLegado,
      currentPrintOrder.cdcliente,
      firebirdClient.cdcliente,
      crmCustomer?.externalId,
      os.contact.crmCustomer?.externalId,
      os.contact.externalId,
      'N/A',
    );
    const clientName = firstValue(iluxOrderData.clientName, currentPrintOrder.nmcliente, firebirdClient.nmcliente, crmCustomer?.name, clientData.name, 'N/A');
    const clientAddress = firstValue(iluxOrderData.clientAddress, joinAddress(currentPrintOrder), joinAddress(firebirdClient), crmCustomer?.address, clientData.address, 'N/A');
    const clientNeighborhood = firstValue(iluxOrderData.clientNeighborhood, currentPrintOrder.bairro, firebirdClient.bairro, crmCustomer?.neighborhood, 'N/A');
    const clientZipCode = firstValue(iluxOrderData.clientZipCode, currentPrintOrder.cep, firebirdClient.cep, crmCustomer?.zipCode, clientData.zipCode, 'N/A');
    const clientCity = firstValue(iluxOrderData.clientCity, currentPrintOrder.cidade, firebirdClient.cidade, crmCustomer?.city, clientData.city, 'N/A');
    const clientState = firstValue(iluxOrderData.clientState, currentPrintOrder.uf, firebirdClient.uf, crmCustomer?.state, clientData.state, 'N/A');
    const clientDocument = firstValue(iluxOrderData.clientDocument, firebirdClient.cnpj, firebirdClient.cpf, crmCustomer?.cpfCnpj, clientData.cpfCnpj, 'N/A');
    const clientStateRegistration = firstValue(iluxOrderData.clientStateRegistration, firebirdClient.inscest, firebirdClient.inscmun, 'N/A');
    const clientContact = firstValue(iluxOrderData.clientContact, currentPrintOrder.contato, firebirdClient.contato, crmCustomer?.contactName, solicitante, 'N/A');
    const primaryClientPhone = firstValue(iluxOrderData.clientPhone, joinPhone(currentPrintOrder), joinPhone(firebirdClient), crmCustomer?.phone, os.contact.phone, 'N/A');
    const clientCellPhone = currentPrintOrder.celular && !String(primaryClientPhone).includes(String(currentPrintOrder.celular))
      ? String(currentPrintOrder.celular)
      : '';
    const clientPhone = [primaryClientPhone, clientCellPhone].filter(Boolean).join(' ');
    const equipmentExternalId = firstValue(iluxOrderData.equipmentExternalId, currentPrintOrder.cdequipamento, firebirdEquipment.cdequipamento, os.equipment.externalId, 'N/A');
    const equipmentModel = firstValue(iluxOrderData.equipmentModel, firebirdEquipment.modelo, os.equipment.model, 'N/A');
    const equipmentSerial = firstValue(iluxOrderData.serialNumber, firebirdEquipment.serie, os.equipment.serialNumber, 'N/A');
    const equipmentAsset = firstValue(iluxOrderData.equipmentAsset, firebirdEquipment.patrimonio, iluxWebOrder ? '-' : 'N/A');
    const contractType = firstValue(iluxOrderData.contractType, firebirdContract.cdcontratotp, firebirdEquipment.cdcontratotp, 'N/A');
    const territory = firstValue(iluxOrderData.territory, firebirdEquipment.cdterritorio, currentPrintOrder.cdterritorio, 'N/A');
    const department = currentPrintOrder.departamento
      || firebirdEquipment.departamento
      || iluxOrderData.equipmentDepartment
      || crmEquipment?.raw?.departamento
      || crmEquipment?.raw?.DEPARTAMENTO
      || os.equipment.sector
      || 'N/A';
    const installLocation = currentPrintOrder.localinstal
      || firebirdEquipment.localinstal
      || iluxOrderData.equipmentLocation
      || crmEquipment?.installLocation
      || crmEquipment?.raw?.localinstal
      || crmEquipment?.raw?.LOCALINSTAL
      || (iluxWebOrder ? '-' : (os.equipment.sector || 'N/A'));
    const currentOsDate = firstValue(iluxOpenedDate, currentPrintOrder.dtinclusao ? formatHistoryDate(currentPrintOrder.dtinclusao) : '', dataOS);
    const currentOsTime = firstValue(iluxOpenedTime, timeText(currentPrintOrder.hrinclusao), horaOS);
    const currentTechnician = firstValue(iluxOrderData.technician, currentPrintOrder.nmsuportet, currentPrintOrder.nmsuportel, os.nmsuportet, '');
    const defectTypeName = firstValue(
      iluxOrderData.defectTypeName,
      iluxOrderData.defeitoTipoNome,
      iluxOrderData.defectType?.name,
      '',
    );
    const currentDefect = cleanLegacyDefect(firstValue(
      iluxOrderData.defect,
      iluxOrderData.description,
      currentPrintOrder.obsdefeitocli,
      os.defect,
      '',
    ));
    const currentFollowUp = [currentPrintOrder.obsdefeitoats, followUpText].filter(Boolean).join('\n');
    const checkbox = (checked, label) => `${checked ? '[X]' : '[ ]'} ${label}`;
    const isAttendance = iluxWebOrder
      ? ['A', 'ATENDIMENTO'].includes(String(iluxOrderData.attendanceType || '').toUpperCase())
      : ['A', 'ATENDIMENTO'].includes(String(currentPrintOrder.tporcatend || 'A').toUpperCase());
    const isWarranty = ['G', 'GARANTIA'].includes(String(currentPrintOrder.tpchamado || '').toUpperCase());
    const isBudget = ['2', 'O', 'ORCAMENTO'].includes(String(currentPrintOrder.tipo_os || '').toUpperCase());

    const symptom = iluxWebOrder
      ? firstValue(iluxOrderData.symptom, iluxOrderData.sintoma, '')
      : ([...printAttendances].reverse().find((item) => item.sintoma)?.sintoma || '');
    const meterAttendance = firstPrintAttendance;
    let logoDataUri = '';
    try {
      if (os.tenant.logoUrl) {
        const { uploadsPath } = require('../utils/uploads');
        const logoFilename = os.tenant.logoUrl.split('/').pop();
        const logoPath = path.resolve(uploadsPath, logoFilename);
        const extension = path.extname(logoFilename).toLowerCase();
        if (['.png', '.jpg', '.jpeg'].includes(extension) && fs.existsSync(logoPath)) {
          const mimeType = extension === '.png' ? 'image/png' : 'image/jpeg';
          logoDataUri = `data:${mimeType};base64,${fs.readFileSync(logoPath).toString('base64')}`;
        }
      }
    } catch (logoError) {
      console.warn('[generatePdf] não foi possível carregar a logomarca oficial:', logoError.message);
    }

    const officialHtml = renderOfficialOsTemplate({
      accentColor,
      accentTextColor,
      barcodeEnabled: settings?.osBarcodeEnabled !== false,
      number: os.externalId || os.id.slice(-6).toUpperCase(),
      date: currentOsDate,
      time: currentOsTime,
      openedBy: String(attendantName).toUpperCase(),
      technician: String(currentTechnician).toUpperCase(),
      expectedDate: currentPrintOrder.dtpreventrega ? formatHistoryDate(currentPrintOrder.dtpreventrega) : (iluxWebOrder ? currentOsDate : ''),
      expectedTime: timeText(currentPrintOrder.hrpreventrega),
      priority: currentPrintOrder.prioridade || (iluxWebOrder ? '1' : ''),
      type: String(displayOsType).toUpperCase(),
      isAttendance,
      isWarranty,
      isBudget,
      logoDataUri,
      company: {
        brand: company.brand,
        name: company.name,
        cnpj: company.cnpj,
        stateRegistration: company.ie,
        address: company.address,
        neighborhood: company.bairro,
        zipCode: company.cep,
        city: company.city,
        state: company.state,
        phone: company.phone,
      },
      client: {
        code: clientExternalId,
        name: clientName,
        address: clientAddress,
        neighborhood: clientNeighborhood,
        zipCode: clientZipCode,
        city: clientCity,
        state: clientState,
        document: clientDocument,
        stateRegistration: clientStateRegistration,
        contact: clientContact,
        phone: clientPhone,
      },
      equipment: {
        code: equipmentExternalId,
        model: equipmentModel,
        serial: equipmentSerial,
        asset: equipmentAsset,
        contractType,
        territory,
        department,
        location: installLocation,
      },
      visit: {
        date: visitDate === '-' ? '' : visitDate,
        start: visitStart,
        end: visitEnd,
        meterCode: meterAttendance.cdmedidor || (iluxWebOrder ? 'TOTAL' : ''),
        meterValue: meterAttendance.medidor ?? 0,
      },
      defect: currentDefect,
      defectTypeName,
      symptom,
      cause: lastPrintAttendance.causa || '',
      action: lastPrintAttendance.acao || '',
      followUp: currentFollowUp,
      history: previousOrders.map((item) => ({
        number: item.externalId,
        date: formatHistoryDate(item.createdAt),
        time: item.time || '',
        type: item.osType,
        equipment: item.equipmentExternalId,
        openedBy: item.attendant,
        status: item.status,
        defect: item.defect,
        closing: item.closing,
        closedBy: item.closedBy,
        technician: item.technician,
      })),
    });

    if (typeof res.capturePdf !== 'function') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="OS_${os.externalId || os.id.substring(os.id.length - 6)}.html"`);
      return res.send(officialHtml);
    }

    const logoInitials = String(company.brand || company.name || 'OS')
      .trim().split(/\s+/).map((word) => word[0]).filter(Boolean).slice(0, 3).join('').toUpperCase() || 'OS';
    let companyLogoContent = { text: logoInitials, bold: true, fontSize: 23, color: accentColor, alignment: 'center', width: 58 };
    try {
      if (os.tenant.logoUrl) {
        const { uploadsPath } = require('../utils/uploads');
        const logoFilename = os.tenant.logoUrl.split('/').pop();
        const logoPath = path.resolve(uploadsPath, logoFilename);
        if (['.png', '.jpg', '.jpeg'].includes(path.extname(logoFilename).toLowerCase()) && fs.existsSync(logoPath)) {
          companyLogoContent = { image: logoPath, width: 55, alignment: 'center' };
        }
      }
    } catch (logoError) {
      console.warn('[generatePdf] não foi possível carregar a logomarca:', logoError.message);
    }

    const fullIluxContent = [
      {
        table: {
          widths: [265, 92, '*'],
          body: [[
            {
              columns: [
                companyLogoContent,
                {
                  width: '*',
                  stack: [
                    { text: 'LCD DIGITAL OUTSOURCING DE IMPRESSÃO', bold: true, fontSize: 9, alignment: 'center' },
                    { text: company.name, bold: true, fontSize: 8, alignment: 'center', margin: [0, 1, 0, 2] },
                    { text: `CNPJ: ${company.cnpj}   Insc.Estadual: ${company.ie}`, fontSize: 6.5, alignment: 'center' },
                    { text: `Endereço: ${company.address}`, fontSize: 6.5, alignment: 'center' },
                    { text: `Cidade: ${company.cityLine}   Bairro: ${company.bairro}`, fontSize: 6.5, alignment: 'center' },
                    { text: `Fone: ${company.phone}   CEP: ${company.cep}`, fontSize: 6.5, alignment: 'center' },
                  ],
                },
              ],
              margin: [2, 4, 2, 4],
            },
            { text: 'ORDEM DE SERVIÇO', fontSize: 8, alignment: 'center', margin: [0, 27, 0, 0] },
            {
              stack: [
                { text: `Número: ${os.externalId || os.id.slice(-6).toUpperCase()}   Data: ${currentOsDate}`, bold: true, fontSize: 6.5 },
                { text: `Hora: ${currentOsTime}`, bold: true, fontSize: 6.5 },
                { text: `Técnico abertura: ${attendantName.toUpperCase()}`, bold: true, fontSize: 6.5 },
                { text: `Técnico atendimento: ${String(currentTechnician).toUpperCase()}`, bold: true, fontSize: 6.5 },
                { text: `Atendimento Prev: ${currentPrintOrder.dtpreventrega ? formatHistoryDate(currentPrintOrder.dtpreventrega) : (iluxWebOrder ? currentOsDate : '-')} ${timeText(currentPrintOrder.hrpreventrega)}   Priorid. ${currentPrintOrder.prioridade || (iluxWebOrder ? '1' : '')}`, bold: true, fontSize: 6.3 },
                { text: `Tipo O.S.: ${displayOsType}`, bold: true, fontSize: 6.3 },
                { text: `${checkbox(isAttendance, 'Atendimento')}   ${checkbox(isWarranty, 'Garantia')}\n${checkbox(isBudget, 'Orçamento')}`, fontSize: 6.3 },
              ],
              margin: [3, 3, 2, 2],
            },
          ]],
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => '#222',
          vLineColor: () => '#222',
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 1,
          paddingBottom: () => 1,
        },
      },
      {
        table: { widths: ['*'], body: [[{ text: 'Cliente                                      Equipamento', bold: true, fontSize: 7, fillColor: '#D9D9D9' }]] },
        margin: [0, 4, 0, 0],
        layout: 'noBorders',
      },
      {
        table: {
          widths: ['54%', '46%'],
          body: [[
            {
              stack: [
                { text: [{ text: 'Código ILUX WEB: ', bold: true }, String(clientExternalId), { text: '   Cliente: ', bold: true }, String(clientName)] },
                { text: [{ text: 'Endereço: ', bold: true }, String(clientAddress)] },
                { text: [{ text: 'Bairro: ', bold: true }, String(clientNeighborhood), { text: '   CEP: ', bold: true }, String(clientZipCode)] },
                { text: [{ text: 'Cidade: ', bold: true }, String(clientCity), { text: '   U.F.: ', bold: true }, String(clientState)] },
                { text: [{ text: 'CNPJ/CPF: ', bold: true }, String(clientDocument), { text: '   Insc.Estadual: ', bold: true }, String(clientStateRegistration)] },
                { text: [{ text: 'Contato: ', bold: true }, String(clientContact), { text: '   Fone: ', bold: true }, String(clientPhone)] },
              ],
              fontSize: 6.5,
            },
            {
              stack: [
                { text: [{ text: 'Equipamento: ', bold: true }, String(equipmentExternalId)] },
                { text: [{ text: 'Modelo: ', bold: true }, String(equipmentModel)] },
                { text: [{ text: 'Série: ', bold: true }, String(equipmentSerial), { text: '   Patrimônio: ', bold: true }, String(equipmentAsset)] },
                { text: [{ text: 'Tipo de Contrato: ', bold: true }, String(contractType), { text: '   Território: ', bold: true }, String(territory)] },
                { text: [{ text: 'Departamento: ', bold: true }, String(department)] },
                { text: [{ text: 'Localização: ', bold: true }, { text: String(installLocation), bold: true, fontSize: 9 }] },
              ],
              fontSize: 6.5,
            },
          ]],
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => '#222',
          vLineColor: () => '#222',
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
      {
        table: { widths: ['*'], body: [[{ text: 'Descrição/Visita', bold: true, color: accentTextColor, fillColor: accentColor, fontSize: 7 }]] },
        layout: 'noBorders',
      },
      {
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: `Data Visita: ${visitDate === '-' ? '' : visitDate}    Hora Inicial: ${visitStart}    Hora Final: ${visitEnd}`, bold: true, fontSize: 6.5 },
              { text: `Medidor 01: ${attendanceMeterCode}    Contador Medidor 01: ${lastPrintAttendance.medidor ?? (iluxWebOrder ? 0 : '')}`, bold: true, fontSize: 6.5 },
              { text: [{ text: 'Tipo de defeito: ', bold: true, fontSize: 7 }, { text: defectTypeName, fontSize: 7 }], margin: [0, 4, 0, 2] },
              { text: [{ text: 'Defeito:   ', bold: true, fontSize: 7 }, { text: currentDefect, fontSize: 11 }], margin: [0, 5, 0, 4] },
              { text: [{ text: 'Sintoma:   ', bold: true }, lastPrintAttendance.sintoma || ''], fontSize: 7, margin: [0, 2, 0, 2] },
              { text: [{ text: 'Causa:     ', bold: true }, lastPrintAttendance.causa || ''], fontSize: 7, margin: [0, 2, 0, 2] },
              { text: [{ text: 'Ação:      ', bold: true }, lastPrintAttendance.acao || ''], fontSize: 7, margin: [0, 2, 0, 4] },
            ],
            minHeight: 105,
          }]],
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 2,
          hLineColor: () => '#222',
          vLineColor: () => accentColor,
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
      {
        table: { widths: ['*'], body: [[{ text: 'Follow-up/Ação', bold: true, color: accentTextColor, fillColor: accentColor, fontSize: 7 }]] },
        layout: 'noBorders',
      },
      {
        table: { widths: ['*'], body: [[{ text: currentFollowUp || '\n\n', fontSize: 7, minHeight: 36 }]] },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 2,
          hLineColor: () => '#222',
          vLineColor: () => accentColor,
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
      {
        table: { widths: ['*'], body: [[{ text: 'HISTÓRICO DOS ÚLTIMOS CHAMADOS', bold: true, fontSize: 7, fillColor: '#D9D9D9' }]] },
        margin: [0, 4, 0, 0],
        layout: 'noBorders',
      },
      {
        table: { widths: [62, '*'], dontBreakRows: true, body: historyTableBody },
        layout: {
          hLineWidth: () => 0.8,
          vLineWidth: () => 0.8,
          hLineColor: () => '#555',
          vLineColor: () => '#555',
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
      {
        table: { widths: [527], body: [[{ text: 'Aceite da O.S.', bold: true, fontSize: 7, fillColor: '#D9D9D9' }]] },
        absolutePosition: { x: 30, y: 755 },
        layout: 'noBorders',
      },
      {
        absolutePosition: { x: 30, y: 769 },
        table: {
          widths: [354, 166],
          body: [[
            {
              stack: [
                { text: 'Favor efetuar o aceite da implantação/retirada dos serviços (se mais relacionado(s))', bold: true, fontSize: 7 },
                { text: 'Local: ________________________________     Data: ____ / ____ / ______', bold: true, fontSize: 7, margin: [0, 12, 0, 0] },
              ],
              minHeight: 42,
            },
            {
              stack: [
                { text: '\n\n________________________________', alignment: 'center', fontSize: 7 },
                { text: 'Assinatura/Carimbo Cliente', alignment: 'center', fontSize: 6.5 },
              ],
            },
          ]],
        },
        layout: {
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => '#222',
          vLineColor: () => '#222',
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
    ];

    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [30, 20, 30, 25],
      footer: (currentPage, pageCount) => {
        return {
          stack: [
            { canvas: [{ type: 'line', x1: 30, y1: 0, x2: 565, y2: 0, lineWidth: 0.5, lineColor: '#EEEEEE' }] },
            {
              columns: [
                { text: `Documento gerado em ${emissionDate}`, fontSize: 6.5, color: '#999', margin: [30, 6, 0, 0] },
                { text: `Página ${currentPage} de ${pageCount}`, fontSize: 6.5, color: '#999', alignment: 'right', margin: [0, 6, 30, 0] }
              ]
            }
          ]
        };
      },
      content: [
        // Top Banner / Header
        {
          table: {
            widths: [100, '*', 180],
            body: [
              [
                {
                  stack: (() => {
                    try {
                      if (os.tenant.logoUrl) {
                        const { uploadsPath } = require('../utils/uploads');
                        const logoFilename = os.tenant.logoUrl.split('/').pop();
                        const logoPath = path.resolve(uploadsPath, logoFilename);
                        const ext = path.extname(logoFilename).toLowerCase();
                        const allowed = ['.png', '.jpg', '.jpeg'];
                        if (allowed.includes(ext) && fs.existsSync(logoPath)) {
                          return [{ image: logoPath, width: 85, alignment: 'center', margin: [0, 10, 0, 10] }];
                        }
                      }
                    } catch (err) {}
                    return [{ text: 'LOGO', style: 'logoPlaceholder' }];
                  })(),
                  border: [true, true, true, true],
                  borderColor: ['#333333', '#333333', '#333333', '#333333']
                },
                {
                  stack: [
                    { text: company.name, bold: true, fontSize: 10, margin: [0, 2, 0, 2], color: primaryColor, alignment: 'center' },
                    { text: `CNPJ: ${company.cnpj}   |   Insc.Estadual: ${company.ie}`, fontSize: 7.5, margin: [0, 0, 0, 1], color: '#333', alignment: 'center' },
                    { text: `Endereço: ${company.address}`, fontSize: 7.5, margin: [0, 0, 0, 1], color: '#333', alignment: 'center' },
                    { text: `Cidade: ${company.cityLine}   |   Bairro: ${company.bairro}`, fontSize: 7.5, margin: [0, 0, 0, 1], color: '#333', alignment: 'center' },
                    { text: `Fone: ${company.phone}   |   CEP: ${company.cep}`, fontSize: 7.5, color: '#333', alignment: 'center' }
                  ],
                  border: [false, true, true, true],
                  borderColor: [null, '#333333', '#333333', '#333333']
                },
                {
                  stack: [
                    { text: 'ORDEM DE SERVIÇO', bold: true, fontSize: 11, alignment: 'center', color: '#FFFFFF', margin: [0, 4, 0, 4] },
                    {
                      table: {
                        widths: ['*', '*'],
                        body: [
                          [{ text: 'Número:', style: 'miniLabel' }, { text: `Data: ${dataOS}`, style: 'miniLabel' }],
                          [{ text: os.externalId || os.id.substring(os.id.length - 6).toUpperCase(), style: 'miniValue' }, { text: `Hora: ${horaOS}`, style: 'miniLabel' }],
                          [{ text: `Atendente: ${attendantName.toUpperCase()}`, style: 'miniLabel', colSpan: 2 }, {}],
                          [{ text: `Técnico: ${(os.nmsuportet || 'N/A').toUpperCase()}`, style: 'miniLabel', colSpan: 2 }, {}],
                          [{ text: `Tipo O.S.: ${displayOsType}`, style: 'miniLabel', colSpan: 2 }, {}]
                        ]
                      },
                      layout: 'noBorders',
                      margin: [5, 2, 5, 2]
                    }
                  ],
                  fillColor: primaryColor,
                  border: [false, true, true, true],
                  borderColor: [null, '#333333', '#333333', '#333333']
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#333333',
            vLineColor: () => '#333333'
          }
        },

        // Client Data Section
        { 
          table: {
            widths: ['*'],
            body: [[{ text: 'Cliente / Equipamento', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*', '*'],
            body: [
              [
                { text: [{ text: 'Cliente: ', style: 'label' }, { text: clientData.externalId ? `${clientData.externalId} - ${clientData.name}` : (clientData.name || 'N/A'), style: 'value' }], colSpan: 2, border: [true, false, true, true] },
                {}
              ],
              [
                { text: [{ text: 'Endereço: ', style: 'label' }, { text: crmCustomer?.address || clientData.address || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Equipamento: ', style: 'label' }, { text: os.equipment.externalId ? `${os.equipment.externalId} - ${os.equipment.model || 'N/A'}` : 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Bairro: ', style: 'label' }, { text: crmCustomer?.neighborhood || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Modelo: ', style: 'label' }, { text: os.equipment.model || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Cidade: ', style: 'label' }, { text: crmCustomer?.city ? `${crmCustomer.city} (${crmCustomer.state || 'RS'})` : (clientData.city ? `${clientData.city} (${clientData.state || 'RS'})` : 'N/A'), style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Série: ', style: 'label' }, { text: os.equipment.serialNumber || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'CNPJ/CPF: ', style: 'label' }, { text: crmCustomer?.cpfCnpj || clientData.cpfCnpj || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Tipo de Contrato: ', style: 'label' }, { text: crmEquipment?.contractExternalId || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Contato: ', style: 'label' }, { text: crmCustomer?.contactName || solicitante || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Departamento: ', style: 'label' }, { text: crmEquipment?.raw?.['departamento'] || crmEquipment?.raw?.['DEPARTAMENTO'] || os.equipment.sector || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Fone: ', style: 'label' }, { text: crmCustomer?.phone || os.contact.phone || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Local Instalação: ', style: 'label' }, { text: crmEquipment?.installLocation || crmEquipment?.raw?.['localinstal'] || crmEquipment?.raw?.['LOCALINSTAL'] || os.equipment.sector || 'N/A', style: 'value' }] }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#CCCCCC',
            vLineColor: () => '#333333',
            paddingTop: () => 3,
            paddingBottom: () => 3
          }
        },

        // Defect Section
        { 
          table: {
            widths: ['*'],
            body: [[{ text: 'Descrição da Visita / Defeito', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: [
                    { text: `Tipo de defeito: ${defectTypeName || ''}`, style: 'boxContent' },
                    { text: `\nDefeito: ${currentDefect || 'Nenhum defeito reportado'}`, style: 'boxContent' },
                    { text: `\nSintoma: ${symptom || ''}`, style: 'boxContent' },
                    { text: `\nCausa: ${lastPrintAttendance.causa || ''}`, style: 'boxContent' },
                    { text: `\nAção: ${lastPrintAttendance.acao || ''}`, style: 'boxContent' }
                  ],
                  minHeight: previousOrders.length ? 72 : 100,
                  border: [true, false, true, true]
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#333333',
            vLineColor: () => '#333333',
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },

        // Meters Section
        {
          table: {
            widths: ['*'],
            body: [[{ text: 'Leitura de Contadores', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*', '*', '*'],
            body: [
              [
                { 
                  stack: [
                    { text: 'CONTADOR P&B (Mono)', style: 'label', alignment: 'center' },
                    { text: meters.mono || '____________', style: 'meterValue', alignment: 'center' }
                  ],
                  fillColor: '#FAFAFA',
                  border: [true, false, true, true]
                },
                { 
                  stack: [
                    { text: 'CONTADOR COR (Color)', style: 'label', alignment: 'center' },
                    { text: meters.color || '____________', style: 'meterValue', alignment: 'center' }
                  ],
                  fillColor: '#FAFAFA',
                  border: [true, false, true, true]
                },
                { 
                  stack: [
                    { text: 'CONTADOR SCAN', style: 'label', alignment: 'center' },
                    { text: meters.scan || '____________', style: 'meterValue', alignment: 'center' }
                  ],
                  fillColor: '#FAFAFA',
                  border: [true, false, true, true]
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#CCCCCC',
            vLineColor: () => '#333333',
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },

        // Follow-up / Technical Notes Section
        { 
          table: {
            widths: ['*'],
            body: [[{ text: 'Follow-up do Técnico / Peças Substituídas', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  text: followUpText || '\n\n\n',
                  style: 'boxContent',
                  minHeight: previousOrders.length ? 45 : 120,
                  border: [true, false, true, true]
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#333333',
            vLineColor: () => '#333333',
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },

        // Previous iLux service calls
        {
          table: {
            widths: ['*'],
            body: [[{ text: 'HISTÓRICO DOS ÚLTIMOS CHAMADOS', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            headerRows: 0,
            dontBreakRows: true,
            widths: [62, '*'],
            body: historyTableBody,
          },
          layout: {
            hLineWidth: () => 0.7,
            vLineWidth: () => 0.7,
            hLineColor: () => '#777777',
            vLineColor: () => '#777777',
            paddingTop: () => 3,
            paddingBottom: () => 3,
            paddingLeft: () => 4,
            paddingRight: () => 4,
          },
        },

        // Signatures Section
        {
          margin: [0, 16, 0, 0],
          columns: [
            {
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#333333' }] },
                { text: 'ASSINATURA E CARIMBO DO CLIENTE', style: 'signatureLabel', margin: [0, 4, 0, 0] },
                { text: 'Data: ____/____/____', fontSize: 6.5, color: '#999' }
              ],
              alignment: 'center'
            },
            {
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#333333' }] },
                { text: 'ASSINATURA DO TÉCNICO', style: 'signatureLabel', margin: [0, 4, 0, 0] },
                { text: attendantName.toUpperCase(), fontSize: 6.5, color: '#999' }
              ],
              alignment: 'center'
            }
          ]
        },
        {
          text: 'Declaro que os serviços acima foram executados a contento e os materiais/peças foram fornecidos conforme descrito.',
          style: 'footerNote',
          margin: [0, 15, 0, 0],
          alignment: 'center'
        }
      ],
      styles: {
        sectionTitle: { fontSize: 8.5, bold: true, color: '#000000', margin: [5, 2, 5, 2] },
        label: { fontSize: 7, color: '#333333', bold: true },
        value: { fontSize: 8.5, color: '#000000', bold: false },
        miniLabel: { fontSize: 7, color: '#FFFFFF', bold: true },
        miniValue: { fontSize: 7.5, color: '#FFFFFF', bold: true },
        boxContent: { fontSize: 8.5, lineHeight: 1.2, color: '#333333' },
        meterValue: { fontSize: 11, bold: true, color: '#000000', margin: [0, 2, 0, 0] },
        signatureLabel: { fontSize: 7, color: '#333333', bold: true },
        footerNote: { fontSize: 6.5, italic: true, color: '#888888' },
        logoPlaceholder: { fontSize: 10, bold: true, color: '#CCCCCC', background: '#F9F9F9', alignment: 'center', margin: [0, 10] }
      },
      defaultStyle: { font: 'Roboto' }
    };

    const replaceCompanyBrand = (node) => {
      if (Array.isArray(node)) {
        node.forEach(replaceCompanyBrand);
        return;
      }
      if (!node || typeof node !== 'object') return;
      if (typeof node.text === 'string' && node.text.startsWith('LCD DIGITAL OUTSOURCING')) {
        node.text = company.brand || company.name;
      }
      Object.values(node).forEach(replaceCompanyBrand);
    };
    replaceCompanyBrand(fullIluxContent);

    const doc = pdfmake.createPdf({ ...docDefinition, footer: () => ({ text: '' }), content: fullIluxContent });
    const stream = await doc.getStream();
    const filename = osPdfFilename(
      os.externalId || os.id.substring(os.id.length - 6),
      clientData?.name || os.contact?.name,
    );

    if (typeof res.capturePdf === 'function') {
      return res.capturePdf(stream, filename);
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    
    stream.pipe(res);
    stream.end();
  } catch (err) {
    console.error('[generatePdf] erro fatal na geração do PDF:', err);
    if (!res.headersSent) {
      res.status(500).send('Erro ao gerar PDF: ' + err.message);
    }
  }
}

async function generatePdfBuffer(tenantId, id) {
  return new Promise((resolve, reject) => {
    const response = {
      headersSent: false,
      statusCode: 200,
      setHeader() {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        reject(new Error(payload?.error || `Erro ${this.statusCode} ao gerar PDF da O.S.`));
        return this;
      },
      send(payload) {
        reject(new Error(String(payload || `Erro ${this.statusCode} ao gerar PDF da O.S.`)));
        return this;
      },
      capturePdf(stream, filename) {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.once('error', reject);
        stream.once('end', () => resolve({ buffer: Buffer.concat(chunks), filename }));
        stream.end();
      },
    };

    Promise.resolve(generatePdf({ params: { id }, user: { tenantId } }, response)).catch(reject);
  });
}

async function draftOS(req, res) {
  const { contactId, ticketId } = req.body;
  const { tenantId } = req.user;

  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings || !aiService.hasConfiguredProvider(settings)) return res.status(400).json({ error: 'Provedor de IA não configurado' });

    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

    // O modal jÃ¡ carrega /api/os/equipments antes de pedir o rascunho, e essa
    // rota sincroniza o CRM uma vez. Evitamos repetir dezenas (ou centenas)
    // de upserts para clientes com muitos equipamentos. A chamada direta da
    // rota continua funcionando quando ainda nÃ£o existe equipamento local.
    let equipments = await prisma.equipment.findMany({
      where: { 
        tenantId, 
        isActive: true,
        contactId
      } 
    });

    if (equipments.length === 0) {
      const { syncCrmEquipmentsToEquipment } = require('../services/crmSyncService');
      await syncCrmEquipmentsToEquipment(tenantId, contactId);
      equipments = await prisma.equipment.findMany({
        where: {
          tenantId,
          isActive: true,
          contactId,
        },
      });
    }

    const messages = await prisma.message.findMany({
      where: { 
        ticketId,
        ticket: { tenantId }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    
    // As mensagens vêm desc, o history espera asc (antigas primeiro)
    const history = messages.reverse();

    let draft = { defect: null, equipmentId: null };
    let timedOut = false;
    let timeoutHandle;
    try {
      draft = await Promise.race([
        draftServiceOrder(settings, history, equipments),
        new Promise((resolve) => {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            resolve({ defect: null, equipmentId: null });
          }, OS_DRAFT_TIMEOUT_MS);
        }),
      ]);
    } catch (draftError) {
      console.warn('[draftOS] provedor de IA indisponivel; liberando preenchimento manual:', draftError.message);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
    if (timedOut) {
      console.warn(`[draftOS] rascunho excedeu ${OS_DRAFT_TIMEOUT_MS}ms; formulario liberado sem preenchimento da IA.`);
    }
    res.json(draft);
  } catch (err) {
    console.error('[draftOS]', err);
    res.status(500).json({ error: 'Erro ao gerar rascunho de O.S.' });
  }
}

module.exports = { getEquipments, addEquipment, updateEquipment, deleteEquipment, getOSList, getOpenOrdersForEquipment, createOS, getOSStatus, updateOS, generatePdf, generatePdfBuffer, resolveServiceOrderForPdf, draftOS, getOSTypes, getOSTechnicians, getOSDefectTypes };
