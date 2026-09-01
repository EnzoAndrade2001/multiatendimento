const prisma = require('../lib/prisma');
const { isServiceOrderClosed, normalizeServiceOrderStatus } = require('../utils/serviceOrderStatus');
const { hasPermission } = require('../auth/permissions');
const billingDocuments = require('../services/billingDocumentService');

const HISTORY_DEFAULT_LIMIT = 25;
const HISTORY_MAX_LIMIT = 100;
const HISTORY_MAX_OFFSET = 100000;
const CUSTOMER_DEFAULT_LIMIT = 100;
const CUSTOMER_MAX_LIMIT = 250;
const CUSTOMER_MAX_EXPORT = 10000;
const CUSTOMER_SYNC_CHUNK = 80;

function parseHistoryPagination(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const rawOffset = Number.parseInt(query.offset, 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), HISTORY_MAX_LIMIT)
    : HISTORY_DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset)
    ? Math.min(Math.max(rawOffset, 0), HISTORY_MAX_OFFSET)
    : 0;
  return { limit, offset };
}

function paginateServiceOrders(orders, pagination) {
  const { limit, offset } = pagination;
  const total = orders.length;
  const items = orders.slice(offset, offset + limit);
  const hasMore = offset + items.length < total;
  return {
    items,
    total,
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + items.length : null,
  };
}

function getCrmCapabilities(user) {
  const can = (permission) => hasPermission(user, permission);
  const canViewCrm = can('crm.view');
  const canViewFinancial = canViewCrm && can('crm.financial.view');
  return {
    tabs: {
      overview: canViewCrm,
      units: canViewCrm,
      contacts: canViewCrm,
      equipments: canViewCrm,
      contracts: canViewCrm,
      serviceOrders: canViewCrm,
      technical: canViewCrm,
      financial: canViewFinancial,
    },
    actions: {
      openConversation: can('inbox.view'),
      createServiceOrder: canViewCrm && can('inbox.create_os'),
      viewFinancial: canViewFinancial,
      sendFinancialDocuments: canViewFinancial && can('crm.financial.send'),
    },
  };
}

function syncMetadata(settings, fallbackLastSyncedAt = null) {
  const lastSyncedAt = asDate(settings?.firebirdLastSyncAt || fallbackLastSyncedAt);
  return {
    source: 'firebird',
    status: settings?.firebirdLastSyncStatus || (lastSyncedAt ? 'ok' : 'unknown'),
    lastSyncedAt,
    error: settings?.firebirdLastSyncError || null,
  };
}

function text(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function first(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
}

function rawValue(payload, ...keys) {
  const raw = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  for (const key of keys) {
    const value = payload?.[key] ?? raw[key] ?? raw[key.toLowerCase()] ?? raw[key.toUpperCase()];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === undefined || value === null || value === '') return null;
  const input = String(value).trim();
  const normalized = input.includes(',') ? input.replace(/\./g, '').replace(',', '.') : input;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function asDate(value, timeValue) {
  if (!value) return null;
  const input = String(value).trim();
  const timeMatch = timeValue && String(timeValue).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const time = timeMatch
    ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}:${timeMatch[3] || '00'}`
    : null;
  const brazilian = input.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (brazilian) {
    const [, dd, mm, yyyy, matchedHour, matchedMinute, matchedSecond] = brazilian;
    const [hh, mi, ss] = time
      ? time.split(':')
      : [matchedHour || '00', matchedMinute || '00', matchedSecond || '00'];
    const parsed = new Date(`${yyyy}-${mm}-${dd}T${hh.padStart(2, '0')}:${mi}:${ss}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const isoDay = input.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.\d+)?(?:Z)?)?$/);
  const isoDate = isoDay && time ? `${isoDay[1]}T${time}` : input;
  const parsed = new Date(isoDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asCalendarDate(value) {
  if (!value) return null;
  const input = String(value).trim();
  const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const brazilian = input.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function brazilCalendarToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function contractIsActive(status, endsAt) {
  const normalized = String(status || '').trim().toUpperCase();
  if (['C', 'I', 'N', 'CANCELADO', 'INATIVO', 'ENCERRADO', 'FINALIZADO'].includes(normalized)) return false;
  if (endsAt && new Date(endsAt).getTime() < Date.now()) return false;
  return ['G', 'A', 'S', 'ATIVO', 'VIGENTE'].includes(normalized) || !normalized;
}

function normalizeContract(record) {
  const payload = record?.payload || record || {};
  const startsAt = asDate(rawValue(payload, 'startsAt', 'dtcontratoini'));
  const endsAt = asDate(rawValue(payload, 'endsAt', 'dtcontratofin'));
  const status = first(rawValue(payload, 'status'));
  const totalValue = asNumber(rawValue(payload, 'totalValue', 'valor_total_contrato', 'valortotal_contrato')) || 0;
  const fixedValue = asNumber(rawValue(payload, 'fixedValue', 'tr_vl_fixo')) || 0;
  const franchiseValue = asNumber(rawValue(payload, 'franchiseValue', 'valor_franquia', 'valfranquia')) || 0;
  const informedMonthlyValue = asNumber(rawValue(payload, 'monthlyValue'));
  const monthlyValue = informedMonthlyValue ?? (fixedValue + franchiseValue);
  const overageRateMin = asNumber(rawValue(payload, 'overageRateMin', 'min_excedente')) || 0;
  const overageRateMax = asNumber(rawValue(payload, 'overageRateMax', 'max_excedente')) || 0;
  return {
    id: record?.id || null,
    externalId: first(record?.externalId, rawValue(payload, 'externalId', 'seqcontrato')),
    number: first(rawValue(payload, 'contractNumber', 'nrcontrato')),
    clientExternalId: first(rawValue(payload, 'clientExternalId', 'cdcliente')),
    type: first(rawValue(payload, 'contractType', 'nmcontratotp', 'tipocontrato')),
    typeCode: first(rawValue(payload, 'contractTypeCode', 'cdcontratotp', 'tipocontrato')),
    status,
    isActive: contractIsActive(status, endsAt),
    value: monthlyValue || asNumber(rawValue(payload, 'value')) || totalValue,
    monthlyValue,
    fixedValue,
    franchiseValue,
    totalValue,
    equipmentCount: asNumber(rawValue(payload, 'equipmentCount', 'qt_equipamentos')) || 0,
    pageFranchise: asNumber(rawValue(payload, 'pageFranchise', 'qt_franquia')) || 0,
    overageRateMin,
    overageRateMax,
    billingMode: first(rawValue(payload, 'billingMode', 'billing_mode')),
    startsAt,
    endsAt,
    updatedAt: asDate(rawValue(payload, 'updatedAt', 'atualizado')) || record?.syncedAt || record?.receivedAt || null,
    source: 'firebird',
  };
}

function isTruthyIntegrationFlag(value) {
  if (value === true || value === 1) return true;
  return ['1', 'S', 'SIM', 'Y', 'YES', 'TRUE'].includes(String(value ?? '').trim().toUpperCase());
}

function receivableIsCancelled(record) {
  const payload = record?.payload || record || {};
  const statusCode = String(rawValue(payload, 'statusCode', 'cd_receita_status') || '').trim().toUpperCase();
  const status = [
    rawValue(payload, 'statusLabel', 'ds_receita_status'),
    statusCode,
  ].filter(Boolean).join(' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return isTruthyIntegrationFlag(rawValue(payload, 'sourceDeleted'))
    || isTruthyIntegrationFlag(rawValue(payload, 'invoiceCancelled', 'tfnfscancelada'))
    || ['C', 'CANCELADO', 'CANCELADA'].includes(statusCode)
    || status.includes('CANCEL');
}

function normalizeReceivable(record) {
  const payload = record?.payload || record || {};
  const dueAt = asCalendarDate(rawValue(payload, 'dueAt', 'dtvectorec'));
  const paidAt = asCalendarDate(rawValue(payload, 'paidAt', 'dtpagtorec'));
  const value = asNumber(rawValue(payload, 'value', 'valreceita')) || 0;
  const paidValue = asNumber(rawValue(payload, 'paidValue', 'valreceitapaga')) || 0;
  const openValue = Math.max(0, asNumber(rawValue(payload, 'openValue')) ?? (value - paidValue));
  const isCancelled = receivableIsCancelled(record);
  const isPaid = Boolean(paidAt) || (value > 0 && openValue <= 0);
  const isOverdue = !isPaid && dueAt && dueAt < brazilCalendarToday();
  return {
    id: record?.id || null,
    externalId: first(record?.externalId, rawValue(payload, 'externalId', 'seqreceita')),
    clientExternalId: first(rawValue(payload, 'clientExternalId', 'cdcliente')),
    issuedAt: asCalendarDate(first(
      rawValue(payload, 'invoiceIssuedAt', 'dtemissaonfs'),
      rawValue(payload, 'issuedAt', 'dtemissaorec'),
    )),
    dueAt,
    paidAt,
    value,
    paidValue,
    openValue,
    invoiceNumber: first(rawValue(payload, 'invoiceNumber', 'numnf')),
    invoiceExternalId: first(rawValue(payload, 'invoiceExternalId', 'seqincnfs')),
    invoiceValue: asNumber(rawValue(payload, 'invoiceValue', 'valtotalnfs')) || value,
    invoiceCancelled: isTruthyIntegrationFlag(rawValue(payload, 'invoiceCancelled', 'tfnfscancelada')),
    sourceDeleted: isTruthyIntegrationFlag(rawValue(payload, 'sourceDeleted')),
    isCancelled,
    invoiceNotes: first(rawValue(payload, 'invoiceNotes', 'nf_obs')),
    statementExternalId: first(rawValue(payload, 'statementExternalId', 'seqdemonstrativo')),
    billingType: first(rawValue(payload, 'billingType', 'faturamento_tipo')),
    billingPeriod: first(rawValue(payload, 'billingPeriod', 'faturamento_periodo')),
    contractExternalId: first(rawValue(payload, 'contractExternalId', 'seqixlcontratos', 'seqcontrato')),
    paymentMethod: first(rawValue(payload, 'paymentMethod', 'nmformapagto')),
    boletoId: first(rawValue(payload, 'boletoId', 'id_boleto')),
    boletoStatus: first(rawValue(payload, 'boletoStatus', 'boleto_situacao')),
    boletoUrl: first(rawValue(payload, 'boletoUrl', 'urlboleto')),
    boletoPdfProtocol: first(rawValue(payload, 'boletoPdfProtocol', 'pdf_protocolo')),
    ourNumber: first(rawValue(payload, 'ourNumber', 'titulonossonumero', 'nossonumero')),
    digitableLine: first(rawValue(payload, 'digitableLine', 'titulolinhadigitavel', 'linha_digitavel')),
    barcode: first(rawValue(payload, 'barcode', 'titulocodigobarras')),
    hasBoleto: Boolean(
      first(rawValue(payload, 'boletoId', 'id_boleto'), rawValue(payload, 'boletoPdfProtocol', 'pdf_protocolo'))
      || String(first(rawValue(payload, 'paymentMethod', 'nmformapagto')) || '').toUpperCase().includes('BOLETO')
    ),
    statusLabel: first(rawValue(payload, 'statusLabel', 'ds_receita_status')),
    status: isCancelled ? 'cancelled' : isPaid ? 'paid' : isOverdue ? 'overdue' : 'open',
  };
}

function normalizeEquipmentMeter(record) {
  const payload = record?.payload || record || {};
  return {
    id: record?.id || null,
    externalId: first(record?.externalId, rawValue(payload, 'externalId')),
    equipmentExternalId: first(rawValue(payload, 'equipmentExternalId', 'cdequipamento')),
    meterCode: first(rawValue(payload, 'meterCode', 'cdmedidor')),
    currentValue: asNumber(rawValue(payload, 'currentValue', 'medidor')) || 0,
    previousValue: asNumber(rawValue(payload, 'previousValue', 'medidorult')) || 0,
    currentReadingAt: asDate(rawValue(payload, 'currentReadingAt', 'dtleitura')),
    previousReadingAt: asDate(rawValue(payload, 'previousReadingAt', 'dtleiturault')),
    updatedAt: asDate(rawValue(payload, 'updatedAt', 'atualizado')),
  };
}

function normalizeOrderStatus(status, closedAt, closing) {
  return normalizeServiceOrderStatus(status, { closedAt, closing });
}

function normalizeExternalOrder(payload, fallback = {}) {
  const source = payload?.serviceOrder && typeof payload.serviceOrder === 'object'
    ? payload.serviceOrder
    : payload || {};
  const equipment = payload?.equipment || {};
  const osType = payload?.osType || {};
  const openedAt = asDate(
    rawValue(source, 'createdAt', 'dtinclusao'),
    rawValue(source, 'time', 'hrinclusao')
  ) || asDate(rawValue(source, 'updatedAt'));
  const attendedAt = asDate(rawValue(source, 'resolvedAt', 'dtatendimento'), rawValue(source, 'hratendimento'));
  const closedAt = asDate(rawValue(source, 'closedAt', 'dtfechamento'));
  // `observacao` dos lotes antigos tambem recebeu o nome do tipo da O.S.; nao
  // deve ser tratado como fechamento. O fechamento real vem de OBSDEFEITOATS.
  const closing = first(
    source.closing,
    source.obsdefeitoats,
    source.raw?.obsdefeitoats,
    source.raw?.OBSDEFEITOATS
  );
  const rawStatus = first(rawValue(source, 'status', 'nmstatus'));
  const value = asNumber(rawValue(source, 'value', 'totalValue', 'vl_total', 'valortotal', 'vl_os', 'valortotalos', 'valor_os', 'valorservico', 'valorpecas')) || 0;
  return {
    id: null,
    externalId: first(fallback.externalId, rawValue(source, 'externalId', 'seqOs', 'seqos')),
    number: first(fallback.externalId, rawValue(source, 'externalId', 'seqOs', 'seqos')),
    clientExternalId: first(rawValue(source, 'clientExternalId', 'cdCliente', 'cdcliente')),
    equipmentExternalId: first(rawValue(source, 'equipmentExternalId', 'cdequipamento'), rawValue(equipment, 'cdequipamento')),
    equipmentModel: first(rawValue(source, 'equipmentModel', 'modeloe', 'modelo'), rawValue(equipment, 'modelo')),
    serialNumber: first(rawValue(source, 'serialNumber', 'serie'), rawValue(equipment, 'serie')),
    type: first(rawValue(source, 'osType', 'nmostp'), rawValue(osType, 'nmostp')),
    status: normalizeOrderStatus(rawStatus, closedAt, closing),
    statusLabel: rawStatus,
    defect: first(rawValue(source, 'defect', 'obsdefeitocli')),
    value,
    closing,
    technician: first(rawValue(source, 'nmSuporteT', 'nmsuportet', 'nmsuportel', 'technician')),
    attendant: first(rawValue(source, 'nmsuportea', 'attendant')),
    openedAt,
    attendedAt,
    closedAt,
    updatedAt: asDate(rawValue(source, 'updatedAt', 'atualizado')) || attendedAt || openedAt,
    source: fallback.source || 'firebird',
  };
}

function normalizeLocalOrder(order) {
  return {
    id: order.id,
    externalId: text(order.externalId),
    number: text(order.externalId),
    clientExternalId: text(order.contact?.externalId),
    equipmentExternalId: text(order.equipment?.externalId),
    equipmentModel: text(order.equipment?.model),
    serialNumber: text(order.equipment?.serialNumber),
    type: text(order.cdOstp),
    status: order.status,
    statusLabel: order.status,
    defect: text(order.defect),
    value: 0, // Fallback for local orders without value
    closing: text(order.technicalNotes),
    technician: first(order.nmsuportet, order.closedBy?.name),
    attendant: text(order.user?.name),
    managerCopySentAt: order.managerCopySentAt,
    managerCopyLastError: text(order.managerCopyLastError),
    openedAt: order.createdAt,
    attendedAt: order.resolvedAt,
    closedAt: order.closedAt,
    updatedAt: order.updatedAt,
    source: order.externalSource || 'local',
  };
}

function orderTimestamp(order) {
  const value = order.closedAt || order.attendedAt || order.updatedAt || order.openedAt;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function orderOpenedTimestamp(order) {
  const timestamp = order?.openedAt ? new Date(order.openedAt).getTime() : 0;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function mergeOrders(...groups) {
  const merged = new Map();
  for (const order of groups.flat()) {
    if (!order) continue;
    const key = order.externalId ? `external:${order.externalId}` : `local:${order.id}`;
    const previous = merged.get(key);
    const populatedFields = Object.fromEntries(
      Object.entries(order).filter(([, value]) => value !== null && value !== undefined && value !== '')
    );
    if (!previous) merged.set(key, populatedFields);
    else if (orderTimestamp(order) >= orderTimestamp(previous)) merged.set(key, { ...previous, ...populatedFields });
    else merged.set(key, { ...populatedFields, ...previous });
  }
  return [...merged.values()].sort((a, b) => orderTimestamp(b) - orderTimestamp(a));
}

function hoursBetween(start, end) {
  if (!start || !end) return null;
  const startAt = new Date(start).getTime();
  const endAt = new Date(end).getTime();
  if (Number.isNaN(startAt) || Number.isNaN(endAt) || endAt < startAt) return null;
  return (endAt - startAt) / 3600000;
}

function locationPart(value) {
  return text(value) || '';
}

function buildCustomerUnits(customer) {
  const units = new Map();
  const customerAddress = [customer.address, customer.neighborhood, customer.city, customer.state]
    .map(locationPart)
    .join('|')
    .toLowerCase();

  for (const equipment of customer.equipments || []) {
    const address = first(equipment.address, customer.address);
    const city = first(equipment.city, customer.city);
    const state = first(equipment.state, customer.state);
    const neighborhood = first(rawValue(equipment.raw || {}, 'bairro', 'nmbairro'), customer.neighborhood);
    const key = [address, neighborhood, city, state].map(locationPart).join('|').toLowerCase() || customerAddress || 'sem-endereco';
    if (!units.has(key)) {
      units.set(key, {
        id: `unit-${units.size + 1}`,
        name: first(equipment.installLocation, equipment.sector, address, 'Unidade principal'),
        address,
        neighborhood,
        city,
        state,
        equipments: [],
        departments: [],
      });
    }
    const unit = units.get(key);
    unit.equipments.push(equipment);
    const department = first(equipment.sector, equipment.installLocation);
    if (department && !unit.departments.includes(department)) unit.departments.push(department);
  }

  if (!units.size) {
    units.set(customerAddress || 'sem-endereco', {
      id: 'unit-1',
      name: 'Unidade principal',
      address: customer.address,
      neighborhood: customer.neighborhood,
      city: customer.city,
      state: customer.state,
      equipments: [],
      departments: [],
    });
  }

  return [...units.values()].map((unit) => ({
    ...unit,
    equipmentCount: unit.equipments.length,
    activeEquipmentCount: unit.equipments.filter((equipment) => equipment.isActive !== false).length,
  }));
}

async function findTenantCustomer(tenantId, id) {
  return prisma.crmCustomer.findFirst({
    where: { id, tenantId },
    include: {
      equipments: { orderBy: [{ isActive: 'desc' }, { model: 'asc' }] },
      whatsappContacts: {
        select: { id: true, phone: true, whatsapp: true, name: true, externalSource: true, createdAt: true },
      },
    },
  });
}

async function loadContracts(tenantId, customerExternalId) {
  if (!customerExternalId) return [];
  const records = await prisma.externalSyncRecord.findMany({
    where: {
      tenantId,
      source: 'firebird',
      entity: 'contracts',
      payload: { path: ['clientExternalId'], equals: String(customerExternalId) },
    },
    select: { id: true, externalId: true, payload: true, receivedAt: true, syncedAt: true },
    orderBy: { receivedAt: 'desc' },
  });
  return records.map(normalizeContract).sort((a, b) => Number(b.isActive) - Number(a.isActive));
}

async function loadCustomerOrderCatalog(tenantId, customer, sourceLimit = null) {
  const externalId = String(customer.externalId || '');
  const numericExternalId = /^\d+$/.test(externalId) ? Number(externalId) : null;
  const printClientFilters = [{ path: ['serviceOrder', 'cdcliente'], equals: externalId }];
  if (numericExternalId !== null) printClientFilters.push({ path: ['serviceOrder', 'cdcliente'], equals: numericExternalId });

  const [syncedRecords, printRecords, localOrders] = await Promise.all([
    externalId
      ? prisma.externalSyncRecord.findMany({
        where: {
          tenantId,
          source: 'firebird',
          entity: 'serviceOrders',
          payload: { path: ['clientExternalId'], equals: externalId },
        },
        select: { externalId: true, payload: true, syncedAt: true, receivedAt: true },
        orderBy: { receivedAt: 'desc' },
        ...(sourceLimit ? { take: sourceLimit } : {}),
      })
      : [],
    externalId
      ? prisma.externalSyncRecord.findMany({
        where: {
          tenantId,
          source: 'firebird',
          entity: 'osPrintData',
          OR: printClientFilters.map((payload) => ({ payload })),
        },
        select: { externalId: true, payload: true, syncedAt: true, receivedAt: true },
        orderBy: { receivedAt: 'desc' },
        ...(sourceLimit ? { take: sourceLimit } : {}),
      })
      : [],
    prisma.serviceOrder.findMany({
      where: {
        tenantId,
        contact: {
          is: {
            OR: [
              { crmCustomerId: customer.id },
              ...(externalId ? [{ externalSource: 'firebird', externalId }] : []),
            ],
          },
        },
      },
      include: {
        equipment: { select: { externalId: true, model: true, serialNumber: true } },
        contact: { select: { externalId: true } },
        user: { select: { name: true } },
        closedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...(sourceLimit ? { take: sourceLimit } : {}),
    }),
  ]);

  const synced = syncedRecords.map((record) => normalizeExternalOrder(record.payload, {
    externalId: record.externalId,
    source: 'firebird-sync',
  }));
  const snapshots = [];
  for (const record of printRecords) {
    snapshots.push(normalizeExternalOrder(record.payload, {
      externalId: record.externalId,
      source: 'firebird-snapshot',
    }));
    for (const historyItem of Array.isArray(record.payload?.history) ? record.payload.history : []) {
      snapshots.push(normalizeExternalOrder(historyItem, { source: 'firebird-history' }));
    }
  }

  const externalSyncDates = [...syncedRecords, ...printRecords]
    .map((record) => record.syncedAt || record.receivedAt)
    .filter(Boolean)
    .map((date) => new Date(date).getTime())
    .filter(Number.isFinite);
  return {
    orders: mergeOrders(synced, snapshots, localOrders.map(normalizeLocalOrder)),
    lastSyncedAt: externalSyncDates.length
      ? new Date(Math.max(...externalSyncDates)).toISOString()
      : null,
  };
}

async function loadCustomerOrders(tenantId, customer, limit = HISTORY_DEFAULT_LIMIT) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || HISTORY_DEFAULT_LIMIT, 1), HISTORY_MAX_LIMIT);
  const catalog = await loadCustomerOrderCatalog(tenantId, customer, normalizedLimit);
  return catalog.orders.slice(0, normalizedLimit);
}

async function getSummary(req, res) {
  const tenantId = req.user.tenantId;
  const [
    customers,
    equipments,
    linkedEquipments,
    activeEquipments,
    activeEquipmentContractLinks,
    contractRecords,
    syncedServiceOrders,
    syncedOpenServiceOrders,
    localServiceOrders,
    localOpenServiceOrders,
    customerRevenue,
    settings,
  ] = await Promise.all([
    prisma.crmCustomer.count({ where: { tenantId } }),
    prisma.crmEquipment.count({ where: { tenantId } }),
    prisma.crmEquipment.count({ where: { tenantId, customerId: { not: null } } }),
    prisma.crmEquipment.count({ where: { tenantId, isActive: true } }),
    prisma.crmEquipment.findMany({
      where: { tenantId, isActive: true, contractExternalId: { not: null } },
      select: { contractExternalId: true },
    }),
    prisma.externalSyncRecord.findMany({
      where: { tenantId, source: 'firebird', entity: 'contracts' },
      select: { externalId: true, payload: true, syncedAt: true, receivedAt: true },
    }),
    prisma.externalSyncRecord.count({ where: { tenantId, source: 'firebird', entity: 'serviceOrders' } }),
    prisma.externalSyncRecord.count({
      where: {
        tenantId,
        source: 'firebird',
        entity: 'serviceOrders',
        OR: ['A', 'E', 'M', 'T', 'P'].map((status) => ({
          payload: { path: ['raw', 'status'], equals: status },
        })),
      },
    }),
    prisma.serviceOrder.count({ where: { tenantId } }),
    prisma.serviceOrder.count({ where: { tenantId, status: { not: 'FINALIZADA' } } }),
    prisma.crmCustomer.findMany({ where: { tenantId }, select: { raw: true } }),
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { firebirdLastSyncAt: true, firebirdLastSyncStatus: true, firebirdLastSyncError: true },
    }),
  ]);

  const contracts = contractRecords.map(normalizeContract);
  const activeContractIds = new Set(
    contracts
      .filter((contract) => contract.isActive)
      .map((contract) => text(contract.externalId))
      .filter(Boolean)
  );
  const contractedEquipments = activeEquipmentContractLinks.filter((equipment) => (
    activeContractIds.has(text(equipment.contractExternalId))
  )).length;
  const customerMonthlyRevenue = customerRevenue.reduce((total, customer) => {
    return total + (asNumber(rawValue(customer.raw || {}, 'total_mensalidade')) || 0);
  }, 0);
  const contractMonthlyRevenue = contracts
    .filter((contract) => contract.isActive)
    .reduce((total, contract) => total + (contract.monthlyValue || contract.value || 0), 0);
  const monthlyRevenue = Math.max(customerMonthlyRevenue, contractMonthlyRevenue);

  res.json({
    // Campos antigos mantidos para compatibilidade.
    customers,
    equipments,
    linkedEquipments,
    activeEquipments,
    contractedEquipments,
    unlinkedEquipments: Math.max(0, equipments - linkedEquipments),
    contracts: {
      total: contracts.length,
      active: contracts.filter((contract) => contract.isActive).length,
      value: contracts.reduce((total, contract) => total + (contract.value || 0), 0),
    },
    serviceOrders: {
      synced: syncedServiceOrders,
      local: localServiceOrders,
      open: syncedServiceOrders ? syncedOpenServiceOrders : localOpenServiceOrders,
      closed: syncedServiceOrders
        ? Math.max(0, syncedServiceOrders - syncedOpenServiceOrders)
        : Math.max(0, localServiceOrders - localOpenServiceOrders),
    },
    monthlyRevenue,
    synchronization: {
      lastSyncAt: settings?.firebirdLastSyncAt || null,
      status: settings?.firebirdLastSyncStatus || 'idle',
      error: settings?.firebirdLastSyncError || null,
    },
  });
}

function asBoolean(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'sim', 'on', 'ativo'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'nao', 'não', 'off', 'inativo'].includes(normalized)) return false;
  return null;
}

function parseCustomerListOptions(query = {}) {
  const hasPage = query.page !== undefined || query.pageSize !== undefined || query.offset !== undefined;
  const paginate = asBoolean(query.paginate) === true || hasPage;
  const rawPage = Number.parseInt(query.page, 10);
  const rawPageSize = Number.parseInt(query.pageSize ?? query.limit, 10);
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.min(Math.max(rawPageSize, 1), CUSTOMER_MAX_LIMIT)
    : CUSTOMER_DEFAULT_LIMIT;
  const rawOffset = Number.parseInt(query.offset, 10);
  const requestedPage = Number.isFinite(rawPage) ? Math.max(rawPage, 1) : 1;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(rawOffset, 0)
    : (requestedPage - 1) * pageSize;
  const page = Number.isFinite(rawPage)
    ? requestedPage
    : Math.floor(offset / pageSize) + 1;
  const q = String(query.q || '').trim();
  const city = String(query.city || query.cidade || '').trim();
  const state = String(query.state || query.uf || query.estado || '').trim();
  const contractStatus = String(query.contractStatus || query.contract || query.contrato || '').trim().toLowerCase();
  const financialStatus = String(query.financialStatus || query.financeiro || '').trim().toLowerCase();
  const view = String(query.view || query.visao || '').trim().toLowerCase();
  const sort = String(query.sort || query.ordenar || 'name').trim().toLowerCase();
  const order = String(query.order || query.direction || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  return {
    q,
    city,
    state,
    contractStatus,
    financialStatus,
    view,
    hasContract: asBoolean(query.hasContract ?? query.comContrato),
    contractedOnly: asBoolean(query.contractedOnly ?? query.equipmentInContract ?? query.emContrato),
    hasOpenOrders: asBoolean(query.hasOpenOrders ?? query.openOrders ?? query.osAbertas),
    hasPhone: asBoolean(query.hasPhone ?? query.comTelefone),
    sort,
    order,
    page,
    pageSize,
    offset,
    paginate,
  };
}

function customerWhereFromOptions(tenantId, options) {
  const { q, city, state, hasPhone } = options;
  const where = { tenantId };
  if (q) {
    where.OR = [
      { externalId: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { fantasyName: { contains: q, mode: 'insensitive' } },
      { cpfCnpj: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { address: { contains: q, mode: 'insensitive' } },
      { neighborhood: { contains: q, mode: 'insensitive' } },
      { city: { contains: q, mode: 'insensitive' } },
      {
        equipments: {
          some: {
            OR: [
              { model: { contains: q, mode: 'insensitive' } },
              { serialNumber: { contains: q, mode: 'insensitive' } },
              { assetTag: { contains: q, mode: 'insensitive' } },
              { address: { contains: q, mode: 'insensitive' } },
              { sector: { contains: q, mode: 'insensitive' } },
              { installLocation: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
    ];
  }
  if (city) where.city = { contains: city, mode: 'insensitive' };
  if (state) where.state = { contains: state, mode: 'insensitive' };
  if (hasPhone === true) where.phone = { not: null };
  if (hasPhone === false) where.phone = null;
  return where;
}

async function findCustomerSyncRecords(tenantId, entity, externalIds) {
  const ids = [...new Set(externalIds.map((id) => text(id)).filter(Boolean))];
  if (!ids.length) return [];
  const records = [];
  for (let index = 0; index < ids.length; index += CUSTOMER_SYNC_CHUNK) {
    const chunk = ids.slice(index, index + CUSTOMER_SYNC_CHUNK);
    const rows = await prisma.externalSyncRecord.findMany({
      where: {
        tenantId,
        source: 'firebird',
        entity,
        OR: chunk.map((externalId) => ({ payload: { path: ['clientExternalId'], equals: externalId } })),
      },
      select: { id: true, externalId: true, payload: true, receivedAt: true, syncedAt: true },
    });
    records.push(...rows);
  }
  return records;
}

function customerMetricTemplate(customer) {
  return {
    contractsCount: 0,
    activeContractsCount: 0,
    contractedEquipmentsCount: 0,
    openServiceOrdersCount: 0,
    overdueReceivablesCount: 0,
    openReceivablesCount: 0,
    monthlyValue: asNumber(rawValue(customer.raw || {}, 'total_mensalidade')) || 0,
    contractMonthlyValue: 0,
    lastServiceOrderAt: null,
  };
}

async function loadCustomerOperationalMetrics(tenantId, customers) {
  const metrics = new Map(customers.map((customer) => [customer.id, customerMetricTemplate(customer)]));
  if (!customers.length) return metrics;
  const externalIds = customers.map((customer) => customer.externalId).filter(Boolean);
  const customerIds = customers.map((customer) => customer.id);
  const [contractRecords, orderRecords, receivableRecords, localOrders, allEquipments] = await Promise.all([
    findCustomerSyncRecords(tenantId, 'contracts', externalIds),
    findCustomerSyncRecords(tenantId, 'serviceOrders', externalIds),
    findCustomerSyncRecords(tenantId, 'receivables', externalIds),
    prisma.serviceOrder.findMany({
      where: {
        tenantId,
        contact: { is: { crmCustomerId: { in: customerIds } } },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
        contact: { select: { crmCustomerId: true } },
      },
    }),
    prisma.crmEquipment.findMany({
      where: { tenantId, customerId: { in: customerIds } },
      select: { customerId: true, externalId: true, contractExternalId: true, isActive: true },
    }),
  ]);
  const customerByExternalId = new Map(customers.map((customer) => [text(customer.externalId), customer]));
  const activeContractIdsByCustomer = new Map();
  for (const record of contractRecords) {
    const normalized = normalizeContract(record);
    const customer = customerByExternalId.get(text(normalized.clientExternalId));
    if (!customer) continue;
    const metric = metrics.get(customer.id);
    metric.contractsCount += 1;
    if (normalized.isActive) {
      metric.activeContractsCount += 1;
      metric.contractMonthlyValue += normalized.monthlyValue || normalized.value || 0;
      const ids = activeContractIdsByCustomer.get(customer.id) || new Set();
      if (normalized.externalId) ids.add(text(normalized.externalId));
      activeContractIdsByCustomer.set(customer.id, ids);
    }
  }
  const equipmentsByCustomer = new Map();
  for (const equipment of allEquipments) {
    const list = equipmentsByCustomer.get(equipment.customerId) || [];
    list.push(equipment);
    equipmentsByCustomer.set(equipment.customerId, list);
  }
  for (const customer of customers) {
    const metric = metrics.get(customer.id);
    const activeContractIds = activeContractIdsByCustomer.get(customer.id) || new Set();
    const equipments = equipmentsByCustomer.get(customer.id) || customer.equipments || [];
    metric.contractedEquipmentsCount = equipments.filter((equipment) => (
      equipment.isActive !== false
      && equipment.contractExternalId
      && activeContractIds.has(text(equipment.contractExternalId))
    )).length;
    if (metric.contractMonthlyValue > 0) metric.monthlyValue = metric.contractMonthlyValue;
    // A CRM customer can carry the contract total only in its raw snapshot.
    // Keep the explicit customer value when no contract record was imported.
    if (!metric.contractsCount && metric.monthlyValue === 0) {
      metric.monthlyValue = asNumber(rawValue(customer.raw || {}, 'total_mensalidade')) || 0;
    }
  }
  const orderKeys = new Set();
  for (const record of orderRecords) {
    const normalized = normalizeExternalOrder(record.payload, { externalId: record.externalId });
    const customer = customerByExternalId.get(text(normalized.clientExternalId));
    if (!customer) continue;
    const metric = metrics.get(customer.id);
    const key = `${customer.id}:${normalized.externalId || record.id}`;
    if (orderKeys.has(key)) continue;
    orderKeys.add(key);
    if (!isServiceOrderClosed(normalized)) metric.openServiceOrdersCount += 1;
    const timestamp = orderTimestamp(normalized);
    if (timestamp && (!metric.lastServiceOrderAt || timestamp > new Date(metric.lastServiceOrderAt).getTime())) {
      metric.lastServiceOrderAt = normalized.openedAt || normalized.updatedAt || null;
    }
  }
  for (const order of localOrders) {
    const customerId = order.contact?.crmCustomerId;
    const metric = metrics.get(customerId);
    if (!metric) continue;
    const key = `${customerId}:local:${order.id}`;
    if (orderKeys.has(key)) continue;
    orderKeys.add(key);
    if (!isServiceOrderClosed(order)) metric.openServiceOrdersCount += 1;
    const timestamp = order.createdAt || order.updatedAt;
    if (timestamp && (!metric.lastServiceOrderAt || new Date(timestamp).getTime() > new Date(metric.lastServiceOrderAt).getTime())) {
      metric.lastServiceOrderAt = timestamp;
    }
  }
  for (const record of receivableRecords) {
    const normalized = normalizeReceivable(record);
    if (normalized.isCancelled) continue;
    const customer = customerByExternalId.get(text(normalized.clientExternalId));
    if (!customer) continue;
    const metric = metrics.get(customer.id);
    if (normalized.openValue > 0) metric.openReceivablesCount += 1;
    if (normalized.status === 'overdue') metric.overdueReceivablesCount += 1;
  }
  return metrics;
}

function applyCustomerOperationalFilters(customers, options) {
  return customers.filter((customer) => {
    const view = options.view;
    if (view === 'contracted' && !(customer.contractedEquipmentsCount > 0 || customer.activeContractsCount > 0)) return false;
    if (view === 'open' && customer.openServiceOrdersCount <= 0) return false;
    if (view === 'attention' && !(
      customer.openServiceOrdersCount > 0
      || customer.overdueReceivablesCount > 0
      || !customer.phone
      || customer.contractedEquipmentsCount <= 0
    )) return false;
    if (view === 'without-contract' && !(customer.contractedEquipmentsCount <= 0 && customer.activeContractsCount <= 0)) return false;
    if (options.hasContract !== null && Boolean(customer.activeContractsCount > 0) !== options.hasContract) return false;
    if (options.contractedOnly !== null && Boolean(customer.contractedEquipmentsCount > 0) !== options.contractedOnly) return false;
    if (options.hasOpenOrders !== null && Boolean(customer.openServiceOrdersCount > 0) !== options.hasOpenOrders) return false;
    if (options.contractStatus) {
      const active = customer.activeContractsCount > 0;
      const total = customer.contractsCount > 0;
      if (['active', 'ativo', 'vigente', 'aberto'].includes(options.contractStatus) && !active) return false;
      if (['inactive', 'inativo', 'encerrado', 'cancelado', 'fechado'].includes(options.contractStatus) && (!total || active)) return false;
      if (['none', 'sem', 'sem-contrato', 'nenhum'].includes(options.contractStatus) && total) return false;
    }
    if (options.financialStatus) {
      if (['overdue', 'vencido', 'inadimplente'].includes(options.financialStatus) && !customer.overdueReceivablesCount) return false;
      if (['open', 'aberto', 'pendente'].includes(options.financialStatus) && !customer.openReceivablesCount) return false;
      if (['clear', 'regular', 'pago', 'sem-pendencia'].includes(options.financialStatus) && customer.openReceivablesCount) return false;
    }
    return true;
  });
}

function sortCustomers(customers, options) {
  const direction = options.order === 'desc' ? -1 : 1;
  const sortKey = options.sort;
  const value = (customer) => {
    if (sortKey === 'attention' || sortKey === 'atencao') {
      return Number(customer.overdueReceivablesCount || 0) * 4
        + Number(customer.openServiceOrdersCount || 0) * 2
        + (customer.contractedEquipmentsCount > 0 ? 0 : 1)
        + (customer.phone ? 0 : 1);
    }
    if (sortKey === 'monthlyvalue' || sortKey === 'mensalidade') return Number(customer.monthlyValue || 0);
    if (sortKey === 'openorders' || sortKey === 'osabertas') return Number(customer.openServiceOrdersCount || 0);
    if (sortKey === 'contracts' || sortKey === 'contratos') return Number(customer.activeContractsCount || 0);
    if (sortKey === 'equipments' || sortKey === 'equipamentos') return Number(customer.contractedEquipmentsCount || 0);
    if (sortKey === 'overdue' || sortKey === 'vencidos') return Number(customer.overdueReceivablesCount || 0);
    if (sortKey === 'updatedat' || sortKey === 'atualizado') return new Date(customer.updatedAt || 0).getTime() || 0;
    return String(customer.fantasyName || customer.name || '').toLocaleLowerCase('pt-BR');
  };
  return customers.sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a < b) return -1 * direction;
    if (a > b) return 1 * direction;
    return String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR') * direction;
  });
}

async function queryCustomers(tenantId, query = {}, { forExport = false } = {}) {
  const options = parseCustomerListOptions(query);
  const where = customerWhereFromOptions(tenantId, options);
  const customers = await prisma.crmCustomer.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { equipments: true, whatsappContacts: true } },
      equipments: {
        orderBy: [{ isActive: 'desc' }, { model: 'asc' }],
        take: 8,
      },
    },
  });
  const metricSorts = new Set(['monthlyvalue', 'mensalidade', 'openorders', 'osabertas', 'contracts', 'contratos', 'equipments', 'equipamentos', 'overdue', 'vencidos', 'attention', 'atencao']);
  const needsAllMetrics = forExport
    || options.hasContract !== null
    || options.contractedOnly !== null
    || options.hasOpenOrders !== null
    || Boolean(options.view)
    || Boolean(options.contractStatus)
    || Boolean(options.financialStatus)
    || metricSorts.has(options.sort);
  const metricCustomers = needsAllMetrics
    ? customers
    : customers.slice(options.offset, options.offset + options.pageSize);
  const metrics = await loadCustomerOperationalMetrics(tenantId, metricCustomers);
  const enriched = customers.map((customer) => {
    const { contractMonthlyValue: _contractMonthlyValue, ...publicMetrics } = metrics.get(customer.id) || {};
    return {
      ...customer,
      ...publicMetrics,
      totalEquipmentCount: customer._count?.equipments || customer.equipments?.length || 0,
      whatsappContactCount: customer._count?.whatsappContacts || 0,
    };
  });
  const filtered = sortCustomers(applyCustomerOperationalFilters(enriched, options), options);
  const total = filtered.length;
  const max = forExport ? CUSTOMER_MAX_EXPORT : options.pageSize;
  const offset = forExport ? 0 : options.offset;
  const items = filtered.slice(offset, offset + max);
  return {
    items,
    total,
    page: options.page,
    pageSize: options.pageSize,
    limit: options.pageSize,
    offset,
    hasMore: offset + items.length < total,
    filters: {
      q: options.q,
      city: options.city || null,
      state: options.state || null,
      contractStatus: options.contractStatus || null,
      financialStatus: options.financialStatus || null,
      view: options.view || null,
      hasContract: options.hasContract,
      contractedOnly: options.contractedOnly,
      hasOpenOrders: options.hasOpenOrders,
      hasPhone: options.hasPhone,
      sort: options.sort,
      order: options.order,
    },
  };
}

function csvEscape(value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  return /[";\r\n]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

async function exportCustomers(req, res) {
  const result = await queryCustomers(req.user.tenantId, req.query, { forExport: true });
  const columns = [
    ['Código ILUX', (customer) => customer.externalId],
    ['Nome fantasia', (customer) => customer.fantasyName || customer.name],
    ['Razão social', (customer) => customer.name],
    ['CNPJ/CPF', (customer) => customer.cpfCnpj],
    ['Telefone', (customer) => customer.phone],
    ['E-mail', (customer) => customer.email],
    ['Cidade', (customer) => customer.city],
    ['UF', (customer) => customer.state],
    ['Equipamentos cadastrados', (customer) => customer.totalEquipmentCount],
    ['Equipamentos em contrato', (customer) => customer.contractedEquipmentsCount],
    ['Contratos ativos', (customer) => customer.activeContractsCount],
    ['O.S. abertas', (customer) => customer.openServiceOrdersCount],
    ['Títulos vencidos', (customer) => customer.overdueReceivablesCount],
    ['Mensalidade', (customer) => customer.monthlyValue],
    ['Última O.S.', (customer) => customer.lastServiceOrderAt],
  ];
  const lines = [columns.map(([label]) => csvEscape(label)).join(';')];
  for (const customer of result.items) lines.push(columns.map(([, read]) => csvEscape(read(customer))).join(';'));
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="crm-clientes-${date}.csv"`);
  res.setHeader('X-Total-Count', String(result.total));
  res.setHeader('X-Export-Limit', String(CUSTOMER_MAX_EXPORT));
  return res.send(`\uFEFF${lines.join('\r\n')}`);
}

async function listCustomers(req, res) {
  const result = await queryCustomers(req.user.tenantId, req.query);
  res.setHeader('X-Total-Count', String(result.total));
  // The original endpoint returned an array and is still used by compact
  // selectors. Pagination is opt-in to avoid breaking those consumers.
  if (!parseCustomerListOptions(req.query).paginate) return res.json(result.items);
  return res.json(result);
}

async function getCustomer(req, res) {
  const tenantId = req.user.tenantId;
  const customer = await findTenantCustomer(tenantId, req.params.id);
  if (!customer) return res.status(404).json({ error: 'Cliente CRM nao encontrado' });

  res.json({
    ...customer,
    generatedAt: new Date().toISOString(),
    sync: syncMetadata(null, customer.externalUpdatedAt || customer.updatedAt),
    capabilities: getCrmCapabilities(req.user),
    operationalSummary: {
      equipments: customer.equipments.length,
      activeEquipments: customer.equipments.filter((equipment) => equipment.isActive).length,
      monthlyRevenue: asNumber(rawValue(customer.raw || {}, 'total_mensalidade')) || 0,
    },
  });
}

async function getCustomerContracts(req, res) {
  const customer = await prisma.crmCustomer.findFirst({
    where: { id: req.params.id, tenantId: req.user.tenantId },
    select: {
      externalId: true,
      raw: true,
      equipments: { select: { contractExternalId: true } },
    },
  });
  if (!customer) return res.status(404).json({ error: 'Cliente CRM nao encontrado' });
  const contracts = await loadContracts(req.user.tenantId, customer.externalId);
  const activeContracts = contracts.filter((contract) => contract.isActive);

  for (const contract of contracts) {
    const linkedCount = customer.equipments.filter((equipment) => (
      text(equipment.contractExternalId) === text(contract.externalId)
    )).length;
    if (linkedCount > contract.equipmentCount) contract.equipmentCount = linkedCount;
  }

  // Compatibilidade imediata com a base ja sincronizada: quando o cliente tem
  // um unico contrato ativo, o total_mensalidade do cadastro pertence a ele.
  if (activeContracts.length === 1) {
    const onlyContract = activeContracts[0];
    const customerMonthlyValue = asNumber(rawValue(customer.raw || {}, 'total_mensalidade')) || 0;
    if (!onlyContract.monthlyValue && customerMonthlyValue) {
      onlyContract.monthlyValue = customerMonthlyValue;
      onlyContract.value = customerMonthlyValue;
    }
    if (!onlyContract.equipmentCount) onlyContract.equipmentCount = customer.equipments.length;
  }
  const contractSyncDates = contracts
    .map((contract) => contract.updatedAt ? new Date(contract.updatedAt).getTime() : NaN)
    .filter(Number.isFinite);
  res.json({
    items: contracts,
    total: contracts.length,
    active: contracts.filter((item) => item.isActive).length,
    generatedAt: new Date().toISOString(),
    sync: syncMetadata(null, contractSyncDates.length ? new Date(Math.max(...contractSyncDates)).toISOString() : null),
    capabilities: getCrmCapabilities(req.user),
  });
}

async function getCustomerServiceOrders(req, res) {
  const customer = await findTenantCustomer(req.user.tenantId, req.params.id);
  if (!customer) return res.status(404).json({ error: 'Cliente CRM nao encontrado' });
  const { limit, offset } = parseHistoryPagination(req.query);
  const [catalog, settings] = await Promise.all([
    loadCustomerOrderCatalog(req.user.tenantId, customer),
    prisma.tenantSettings.findUnique({
      where: { tenantId: req.user.tenantId },
      select: { firebirdLastSyncAt: true, firebirdLastSyncStatus: true, firebirdLastSyncError: true },
    }),
  ]);
  const page = paginateServiceOrders(catalog.orders, { limit, offset });
  res.json({
    ...page,
    generatedAt: new Date().toISOString(),
    sync: syncMetadata(settings, catalog.lastSyncedAt),
    capabilities: getCrmCapabilities(req.user),
  });
}

async function getCustomer360(req, res) {
  const tenantId = req.user.tenantId;
  const customer = await findTenantCustomer(tenantId, req.params.id);
  if (!customer) return res.status(404).json({ error: 'Cliente CRM nao encontrado' });

  const contactIds = customer.whatsappContacts.map((contact) => contact.id);
  const equipmentExternalIds = customer.equipments.map((equipment) => text(equipment.externalId)).filter(Boolean);
  const canViewFinancial = hasPermission(req.user, 'crm.financial.view');
  const capabilities = getCrmCapabilities(req.user);
  const [contracts, orders, settings, tickets, receivableRecords, meterRecords] = await Promise.all([
    loadContracts(tenantId, customer.externalId),
    loadCustomerOrders(tenantId, customer, HISTORY_MAX_LIMIT),
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        kpiSlaLimitHours: true,
        firebirdLastSyncAt: true,
        firebirdLastSyncStatus: true,
        firebirdLastSyncError: true,
      },
    }),
    contactIds.length
      ? prisma.ticket.findMany({
        where: { tenantId, contactId: { in: contactIds } },
        select: {
          id: true,
          contactId: true,
          subject: true,
          status: true,
          createdAt: true,
          resolvedAt: true,
          firstResponseAt: true,
          slaDueAt: true,
          agent: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      : [],
    canViewFinancial && customer.externalId
      ? prisma.externalSyncRecord.findMany({
        where: {
          tenantId,
          source: 'firebird',
          entity: 'receivables',
          payload: { path: ['clientExternalId'], equals: String(customer.externalId) },
        },
        select: { id: true, externalId: true, payload: true, receivedAt: true, syncedAt: true },
        orderBy: { receivedAt: 'desc' },
        take: 120,
      })
      : [],
    equipmentExternalIds.length
      ? prisma.externalSyncRecord.findMany({
        where: {
          tenantId,
          source: 'firebird',
          entity: 'equipmentMeters',
          OR: equipmentExternalIds.map((externalId) => ({
            payload: { path: ['equipmentExternalId'], equals: externalId },
          })),
        },
        select: { id: true, externalId: true, payload: true, receivedAt: true, syncedAt: true },
        orderBy: { receivedAt: 'desc' },
      })
      : [],
  ]);

  const receivables = receivableRecords.map(normalizeReceivable)
    .filter((item) => !item.isCancelled)
    .sort((a, b) => {
      const issuedComparison = String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''));
      if (issuedComparison !== 0) return issuedComparison;
      return (asNumber(b.invoiceNumber) || asNumber(b.externalId) || 0)
        - (asNumber(a.invoiceNumber) || asNumber(a.externalId) || 0);
    });
  const meters = meterRecords.map(normalizeEquipmentMeter);

  const slaTargetHours = Math.max(1, Number(settings?.kpiSlaLimitHours || 24));
  const now = Date.now();
  const closedOrders = orders.filter((order) => isOrderClosedForAnalytics(order));
  const resolutionHours = closedOrders
    .map((order) => hoursBetween(order.openedAt, order.closedAt || order.attendedAt))
    .filter((hours) => hours !== null);
  const withinSla = resolutionHours.filter((hours) => hours <= slaTargetHours).length;
  const openOrders = orders.filter((order) => !isOrderClosedForAnalytics(order));
  const overdueOrders = openOrders.filter((order) => {
    const openedAt = order.openedAt ? new Date(order.openedAt).getTime() : now;
    return !Number.isNaN(openedAt) && now - openedAt > slaTargetHours * 3600000;
  });

  const equipmentOccurrences = new Map();
  const recurrenceSince = now - 90 * 86400000;
  for (const order of orders) {
    const openedAt = order.openedAt ? new Date(order.openedAt).getTime() : 0;
    if (openedAt < recurrenceSince) continue;
    const key = first(order.equipmentExternalId, order.serialNumber, order.equipmentModel);
    if (!key) continue;
    const current = equipmentOccurrences.get(key) || {
      equipmentExternalId: order.equipmentExternalId,
      model: order.equipmentModel,
      serialNumber: order.serialNumber,
      count: 0,
    };
    current.count += 1;
    equipmentOccurrences.set(key, current);
  }
  const recurringEquipments = [...equipmentOccurrences.values()]
    .filter((equipment) => equipment.count >= 2)
    .sort((a, b) => b.count - a.count);

  const expiringContracts = contracts.filter((contract) => {
    if (!contract.isActive || !contract.endsAt) return false;
    const end = new Date(contract.endsAt).getTime();
    return !Number.isNaN(end) && end >= now && end - now <= 90 * 86400000;
  });
  const activeContracts = contracts.filter((contract) => contract.isActive);
  const unlinkedEquipments = customer.equipments.filter((equipment) => (
    equipment.isActive !== false && !text(equipment.contractExternalId)
  ));
  // Bases antigas podem nao trazer SEQCONTRATO no equipamento. Com apenas um
  // contrato ativo, o vinculo e inequivoco e nao deve gerar um falso alerta.
  if (activeContracts.length === 1) unlinkedEquipments.length = 0;
  const missingFields = [
    !text(customer.cpfCnpj) && 'CNPJ/CPF',
    !text(customer.phone) && 'telefone',
    !text(customer.address) && 'endereco',
  ].filter(Boolean);

  const openReceivables = receivables.filter((item) => item.status !== 'paid');
  const overdueReceivables = receivables.filter((item) => item.status === 'overdue');
  const paidReceivables = receivables.filter((item) => item.status === 'paid');
  const nextReceivable = openReceivables
    .filter((item) => item.dueAt && item.dueAt >= brazilCalendarToday())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] || null;
  const lastPayment = paidReceivables
    .filter((item) => item.paidAt)
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0] || null;

  const relationshipContacts = [];
  const contactKeys = new Set();
  const addRelationshipContact = (entry) => {
    const key = [entry.name, entry.phone, entry.email, entry.source].map((value) => text(value) || '').join('|').toLowerCase();
    if (!key.replaceAll('|', '') || contactKeys.has(key)) return;
    contactKeys.add(key);
    relationshipContacts.push(entry);
  };
  addRelationshipContact({
    id: 'ilux-main', role: 'Contato principal', source: 'Cadastro iLux',
    name: customer.contactName, phone: customer.phone, email: customer.email,
  });
  for (const contact of customer.whatsappContacts) addRelationshipContact({
    id: `whatsapp-${contact.id}`, role: 'Contato WhatsApp', source: 'Multiatendimento',
    name: contact.name, phone: first(contact.whatsapp, contact.phone), contactId: contact.id,
  });
  for (const equipment of customer.equipments) {
    const localContact = first(rawValue(equipment, 'contact', 'contato'));
    const localPhone = first(equipment.phone, rawValue(equipment, 'fone'));
    if (localContact || localPhone) addRelationshipContact({
      id: `equipment-${equipment.id}`, role: first(equipment.sector, equipment.installLocation, 'Contato do equipamento'),
      source: 'Local de instalacao', name: localContact, phone: localPhone,
      equipmentExternalId: equipment.externalId,
    });
  }

  const supplyPattern = /\b(toner|cartucho|cilindro|fusor|fusao|fusão|revelador|unidade de imagem|peca|peça|kit)\b/gi;
  const equipmentEvolution = customer.equipments.map((equipment) => {
    const equipmentOrders = orders.filter((order) => (
      text(order.equipmentExternalId) === text(equipment.externalId)
      || (equipment.serialNumber && text(order.serialNumber) === text(equipment.serialNumber))
    ));
    const mentions = [];
    for (const order of equipmentOrders) {
      const description = [order.defect, order.closing].filter(Boolean).join(' | ');
      if (supplyPattern.test(description)) mentions.push({
        orderNumber: order.number || order.externalId,
        occurredAt: order.closedAt || order.attendedAt || order.openedAt,
        description,
      });
      supplyPattern.lastIndex = 0;
    }
    const equipmentMeters = meters.filter((meter) => text(meter.equipmentExternalId) === text(equipment.externalId));
    const closedEquipmentOrders = equipmentOrders.filter(isOrderClosedForAnalytics);
    return {
      equipmentExternalId: equipment.externalId,
      currentMeter: {
        pageCounter: equipment.pageCounter ?? null,
        usageCounters: equipment.usageCounters && typeof equipment.usageCounters === 'object' && !Array.isArray(equipment.usageCounters)
          ? equipment.usageCounters
          : {},
        readAt: equipment.lastMeterReadAt || null,
        source: equipment.meterSource || null,
      },
      meters: equipmentMeters,
      serviceOrderCount: equipmentOrders.length,
      lastMaintenance: closedEquipmentOrders[0] || null,
      technicalMentions: mentions.slice(0, 8),
    };
  });

  const activeTicket = tickets.find((ticket) => !['resolved', 'closed'].includes(String(ticket.status).toLowerCase())) || tickets[0] || null;
  const preferredContact = customer.whatsappContacts.find((contact) => contact.id === activeTicket?.contactId)
    || customer.whatsappContacts[0] || null;

  const alerts = [];
  if (canViewFinancial && overdueReceivables.length) alerts.push({
    id: 'overdue-receivables', severity: 'critical', category: 'financial',
    title: `${overdueReceivables.length} titulo(s) vencido(s)`,
    description: `Saldo vencido de ${overdueReceivables.reduce((total, item) => total + item.openValue, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
    count: overdueReceivables.length,
  });
  if (overdueOrders.length) alerts.push({
    id: 'overdue-orders', severity: 'critical', category: 'sla',
    title: `${overdueOrders.length} O.S. fora do prazo`,
    description: `Chamados abertos ha mais de ${slaTargetHours} horas.`, count: overdueOrders.length,
  });
  if (recurringEquipments.length) alerts.push({
    id: 'recurrence', severity: 'warning', category: 'recurrence',
    title: `${recurringEquipments.length} equipamento(s) com reincidencia`,
    description: 'Equipamentos com duas ou mais O.S. nos ultimos 90 dias.', count: recurringEquipments.length,
  });
  if (unlinkedEquipments.length) alerts.push({
    id: 'unlinked-equipments', severity: 'warning', category: 'contract',
    title: `${unlinkedEquipments.length} equipamento(s) sem contrato`,
    description: 'Equipamentos ativos sem vinculo de contrato identificado.', count: unlinkedEquipments.length,
  });
  if (expiringContracts.length) alerts.push({
    id: 'expiring-contracts', severity: 'info', category: 'contract',
    title: `${expiringContracts.length} contrato(s) proximo(s) do vencimento`,
    description: 'Vencimento previsto nos proximos 90 dias.', count: expiringContracts.length,
  });
  if (missingFields.length) alerts.push({
    id: 'incomplete-registration', severity: 'info', category: 'registration',
    title: 'Cadastro incompleto',
    description: `Campos ausentes: ${missingFields.join(', ')}.`, count: missingFields.length,
  });

  res.json({
    generatedAt: new Date().toISOString(),
    sync: syncMetadata(settings),
    capabilities,
    sla: {
      targetHours: slaTargetHours,
      orders30Days: orders.filter((order) => orderOpenedTimestamp(order) >= now - 30 * 86400000).length,
      orders90Days: orders.filter((order) => orderOpenedTimestamp(order) >= now - 90 * 86400000).length,
      orders365Days: orders.filter((order) => orderOpenedTimestamp(order) >= now - 365 * 86400000).length,
      averageResolutionHours: resolutionHours.length
        ? Math.round((resolutionHours.reduce((total, hours) => total + hours, 0) / resolutionHours.length) * 10) / 10
        : null,
      withinSlaPercent: resolutionHours.length ? Math.round((withinSla / resolutionHours.length) * 100) : null,
      openOrders: openOrders.length,
      overdueOpenOrders: overdueOrders.length,
      recurringEquipments,
      mostRecurringEquipment: recurringEquipments[0] || null,
    },
    units: buildCustomerUnits(customer),
    contacts: relationshipContacts,
    quickActions: {
      ticketId: activeTicket?.id || null,
      contactId: preferredContact?.id || null,
      phone: first(preferredContact?.whatsapp, preferredContact?.phone, customer.phone),
      address: [customer.address, customer.neighborhood, customer.city, customer.state].filter(Boolean).join(', '),
      canOpenConversation: Boolean(capabilities.actions.openConversation && activeTicket?.id),
      canOpenServiceOrder: Boolean(capabilities.actions.createServiceOrder && activeTicket?.id && preferredContact?.id),
    },
    financial: canViewFinancial ? {
      allowed: true,
      synchronized: receivables.length > 0,
      totalOpen: openReceivables.reduce((total, item) => total + item.openValue, 0),
      overdueAmount: overdueReceivables.reduce((total, item) => total + item.openValue, 0),
      overdueCount: overdueReceivables.length,
      nextReceivable,
      lastPayment,
      items: receivables,
    } : { allowed: false, reason: 'Usuario sem permissao para visualizar informacoes financeiras.' },
    equipmentEvolution,
    alerts,
  });
}

async function getReceivableBoleto(req, res) {
  const tenantId = req.user.tenantId;
  if (!hasPermission(req.user, 'crm.financial.view')) {
    return res.status(403).json({ error: 'Informacoes financeiras disponiveis apenas para administradores.' });
  }

  const customer = await prisma.crmCustomer.findFirst({
    where: { id: req.params.id, tenantId },
    select: { externalId: true, name: true, fantasyName: true },
  });
  if (!customer) return res.status(404).json({ error: 'Cliente CRM nao encontrado.' });

  const receivable = await prisma.externalSyncRecord.findFirst({
    where: {
      tenantId,
      source: 'firebird',
      entity: 'receivables',
      externalId: String(req.params.receivableId),
    },
    select: { externalId: true, payload: true },
  });
  if (!receivable) return res.status(404).json({ error: 'Titulo financeiro nao encontrado.' });

  const normalized = normalizeReceivable(receivable);
  if (text(normalized.clientExternalId) !== text(customer.externalId)) {
    return res.status(404).json({ error: 'Titulo financeiro nao pertence a este cliente.' });
  }
  if (normalized.isCancelled) {
    return res.status(410).json({ error: 'Este titulo foi cancelado ou removido no iLux.' });
  }
  if (!normalized.hasBoleto) {
    return res.status(409).json({ error: 'Este titulo nao possui boleto vinculado no iLux.' });
  }

  const requestExternalId = String(receivable.externalId);
  const request = await prisma.externalSyncRecord.upsert({
    where: {
      tenantId_source_entity_externalId: {
        tenantId,
        source: 'crm',
        entity: 'billingPdfRequest',
        externalId: requestExternalId,
      },
    },
    update: {
      payload: {
        status: 'pending',
        requestedAt: new Date().toISOString(),
        receivableExternalId: requestExternalId,
        invoiceNumber: normalized.invoiceNumber,
        customerName: customer.fantasyName || customer.name,
      },
    },
    create: {
      tenantId,
      source: 'crm',
      entity: 'billingPdfRequest',
      externalId: requestExternalId,
      payload: {
        status: 'pending',
        requestedAt: new Date().toISOString(),
        receivableExternalId: requestExternalId,
        invoiceNumber: normalized.invoiceNumber,
        customerName: customer.fantasyName || customer.name,
      },
    },
    select: { id: true },
  });

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const current = await prisma.externalSyncRecord.findUnique({
      where: { id: request.id },
      select: { payload: true },
    });
    const status = current?.payload?.status;
    if (status === 'success') {
      return res.json({
        mediaUrl: current.payload.mediaUrl,
        fileName: current.payload.fileName,
      });
    }
    if (status === 'failed') {
      return res.status(502).json({ error: current.payload.error || 'Nao foi possivel recuperar o boleto.' });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return res.status(504).json({
    error: 'O agente do iLux nao devolveu o boleto no tempo esperado. Confirme se ele esta atualizado e em execucao.',
  });
}

function canViewFinancial(user) {
  return ['admin', 'superadmin'].includes(String(user?.role || '').toLowerCase());
}

async function resolveCustomerReceivable(req) {
  const tenantId = req.user.tenantId;
  if (!canViewFinancial(req.user)) {
    const error = new Error('Informacoes financeiras disponiveis apenas para administradores.');
    error.statusCode = 403;
    throw error;
  }

  const customer = await prisma.crmCustomer.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, externalId: true, name: true, fantasyName: true, cpfCnpj: true },
  });
  if (!customer) {
    const error = new Error('Cliente CRM nao encontrado.');
    error.statusCode = 404;
    throw error;
  }

  const record = await prisma.externalSyncRecord.findFirst({
    where: {
      tenantId,
      source: 'firebird',
      entity: 'receivables',
      externalId: String(req.params.receivableId),
    },
    select: { externalId: true, payload: true },
  });
  if (!record) {
    const error = new Error('Titulo financeiro nao encontrado.');
    error.statusCode = 404;
    throw error;
  }
  const receivable = normalizeReceivable(record);
  if (text(receivable.clientExternalId) !== text(customer.externalId)) {
    const error = new Error('Titulo financeiro nao pertence a este cliente.');
    error.statusCode = 404;
    throw error;
  }
  if (receivable.isCancelled) {
    const error = new Error('Este titulo foi cancelado ou removido no iLux e nao pode ser aberto ou reenviado.');
    error.statusCode = 410;
    throw error;
  }
  return { tenantId, customer, receivable };
}

function sendFinancialError(res, error) {
  const status = error.statusCode || error.response?.status || 500;
  if (status >= 500) console.error('[crm-financial-documents] erro:', error.message);
  return res.status(status).json({ error: error.message || 'Erro ao processar documentos financeiros.' });
}

async function getReceivableDocuments(req, res) {
  try {
    const context = await resolveCustomerReceivable(req);
    const customerName = context.customer.fantasyName || context.customer.name;
    const [documents, delivery] = await Promise.all([
      billingDocuments.listDocumentStates({
        tenantId: context.tenantId,
        receivable: context.receivable,
        customerName,
      }),
      billingDocuments.resolveDelivery({
        tenantId: context.tenantId,
        customerId: context.customer.id,
        ticketId: req.query.ticketId || null,
      }),
    ]);

    // Pré-aquecimento: assim que o gestor abre o título (antes mesmo de
    // clicar em "abrir"/"reenviar"), já manda o agente do iLux começar a
    // gerar a NF/Demonstrativo em segundo plano. Sem isso, o clique era o
    // próprio gatilho e o cliente esperava o ciclo completo do agente
    // (fila de long-poll + geração no ERP), o que podia levar quase 1 min.
    // Não bloqueia a resposta, não re-tenta documentos que já falharam ou
    // já estão em andamento (só os ainda nunca solicitados).
    const documentsToPrewarm = documents.filter((doc) => doc.status === 'available' && ['invoice', 'statement'].includes(doc.type));
    if (documentsToPrewarm.length) {
      Promise.all(documentsToPrewarm.map((doc) => billingDocuments.queueDocumentRequest({
        tenantId: context.tenantId,
        receivable: context.receivable,
        customerName,
        documentType: doc.type,
      }))).catch((err) => console.error('[crm-financial-documents] falha ao pre-aquecer documento:', err.message));
    }

    return res.json({
      receivable: {
        externalId: context.receivable.externalId,
        invoiceNumber: context.receivable.invoiceNumber,
        invoiceExternalId: context.receivable.invoiceExternalId,
        statementExternalId: context.receivable.statementExternalId,
        issuedAt: context.receivable.issuedAt,
        billingPeriod: context.receivable.billingPeriod,
        billingType: context.receivable.billingType,
        paymentMethod: context.receivable.paymentMethod,
        dueAt: context.receivable.dueAt,
        value: context.receivable.value,
        openValue: context.receivable.openValue,
        status: context.receivable.status,
      },
      documents,
      delivery: delivery || { available: false },
    });
  } catch (error) {
    return sendFinancialError(res, error);
  }
}

async function getReceivableDocument(req, res) {
  try {
    const context = await resolveCustomerReceivable(req);
    const document = await billingDocuments.getOrRequestDocument({
      tenantId: context.tenantId,
      receivable: context.receivable,
      customerName: context.customer.fantasyName || context.customer.name,
      documentType: String(req.params.documentType || '').toLowerCase(),
    });
    return res.json(document);
  } catch (error) {
    return sendFinancialError(res, error);
  }
}

async function sendReceivableDocuments(req, res) {
  try {
    const context = await resolveCustomerReceivable(req);
    const result = await billingDocuments.sendDocuments({
      ...context,
      userId: req.user.userId || req.user.id || null,
      documentTypes: req.body?.documentTypes,
      ticketId: req.body?.ticketId || null,
    });
    return res.json(result);
  } catch (error) {
    return sendFinancialError(res, error);
  }
}

async function listFlaggedBillingDocuments(req, res) {
  try {
    const tenantId = req.user.tenantId;
    if (!canViewFinancial(req.user)) {
      const error = new Error('Informacoes financeiras disponiveis apenas para administradores.');
      error.statusCode = 403;
      throw error;
    }

    // Reactive by design: this reuses the same request log every document click
    // already writes (billingDocumentService.completeDocumentRequest), so a
    // failed/ambiguous lookup is never lost, and a successful retry clears it
    // automatically - no separate "resolved" bookkeeping to keep in sync.
    const failedRequests = await prisma.externalSyncRecord.findMany({
      where: {
        tenantId,
        source: 'crm',
        entity: billingDocuments.REQUEST_ENTITY,
        payload: { path: ['status'], equals: 'failed' },
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
      select: { id: true, payload: true },
    });
    if (!failedRequests.length) return res.json({ items: [] });

    const receivableIds = [...new Set(
      failedRequests.map((record) => text(record.payload?.receivableExternalId)).filter(Boolean),
    )];
    const receivableRecords = receivableIds.length ? await prisma.externalSyncRecord.findMany({
      where: { tenantId, source: 'firebird', entity: 'receivables', externalId: { in: receivableIds } },
      select: { externalId: true, payload: true },
    }) : [];
    const receivableByExternalId = new Map(receivableRecords.map((record) => [record.externalId, normalizeReceivable(record)]));

    const clientExternalIds = [...new Set(
      [...receivableByExternalId.values()].map((item) => text(item.clientExternalId)).filter(Boolean),
    )];
    const customers = clientExternalIds.length ? await prisma.crmCustomer.findMany({
      where: { tenantId, externalId: { in: clientExternalIds } },
      select: { id: true, externalId: true, name: true, fantasyName: true },
    }) : [];
    const customerByExternalId = new Map(customers.map((customer) => [text(customer.externalId), customer]));

    const items = failedRequests.map((record) => {
      const payload = record.payload || {};
      const receivableExternalId = text(payload.receivableExternalId);
      const receivable = receivableExternalId ? receivableByExternalId.get(receivableExternalId) : null;
      const customer = receivable ? customerByExternalId.get(text(receivable.clientExternalId)) : null;
      return {
        id: record.id,
        documentType: payload.documentType || null,
        invoiceNumber: payload.invoiceNumber || receivable?.invoiceNumber || null,
        receivableExternalId,
        error: payload.error || null,
        requestedAt: payload.requestedAt || null,
        completedAt: payload.completedAt || null,
        customerId: customer?.id || null,
        customerName: customer?.fantasyName || customer?.name || payload.customerName || 'Cliente não identificado',
      };
    }).filter((item) => {
      const receivable = item.receivableExternalId ? receivableByExternalId.get(item.receivableExternalId) : null;
      return !receivable?.isCancelled;
    });

    return res.json({ items });
  } catch (error) {
    return sendFinancialError(res, error);
  }
}

function isOrderClosedForAnalytics(order) {
  return isServiceOrderClosed(order);
}

async function listEquipments(req, res) {
  const tenantId = req.user.tenantId;
  const q = String(req.query.q || '').trim();
  const take = Math.min(Number(req.query.limit || 100) || 100, 250);

  const where = { tenantId };
  if (q) {
    where.OR = [
      { externalId: { contains: q, mode: 'insensitive' } },
      { model: { contains: q, mode: 'insensitive' } },
      { manufacturer: { contains: q, mode: 'insensitive' } },
      { serialNumber: { contains: q, mode: 'insensitive' } },
      { assetTag: { contains: q, mode: 'insensitive' } },
      { sector: { contains: q, mode: 'insensitive' } },
      { installLocation: { contains: q, mode: 'insensitive' } },
      { address: { contains: q, mode: 'insensitive' } },
      { city: { contains: q, mode: 'insensitive' } },
      { contractExternalId: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      { customer: { fantasyName: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const equipments = await prisma.crmEquipment.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take,
    include: {
      customer: {
        select: { id: true, externalId: true, name: true, fantasyName: true, cpfCnpj: true, phone: true },
      },
    },
  });

  res.json(equipments);
}

module.exports = {
  getSummary,
  listCustomers,
  exportCustomers,
  getCustomer,
  getCustomerContracts,
  getCustomerServiceOrders,
  getCustomer360,
  getReceivableBoleto,
  getReceivableDocuments,
  getReceivableDocument,
  sendReceivableDocuments,
  listFlaggedBillingDocuments,
  listEquipments,
  loadContracts,
  loadCustomerOrders,
  loadCustomerOrderCatalog,
  findTenantCustomer,
  parseHistoryPagination,
  paginateServiceOrders,
  getCrmCapabilities,
  syncMetadata,
  parseCustomerListOptions,
  queryCustomers,
  normalizeReceivable,
  receivableIsCancelled,
};
