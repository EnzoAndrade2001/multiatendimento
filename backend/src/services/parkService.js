const prisma = require('../lib/prisma');
const parkMetrics = require('./parkMetricsService');
const printGuard = require('./printGuardService');

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_TONER_RE = /toner|supply|cartucho|insumo|cilindro|drum|maintenance/i;
const HARDWARE_RE = /error|erro|jam|atol|hardware|fusor|falha|offline|stopped|parou/i;
const CLOSED_OS_RE = /^(FINALIZADA|FECHADA|CONCLUIDA|CANCELADA|C|F)$/i;

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function severityRank(value) {
  const v = String(value || '').toUpperCase();
  return v === 'CRITICAL' ? 4 : v === 'HIGH' ? 3 : v === 'WARNING' || v === 'MEDIUM' ? 2 : v === 'LOW' ? 1 : 0;
}

function healthBucket(score) {
  if (score == null) return 'unknown';
  if (score >= 75) return 'ok';
  if (score >= 50) return 'warn';
  return 'bad';
}

// Score 0-100 a partir de chamados recentes, idade do evento e estado do equipamento.
function computeHealth({ callCount90d, ageMinutes, equipmentActive }) {
  let score = 100;
  score -= Math.min(60, (callCount90d || 0) * 9);
  if (Number.isFinite(ageMinutes)) score -= Math.min(20, Math.floor(ageMinutes / (60 * 24)) * 3);
  if (equipmentActive === false) score -= 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function tonerLevelFromPayload(payload) {
  const p = obj(payload);
  // Percentual (0-100). Escala 0-8 do coletor, quando existir, e normalizada
  // na camada de ingestao — aqui nao adivinhamos a partir de um numero solto.
  const candidates = [p.levelPct, p.percent, p.level, p.toner?.overall, p.toner?.level, p.supplyLevel, p.measurement?.level];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
  }
  return null;
}

// Rotulo curto da leitura para o card: "level 3 · cyan · threshold 20" para
// toner; para hardware/erro usa a mensagem do coletor.
function readingLabel(payload, isLowToner) {
  const p = obj(payload);
  if (isLowToner) {
    const parts = [];
    const lvl = p.level ?? p.toner?.level ?? p.levelPct ?? p.percent;
    if (lvl != null && lvl !== '') parts.push(`nível ${lvl}`);
    const color = p.color || p.supply || p.consumable || p.toner?.color;
    if (color) parts.push(String(color));
    const thr = p.threshold ?? p.limit ?? p.min;
    if (thr != null && thr !== '') parts.push(`limite ${thr}`);
    if (parts.length) return parts.join(' · ');
  }
  return String(p.message || p.description || p.error || p.errorMessage || '').slice(0, 200) || null;
}

function pickOsType(types, eventType) {
  if (!types.length) return null;
  const lower = String(eventType || '').toLowerCase();
  const wanted = LOW_TONER_RE.test(lower)
    ? /suprim|toner|insum|cilindr|entrega|remessa/i
    : HARDWARE_RE.test(lower)
      ? /tecnic|corretiv|manuten|reparo|assist/i
      : null;
  if (wanted) {
    const hit = types.find((t) => wanted.test(`${t.code} ${t.name || ''} ${t.description || ''}`));
    if (hit) return hit;
  }
  return null;
}

function priorityForIncident({ severity, mappingState, isHardware, isLowToner, tonerDaysLeft, state, monitoringUntil, hasOpenServiceOrder, ageMinutes }) {
  let score = severityRank(severity) * 18;
  const reasons = [];
  const monitorDeadline = monitoringUntil ? new Date(monitoringUntil) : null;
  const monitoringExpired = state === 'MONITORING' && monitorDeadline && monitorDeadline.getTime() <= Date.now();
  if (mappingState !== 'MATCHED') { score += 28; reasons.push('Vínculo impede a decisão operacional'); }
  if (isHardware && severityRank(severity) >= 3) { score += 24; reasons.push('Possível parada do equipamento'); }
  if (isLowToner && Number.isFinite(tonerDaysLeft)) {
    if (tonerDaysLeft <= 1) { score += 35; reasons.push('Insumo previsto para acabar em até 1 dia'); }
    else if (tonerDaysLeft <= 3) { score += 25; reasons.push('Insumo previsto para acabar em até 3 dias'); }
    else if (tonerDaysLeft <= 7) { score += 12; reasons.push('Reposição recomendada nesta semana'); }
  }
  if (Number(ageMinutes) >= 24 * 60) { score += 8; reasons.push('Decisão pendente há mais de 24 horas'); }
  if (monitoringExpired) { score += 20; reasons.push('Prazo de monitoramento expirou'); }
  if (hasOpenServiceOrder) { score -= 35; reasons.push('Já existe O.S. aberta para o equipamento'); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 75 ? 'P1' : score >= 50 ? 'P2' : score >= 25 ? 'P3' : 'P4';
  return { level, score, reasons, monitoringExpired: Boolean(monitoringExpired) };
}

function recommendationForIncident(incident) {
  const openOrder = incident.openServiceOrder;
  if (incident.mappingState !== 'MATCHED') {
    return { action: 'FIX_BINDING', label: 'Corrigir vínculo', explanation: 'O alerta não pode gerar uma O.S. segura enquanto cliente e equipamento não forem confirmados.', confidence: 'high' };
  }
  if (openOrder) {
    return { action: 'VIEW_SERVICE_ORDER', label: 'Ver O.S. existente', explanation: `A O.S. ${openOrder.number || openOrder.id} já atende este equipamento; evite abertura duplicada.`, confidence: 'high' };
  }
  if (incident.isHardware && severityRank(incident.severity) >= 3) {
    return { action: 'OPEN_SERVICE_ORDER', label: 'Abrir O.S. agora', explanation: 'Falha crítica com risco de parada do equipamento.', confidence: 'high' };
  }
  if (incident.isLowToner && Number.isFinite(incident.toner?.daysLeft) && incident.toner.daysLeft <= 3) {
    return { action: 'OPEN_SERVICE_ORDER', label: 'Abrir O.S. de suprimento', explanation: `Previsão de término em aproximadamente ${Math.max(0, Math.ceil(incident.toner.daysLeft))} dia(s).`, confidence: incident.trend?.reliable ? 'high' : 'medium' };
  }
  if (incident.state === 'MONITORING') {
    return { action: 'KEEP_MONITORING', label: 'Manter monitoramento', explanation: incident.monitoringCondition || 'Acompanhar a próxima leitura antes de abrir uma O.S.', confidence: 'medium' };
  }
  return { action: 'MONITOR', label: 'Monitorar com prazo', explanation: 'Não há evidência suficiente para abertura imediata; defina prazo e condição de escalonamento.', confidence: incident.trend?.points >= 2 ? 'medium' : 'low' };
}

// ---------------------------------------------------------------------------

async function loadDecisionEvents(tenantId, { windowHours = 72, states = ['RECEIVED', 'MONITORING', 'ERROR'] } = {}) {
  const since = new Date(Date.now() - Math.min(720, Math.max(1, windowHours)) * 60 * 60 * 1000);
  const events = await prisma.printGuardTelemetryEvent.findMany({
    where: { tenantId, createdAt: { gte: since }, state: { in: states } },
    select: {
      id: true, eventType: true, severity: true, occurredAt: true, createdAt: true, state: true,
      customerCode: true, serialNumber: true, payload: true, bindingId: true, errorCode: true,
      errorMessage: true, ticketId: true, serviceOrderId: true,
      assignedToId: true, decisionDueAt: true, monitoringUntil: true, monitoringCondition: true,
      nextStep: true, ignoredReason: true, decisionAt: true, decisionById: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
  });
  return events;
}

async function enrichEvents(tenantId, events) {
  const bindingIds = [...new Set(events.map((e) => e.bindingId).filter(Boolean))];
  const bindings = bindingIds.length
    ? await prisma.printGuardBinding.findMany({ where: { tenantId, id: { in: bindingIds } } })
    : [];
  const bindingById = new Map(bindings.map((b) => [b.id, b]));

  const customerIds = [...new Set(bindings.map((b) => b.customerId).filter(Boolean))];
  const equipmentIds = [...new Set(bindings.map((b) => b.equipmentId).filter(Boolean))];
  const assigneeIds = [...new Set(events.map((e) => e.assignedToId).filter(Boolean))];
  const [customers, crmEquipments, osTypes, assignees] = await Promise.all([
    customerIds.length ? prisma.crmCustomer.findMany({
      where: { tenantId, id: { in: customerIds } },
      select: { id: true, name: true, externalId: true, phone: true, address: true, neighborhood: true, city: true, state: true },
    }) : [],
    equipmentIds.length ? prisma.crmEquipment.findMany({
      where: { tenantId, id: { in: equipmentIds } },
      select: {
        id: true, model: true, manufacturer: true, serialNumber: true, externalId: true, sector: true,
        isActive: true, contractExternalId: true, pageCounter: true, lastMeterReadAt: true, customerId: true,
      },
    }) : [],
    prisma.crmOsType.findMany({ where: { tenantId }, select: { code: true, name: true, description: true } }).catch(() => []),
    assigneeIds.length ? prisma.user.findMany({ where: { tenantId, id: { in: assigneeIds }, active: true }, select: { id: true, name: true } }) : [],
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const crmEqById = new Map(crmEquipments.map((e) => [e.id, e]));
  const assigneeById = new Map(assignees.map((u) => [u.id, u]));

  // O.S. locais por equipamento (para contagem de 90 dias) — resolvidas por externalId.
  const eqExternalIds = [...new Set(crmEquipments.map((e) => e.externalId).filter(Boolean))];
  const localEquipments = eqExternalIds.length
    ? await prisma.equipment.findMany({
      where: { tenantId, externalSource: 'firebird', externalId: { in: eqExternalIds } },
      select: { id: true, externalId: true },
    })
    : [];
  const localEqByExternal = new Map(localEquipments.map((e) => [e.externalId, e]));
  const since90 = new Date(Date.now() - 90 * DAY_MS);
  const callCounts = localEquipments.length
    ? await prisma.serviceOrder.groupBy({
      by: ['equipmentId'],
      where: { tenantId, equipmentId: { in: localEquipments.map((e) => e.id) }, createdAt: { gte: since90 } },
      _count: { _all: true },
    })
    : [];
  const callCountByLocalId = new Map(callCounts.map((row) => [row.equipmentId, row._count._all]));
  const activeOrders = localEquipments.length
    ? await prisma.serviceOrder.findMany({
      where: {
        tenantId,
        equipmentId: { in: localEquipments.map((e) => e.id) },
        closedAt: null,
        resolvedAt: null,
      },
      select: { id: true, externalId: true, equipmentId: true, status: true, cdOstp: true, defect: true, createdAt: true, ticketId: true },
      orderBy: { createdAt: 'desc' },
    })
    : [];
  const openOrdersByEquipment = new Map();
  for (const order of activeOrders) {
    if (CLOSED_OS_RE.test(String(order.status || ''))) continue;
    if (!openOrdersByEquipment.has(order.equipmentId)) openOrdersByEquipment.set(order.equipmentId, []);
    openOrdersByEquipment.get(order.equipmentId).push(order);
  }

  const incidents = [];
  for (const event of events) {
    const binding = bindingById.get(event.bindingId);
    const payload = obj(event.payload);
    const customer = customerById.get(binding?.customerId) || null;
    const crmEq = crmEqById.get(binding?.equipmentId) || null;
    const mappingState = binding?.state || (event.state === 'ERROR' ? event.errorCode : null) || 'UNMATCHED';
    const signalAt = event.occurredAt || event.createdAt;
    const ageMinutes = signalAt ? Math.max(0, Math.floor((Date.now() - new Date(signalAt).getTime()) / 60000)) : null;
    const eventType = String(event.eventType || 'telemetry');

    const localEq = crmEq?.externalId ? localEqByExternal.get(crmEq.externalId) : null;
    const callCount90d = localEq ? (callCountByLocalId.get(localEq.id) || 0) : 0;
    const healthScore = crmEq ? computeHealth({ callCount90d, ageMinutes, equipmentActive: crmEq.isActive }) : null;
    const tonerLevelPct = LOW_TONER_RE.test(eventType) ? tonerLevelFromPayload(payload) : null;

    let insight = null;
    if (crmEq?.externalId) {
      insight = await parkMetrics.equipmentInsight(tenantId, {
        equipmentExternalId: crmEq.externalId,
        contractExternalId: crmEq.contractExternalId,
        tonerLevelPct,
        producedThisCycle: Number(payload.producedThisCycle ?? payload.qtproducao) || null,
      });
    }
    const suggested = pickOsType(osTypes, eventType);
    const equipmentOpenOrders = localEq ? (openOrdersByEquipment.get(localEq.id) || []) : [];
    const openOrder = equipmentOpenOrders[0] || null;

    const incident = {
      id: event.id,
      externalEventId: undefined,
      eventType,
      severity: String(event.severity || 'INFO').toUpperCase(),
      state: event.state,
      occurredAt: signalAt,
      receivedAt: event.createdAt,
      ageMinutes,
      mappingState,
      canOpenServiceOrder: mappingState === 'MATCHED' && crmEq?.isActive !== false,
      isLowToner: LOW_TONER_RE.test(eventType),
      isHardware: HARDWARE_RE.test(eventType),
      customer: customer && {
        id: customer.id,
        name: customer.name,
        externalId: customer.externalId,
        phone: customer.phone || null,
        address: [customer.address, customer.neighborhood, customer.city, customer.state].filter(Boolean).join(', ') || null,
      },
      customerName: customer?.name || event.customerCode || 'Cliente nao identificado',
      equipment: crmEq && {
        id: crmEq.id,
        model: crmEq.model,
        manufacturer: crmEq.manufacturer,
        serialNumber: crmEq.serialNumber,
        externalId: crmEq.externalId,
        sector: crmEq.sector,
        isActive: crmEq.isActive,
        pageCounter: crmEq.pageCounter ?? null,
        lastMeterReadAt: crmEq.lastMeterReadAt,
        localEquipmentId: localEq?.id || null,
      },
      serialNumber: crmEq?.serialNumber || event.serialNumber || null,
      measurement: readingLabel({ ...payload, errorMessage: event.errorMessage }, LOW_TONER_RE.test(eventType)),
      health: { score: healthScore, bucket: healthBucket(healthScore), callCount90d },
      healthScore,
      callCount90d,
      toner: { levelPct: tonerLevelPct, daysLeft: insight?.toner?.daysLeft ?? null },
      trend: insight?.trend || null,
      contract: insight?.contract || null,
      franchise: insight?.franchise || null,
      suggestedOsType: suggested ? { code: suggested.code, name: suggested.name } : null,
      workflow: {
        assignedTo: event.assignedToId ? { id: event.assignedToId, name: assigneeById.get(event.assignedToId)?.name || null } : null,
        decisionDueAt: event.decisionDueAt,
        monitoringUntil: event.monitoringUntil,
        monitoringCondition: event.monitoringCondition,
        nextStep: event.nextStep,
        decisionAt: event.decisionAt,
        decisionById: event.decisionById,
      },
      openServiceOrder: openOrder && {
        id: openOrder.id,
        number: openOrder.externalId,
        status: openOrder.status,
        typeCode: openOrder.cdOstp,
        defect: openOrder.defect,
        createdAt: openOrder.createdAt,
        ticketId: openOrder.ticketId,
      },
      openServiceOrders: equipmentOpenOrders.slice(0, 6).map((o) => ({
        id: o.id,
        number: o.externalId,
        status: o.status,
        typeCode: o.cdOstp,
        defect: o.defect,
        createdAt: o.createdAt,
        ticketId: o.ticketId,
      })),
    };
    const priority = priorityForIncident({
      severity: incident.severity,
      mappingState,
      isHardware: incident.isHardware,
      isLowToner: incident.isLowToner,
      tonerDaysLeft: incident.toner.daysLeft,
      state: incident.state,
      monitoringUntil: event.monitoringUntil,
      hasOpenServiceOrder: Boolean(openOrder),
      ageMinutes,
    });
    incident.priority = priority;
    incident.recommendation = recommendationForIncident(incident);
    // Abrir O.S. continua permitido mesmo com O.S. em aberto — o frontend avisa
    // e o atendente decide entre revisar as abertas ou abrir outra.
    incidents.push(incident);
  }

  incidents.sort((a, b) => {
    const d = (b.priority?.score || 0) - (a.priority?.score || 0);
    if (d !== 0) return d;
    return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  });
  return incidents;
}

async function parkQueue(tenantId, query = {}) {
  const events = await loadDecisionEvents(tenantId, { windowHours: Number(query.windowHours) || 72 });
  let incidents = await enrichEvents(tenantId, events);

  if (query.severity) {
    const want = String(query.severity).toUpperCase();
    incidents = incidents.filter((i) => i.severity === want);
  }
  if (query.state) {
    const want = String(query.state).toUpperCase();
    incidents = incidents.filter((i) => i.state === want);
  }
  if (query.type) {
    const kind = String(query.type).toLowerCase();
    incidents = incidents.filter((i) => (kind === 'toner' ? i.isLowToner : kind === 'hardware' ? i.isHardware : true));
  }
  if (query.q) {
    const q = String(query.q).toLowerCase();
    incidents = incidents.filter((i) => `${i.customerName} ${i.serialNumber || ''} ${i.eventType}`.toLowerCase().includes(q));
  }

  const summary = {
    total: incidents.length,
    critical: incidents.filter((i) => severityRank(i.severity) >= 3).length,
    awaitingDecision: incidents.filter((i) => i.state === 'RECEIVED').length,
    monitoring: incidents.filter((i) => i.state === 'MONITORING').length,
    unlinked: incidents.filter((i) => i.mappingState !== 'MATCHED').length,
    lowToner: incidents.filter((i) => i.isLowToner).length,
    stopped: incidents.filter((i) => i.isHardware && severityRank(i.severity) >= 3).length,
    affectedEquipment: new Set(incidents.map((i) => i.serialNumber).filter(Boolean)).size,
    overageValue: incidents.reduce((sum, i) => sum + (i.franchise?.overValue || 0), 0),
    actionNow: incidents.filter((i) => i.priority.level === 'P1' && !i.openServiceOrder).length,
    riskWithin3Days: incidents.filter((i) => Number.isFinite(i.toner?.daysLeft) && i.toner.daysLeft <= 3).length,
    overdueDecisions: incidents.filter((i) => {
      const due = i.workflow?.decisionDueAt || i.workflow?.monitoringUntil;
      return due && new Date(due).getTime() <= Date.now() && !i.openServiceOrder;
    }).length,
    openServiceOrders: incidents.filter((i) => i.openServiceOrder).length,
  };

  const replenishmentMap = new Map();
  for (const incident of incidents.filter((item) => item.isLowToner && item.customer?.id)) {
    const key = incident.customer.id;
    const group = replenishmentMap.get(key) || {
      customer: incident.customer,
      items: [],
      urgent: 0,
      monitoring: 0,
      withOpenServiceOrder: 0,
    };
    group.items.push({
      eventId: incident.id,
      equipment: incident.equipment,
      serialNumber: incident.serialNumber,
      measurement: incident.measurement,
      toner: incident.toner,
      priority: incident.priority,
      recommendation: incident.recommendation,
      openServiceOrder: incident.openServiceOrder,
    });
    if (incident.priority.level === 'P1' || incident.priority.level === 'P2') group.urgent += 1;
    if (incident.state === 'MONITORING') group.monitoring += 1;
    if (incident.openServiceOrder) group.withOpenServiceOrder += 1;
    replenishmentMap.set(key, group);
  }
  const replenishment = [...replenishmentMap.values()]
    .map((group) => ({ ...group, total: group.items.length, eventIds: group.items.map((item) => item.eventId) }))
    .sort((a, b) => b.urgent - a.urgent || b.total - a.total);

  const limit = Math.max(1, Math.min(Number(query.limit) || 60, 200));
  return { incidents: incidents.slice(0, limit), summary, replenishment, truncated: incidents.length > limit };
}

function parseOptionalDate(value, field, { future = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { const e = new Error(`${field} invalido.`); e.statusCode = 400; throw e; }
  if (future && date.getTime() <= Date.now()) { const e = new Error(`${field} deve estar no futuro.`); e.statusCode = 400; throw e; }
  return date;
}

function fmtDueDate(value) {
  if (!value) return 'sem prazo';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'sem prazo';
  return d.toLocaleString('pt-BR', { timeZone: process.env.APP_TIMEZONE || 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

async function updateDecisionWorkflow(tenantId, eventId, input = {}, actorId = null) {
  const event = await prisma.printGuardTelemetryEvent.findFirst({ where: { tenantId, id: eventId } });
  if (!event) { const e = new Error('Evento nao encontrado.'); e.statusCode = 404; throw e; }
  const assignedToId = input.assignedToId === '' ? null : (input.assignedToId ?? event.assignedToId);
  if (assignedToId) {
    const user = await prisma.user.findFirst({ where: { tenantId, id: assignedToId, active: true }, select: { id: true } });
    if (!user) { const e = new Error('Responsavel nao pertence a esta empresa ou esta inativo.'); e.statusCode = 400; throw e; }
  }
  const data = {
    assignedToId,
    decisionById: actorId || event.decisionById,
    decisionAt: new Date(),
  };
  if (Object.prototype.hasOwnProperty.call(input, 'decisionDueAt')) data.decisionDueAt = parseOptionalDate(input.decisionDueAt, 'Prazo da decisao');
  if (Object.prototype.hasOwnProperty.call(input, 'nextStep')) data.nextStep = String(input.nextStep || '').trim().slice(0, 2000) || null;
  const updated = await prisma.printGuardTelemetryEvent.update({ where: { id: event.id }, data });

  // Notifica o novo responsavel pelo chat interno (toast em tempo real +
  // contador de nao lidas). Best-effort: nunca derruba a atribuicao.
  const isNewAssignee = assignedToId && actorId && assignedToId !== actorId && assignedToId !== event.assignedToId;
  if (isNewAssignee) {
    const ctx = obj(input.context);
    const lines = [
      '🖨️ Você foi designado para decidir sobre um alerta do *Saúde do Parque*.',
      '',
      `Cliente: ${ctx.customer || 'não identificado'}`,
      `Equipamento: ${ctx.equipment || 'não identificado'}`,
      `Alerta: ${ctx.eventType || event.eventType || 'telemetria'}${ctx.priority ? ` · ${ctx.priority}` : ''}`,
      ctx.recommendation ? `Recomendação do sistema: ${ctx.recommendation}` : null,
      `Prazo da decisão: ${fmtDueDate(updated.decisionDueAt)}`,
      updated.nextStep ? `Próximo passo: ${updated.nextStep}` : null,
      '',
      'Abra Sentinela › Saúde do Parque › Fila de decisão para agir.',
    ].filter((line) => line !== null);
    const internal = require('../controllers/internalMessageController');
    await internal.notifyUser({ tenantId, fromUserId: actorId, toUserId: assignedToId, body: lines.join('\n') });
  }
  return updated;
}

async function bindingCandidates(tenantId, eventId, query = {}) {
  const event = await prisma.printGuardTelemetryEvent.findFirst({ where: { tenantId, id: eventId } });
  if (!event) { const e = new Error('Evento nao encontrado.'); e.statusCode = 404; throw e; }
  const binding = event.bindingId
    ? await prisma.printGuardBinding.findFirst({ where: { tenantId, id: event.bindingId } })
    : null;
  const payload = obj(event.payload);
  const q = String(query.q || '').trim();
  const customerCode = event.customerCode || binding?.customerCode;
  const customerWhere = q
    ? { tenantId, OR: [{ name: { contains: q, mode: 'insensitive' } }, { externalId: { contains: q, mode: 'insensitive' } }, { cpfCnpj: { contains: q, mode: 'insensitive' } }] }
    : { tenantId, ...(customerCode ? { externalId: customerCode } : {}) };
  let customers = await prisma.crmCustomer.findMany({
    where: customerWhere,
    select: { id: true, externalId: true, name: true, address: true, neighborhood: true, city: true, state: true },
    take: 20,
  });
  if (!customers.length && !q) customers = await prisma.crmCustomer.findMany({ where: { tenantId }, select: { id: true, externalId: true, name: true, address: true, neighborhood: true, city: true, state: true }, take: 20, orderBy: { name: 'asc' } });
  const customerIds = customers.map((customer) => customer.id);
  const serial = event.serialNumber || binding?.serialNumber;
  const modelHint = String(payload.model || payload.equipment?.model || '').trim();
  const equipments = await prisma.crmEquipment.findMany({
    where: {
      tenantId,
      OR: [
        ...(serial ? [{ serialNumber: { equals: serial, mode: 'insensitive' } }] : []),
        ...(customerIds.length ? [{ customerId: { in: customerIds } }] : []),
        ...(q ? [{ model: { contains: q, mode: 'insensitive' } }, { externalId: { contains: q, mode: 'insensitive' } }] : []),
        ...(modelHint ? [{ model: { contains: modelHint, mode: 'insensitive' } }] : []),
      ],
    },
    select: { id: true, customerId: true, externalId: true, model: true, manufacturer: true, serialNumber: true, assetTag: true, sector: true, installLocation: true, address: true, city: true, state: true, isActive: true },
    take: 50,
  });
  return { event: { id: event.id, customerCode, serialNumber: serial, modelHint }, customers, equipments };
}

async function correctBinding(tenantId, eventId, { customerId, equipmentId } = {}, actorId = null) {
  if (!customerId || !equipmentId) { const e = new Error('Informe cliente e equipamento para corrigir o vinculo.'); e.statusCode = 400; throw e; }
  const event = await prisma.printGuardTelemetryEvent.findFirst({ where: { tenantId, id: eventId } });
  if (!event) { const e = new Error('Evento nao encontrado.'); e.statusCode = 404; throw e; }
  const [customer, equipment] = await Promise.all([
    prisma.crmCustomer.findFirst({ where: { tenantId, id: customerId } }),
    prisma.crmEquipment.findFirst({ where: { tenantId, id: equipmentId } }),
  ]);
  if (!customer || !equipment) { const e = new Error('Cliente ou equipamento nao encontrado nesta empresa.'); e.statusCode = 404; throw e; }
  if (equipment.customerId && equipment.customerId !== customer.id) { const e = new Error('O equipamento pertence a outro cliente no iLux.'); e.statusCode = 409; throw e; }

  const existing = event.bindingId
    ? await prisma.printGuardBinding.findFirst({ where: { tenantId, id: event.bindingId } })
    : null;
  const key = { customerCode: event.customerCode || existing?.customerCode || null, serialNumber: event.serialNumber || existing?.serialNumber || null };
  const binding = existing
    ? await prisma.printGuardBinding.update({ where: { id: existing.id }, data: { customerId: customer.id, equipmentId: equipment.id, state: 'MATCHED', source: 'MANUAL', confirmedAt: new Date(), confirmedById: actorId, lastSeenAt: new Date() } })
    : await prisma.printGuardBinding.create({ data: { tenantId, connectionId: event.connectionId, ...key, customerId: customer.id, equipmentId: equipment.id, state: 'MATCHED', source: 'MANUAL', confirmedAt: new Date(), confirmedById: actorId, lastSeenAt: new Date() } });

  await prisma.printGuardTelemetryEvent.updateMany({
    where: {
      tenantId,
      connectionId: event.connectionId,
      state: { in: ['RECEIVED', 'MONITORING', 'ERROR'] },
      OR: [
        ...(key.serialNumber ? [{ serialNumber: key.serialNumber }] : []),
        ...(key.customerCode ? [{ customerCode: key.customerCode }] : []),
        { id: event.id },
      ],
    },
    data: { bindingId: binding.id, state: 'RECEIVED', errorCode: null, errorMessage: null, decisionAt: new Date(), decisionById: actorId },
  });
  return { binding, customer: { id: customer.id, name: customer.name }, equipment: { id: equipment.id, model: equipment.model, serialNumber: equipment.serialNumber, externalId: equipment.externalId } };
}

// Dispara um alerta de WhatsApp para o telefone do gestor configurado em
// Configurações (mesma via do alertService) e carimba o evento. O middleware
// de auditoria da rota grava quem/quando.
async function notifyManagerIncident(tenantId, eventId, { note, context } = {}, actorId = null) {
  const event = await prisma.printGuardTelemetryEvent.findFirst({ where: { tenantId, id: eventId } });
  if (!event) { const e = new Error('Evento nao encontrado.'); e.statusCode = 404; throw e; }

  const ctx = obj(context);
  const alertBody = [
    '🖨️ *Saúde do Parque* — decisão pendente precisa de atenção',
    '',
    `Cliente: ${ctx.customer || 'não identificado'}`,
    `Equipamento: ${ctx.equipment || 'não identificado'}`,
    `Alerta: ${ctx.eventType || event.eventType || 'telemetria'}${ctx.priority ? ` · ${ctx.priority}` : ''}`,
    ctx.recommendation ? `Recomendação do sistema: ${ctx.recommendation}` : null,
    note ? `Observação: ${String(note).trim().slice(0, 500)}` : null,
    '',
    'Abra o painel Sentinela › Saúde do Parque para decidir.',
  ].filter((line) => line !== null).join('\n');

  let delivered = false;
  try {
    const alertService = require('./alertService');
    delivered = await alertService.sendSystemAlert(tenantId, alertBody);
  } catch (error) {
    console.error('[parkService] notifyManagerIncident: alerta falhou:', error.message);
  }

  const when = new Date().toLocaleString('pt-BR', { timeZone: process.env.APP_TIMEZONE || 'America/Sao_Paulo' });
  const stamp = `Gestor ${delivered ? 'notificado por WhatsApp' : 'sinalizado (WhatsApp não configurado)'} em ${when}${note ? ` — ${String(note).trim().slice(0, 500)}` : ''}`;
  const updated = await prisma.printGuardTelemetryEvent.update({
    where: { id: event.id },
    data: {
      nextStep: event.nextStep ? `${event.nextStep}\n${stamp}` : stamp,
      decisionAt: new Date(),
      decisionById: actorId || event.decisionById,
    },
  });
  return { ok: true, delivered, event: updated };
}

async function parkCoverage(tenantId) {
  const equipments = await prisma.crmEquipment.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true, model: true, manufacturer: true, serialNumber: true, externalId: true,
      contractExternalId: true, lastMeterReadAt: true, meterSource: true, customerId: true,
    },
  });
  const serials = [...new Set(equipments.map((e) => e.serialNumber).filter(Boolean))];
  const lastSignals = serials.length
    ? await prisma.printGuardTelemetryEvent.groupBy({
      by: ['serialNumber'],
      where: { tenantId, serialNumber: { in: serials } },
      _max: { createdAt: true },
    })
    : [];
  const lastSignalBySerial = new Map(lastSignals.map((r) => [r.serialNumber, r._max.createdAt]));
  const customerIds = [...new Set(equipments.map((e) => e.customerId).filter(Boolean))];
  const customers = customerIds.length
    ? await prisma.crmCustomer.findMany({ where: { tenantId, id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const now = Date.now();
  const rows = equipments.map((e) => {
    const lastSignal = e.serialNumber ? lastSignalBySerial.get(e.serialNumber) : null;
    const lastAny = [lastSignal, e.lastMeterReadAt].filter(Boolean).map((d) => new Date(d).getTime());
    const last = lastAny.length ? Math.max(...lastAny) : null;
    const ageDays = last ? Math.floor((now - last) / DAY_MS) : null;
    const status = !last ? 'sem-sinal' : ageDays > 2 ? 'offline' : 'ativo';
    return {
      id: e.id,
      model: e.model,
      manufacturer: e.manufacturer,
      serialNumber: e.serialNumber,
      customerName: customerById.get(e.customerId)?.name || null,
      contractExternalId: e.contractExternalId,
      lastSignalAt: last ? new Date(last).toISOString() : null,
      ageDays,
      status,
    };
  });
  rows.sort((a, b) => (a.ageDays == null ? -1 : b.ageDays == null ? 1 : b.ageDays - a.ageDays));
  const summary = {
    total: rows.length,
    active: rows.filter((r) => r.status === 'ativo').length,
    offline: rows.filter((r) => r.status === 'offline').length,
    noSignal: rows.filter((r) => r.status === 'sem-sinal').length,
  };
  summary.coveragePct = summary.total ? Math.round((summary.active / summary.total) * 100) : 0;
  return { rows, summary };
}

async function equipmentRanking(tenantId, { days = 90, limit = 20 } = {}) {
  const since = new Date(Date.now() - days * DAY_MS);
  const grouped = await prisma.serviceOrder.groupBy({
    by: ['equipmentId'],
    where: { tenantId, createdAt: { gte: since } },
    _count: { _all: true },
  });
  if (!grouped.length) return { rows: [], summary: { avgCallsPer1k: 0, candidates: 0 } };

  const localIds = grouped.map((g) => g.equipmentId);
  const localEquipments = await prisma.equipment.findMany({
    where: { tenantId, id: { in: localIds } },
    select: { id: true, externalId: true, serialNumber: true, model: true, contactId: true, pageCount: true },
  });
  const localById = new Map(localEquipments.map((e) => [e.id, e]));
  const externalIds = [...new Set(localEquipments.map((e) => e.externalId).filter(Boolean))];
  const crmEquipments = externalIds.length
    ? await prisma.crmEquipment.findMany({
      where: { tenantId, externalSource: 'firebird', externalId: { in: externalIds } },
      select: { externalId: true, model: true, serialNumber: true, customerId: true, pageCounter: true },
    })
    : [];
  const crmByExternal = new Map(crmEquipments.map((e) => [e.externalId, e]));
  const customerIds = [...new Set(crmEquipments.map((e) => e.customerId).filter(Boolean))];
  const customers = customerIds.length
    ? await prisma.crmCustomer.findMany({ where: { tenantId, id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const rows = [];
  for (const g of grouped) {
    const local = localById.get(g.equipmentId);
    if (!local) continue;
    const crmEq = local.externalId ? crmByExternal.get(local.externalId) : null;
    const trend = crmEq?.externalId ? await parkMetrics.meterTrend(tenantId, crmEq.externalId, { days }) : null;
    const volume = (trend?.pagesPerDay || 0) * days || crmEq?.pageCounter || local.pageCount || 0;
    const callsPer1k = volume > 0 ? Math.round((g._count._all / volume) * 1000 * 10) / 10 : null;
    rows.push({
      equipmentId: local.id,
      model: crmEq?.model || local.model,
      serialNumber: crmEq?.serialNumber || local.serialNumber,
      customerName: crmEq ? (customerById.get(crmEq.customerId)?.name || null) : null,
      calls: g._count._all,
      volume: Math.round(volume),
      pagesPerDay: trend?.pagesPerDay ?? null,
      callsPer1k,
    });
  }
  rows.sort((a, b) => (b.callsPer1k ?? -1) - (a.callsPer1k ?? -1) || b.calls - a.calls);
  const withRate = rows.filter((r) => r.callsPer1k != null);
  const avg = withRate.length ? withRate.reduce((s, r) => s + r.callsPer1k, 0) / withRate.length : 0;
  const summary = {
    avgCallsPer1k: Math.round(avg * 10) / 10,
    candidates: rows.filter((r) => r.callsPer1k != null && r.callsPer1k >= avg * 3 && avg > 0).length,
  };
  return { rows: rows.slice(0, limit), summary };
}

async function equipmentTimeline(tenantId, equipmentId, { limit = 40 } = {}) {
  const crmEq = await prisma.crmEquipment.findFirst({
    where: { tenantId, id: equipmentId },
    select: { id: true, model: true, serialNumber: true, externalId: true, contractExternalId: true, pageCounter: true, lastMeterReadAt: true },
  });
  if (!crmEq) { const e = new Error('Equipamento nao encontrado.'); e.statusCode = 404; throw e; }
  const localEq = crmEq.externalId
    ? await prisma.equipment.findFirst({ where: { tenantId, externalSource: 'firebird', externalId: crmEq.externalId }, select: { id: true } })
    : null;

  const [events, orders, readings, insight] = await Promise.all([
    crmEq.serialNumber ? prisma.printGuardTelemetryEvent.findMany({
      where: { tenantId, serialNumber: crmEq.serialNumber },
      select: { id: true, eventType: true, severity: true, occurredAt: true, createdAt: true, state: true, errorMessage: true },
      orderBy: { createdAt: 'desc' }, take: limit,
    }) : [],
    localEq ? prisma.serviceOrder.findMany({
      where: { tenantId, equipmentId: localEq.id },
      select: { id: true, cdOstp: true, defect: true, status: true, createdAt: true, resolvedAt: true, closedAt: true },
      orderBy: { createdAt: 'desc' }, take: limit,
    }) : [],
    crmEq.externalId ? prisma.crmMeterReading.findMany({
      where: { tenantId, equipmentExternalId: crmEq.externalId },
      select: { reading: true, readAt: true, meterCode: true }, orderBy: { readAt: 'asc' },
    }) : [],
    crmEq.externalId ? parkMetrics.equipmentInsight(tenantId, { equipmentExternalId: crmEq.externalId, contractExternalId: crmEq.contractExternalId }) : null,
  ]);

  const timeline = [
    ...events.map((e) => ({ kind: 'event', at: e.occurredAt || e.createdAt, ref: e.id, title: e.eventType, severity: e.severity, detail: e.errorMessage, state: e.state })),
    ...orders.map((o) => ({ kind: 'os', at: o.createdAt, ref: o.id, title: `O.S. ${o.cdOstp || ''}`.trim(), detail: o.defect, state: o.status, resolvedAt: o.resolvedAt || o.closedAt })),
  ].filter((x) => x.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    equipment: { id: crmEq.id, model: crmEq.model, serialNumber: crmEq.serialNumber, pageCounter: crmEq.pageCounter, lastMeterReadAt: crmEq.lastMeterReadAt },
    insight,
    readings,
    timeline: timeline.slice(0, limit),
  };
}

// N eventos MATCHED do mesmo contato -> 1 O.S. + 1 ticket.
async function consolidateToServiceOrder(tenantId, eventIds, { cdOstp, priority, defect, nmsuportet } = {}) {
  const ids = [...new Set((eventIds || []).map(String).filter(Boolean))];
  if (ids.length < 1) { const e = new Error('Selecione ao menos um evento.'); e.statusCode = 400; throw e; }
  if (!String(cdOstp || '').trim()) { const e = new Error('Informe o tipo de O.S.'); e.statusCode = 400; throw e; }

  const events = await prisma.printGuardTelemetryEvent.findMany({
    where: { tenantId, id: { in: ids } },
    include: { connection: true },
  });
  if (events.length !== ids.length) { const e = new Error('Um ou mais eventos nao foram encontrados.'); e.statusCode = 404; throw e; }
  if (events.some((ev) => ev.serviceOrderId)) { const e = new Error('Um dos eventos ja possui O.S.'); e.statusCode = 409; throw e; }
  if (events.some((ev) => ev.state === 'IGNORED')) { const e = new Error('Evento ignorado nao pode entrar na consolidacao.'); e.statusCode = 409; throw e; }

  const bindingIds = [...new Set(events.map((ev) => ev.bindingId).filter(Boolean))];
  const bindings = await prisma.printGuardBinding.findMany({ where: { tenantId, id: { in: bindingIds } } });
  if (bindings.length !== bindingIds.length || bindings.some((b) => b.state !== 'MATCHED' || !b.customerId)) {
    const e = new Error('Todos os eventos precisam ter vinculo inequivoco de cliente.'); e.statusCode = 409; throw e;
  }
  const customerIds = [...new Set(bindings.map((b) => b.customerId))];
  if (customerIds.length !== 1) { const e = new Error('Os eventos sao de clientes diferentes — nao da para consolidar em uma O.S.'); e.statusCode = 409; throw e; }

  const bindingById = new Map(bindings.map((b) => [b.id, b]));
  const anyBinding = bindings[0];
  const crmEquipment = await prisma.crmEquipment.findFirst({ where: { tenantId, id: anyBinding.equipmentId } });
  const localEquipment = crmEquipment?.externalId
    ? await prisma.equipment.findFirst({ where: { tenantId, externalSource: 'firebird', externalId: crmEquipment.externalId } })
    : null;
  if (!localEquipment) { const e = new Error('Equipamento ainda nao sincronizado para abertura de O.S.'); e.statusCode = 409; throw e; }
  const contact = await prisma.contact.findFirst({ where: { tenantId, id: localEquipment.contactId } });
  if (!contact) { const e = new Error('Contato do equipamento nao encontrado.'); e.statusCode = 409; throw e; }

  const osType = await prisma.crmOsType.findFirst({ where: { tenantId, code: String(cdOstp).trim() } });
  if (!osType) { const e = new Error('Tipo de O.S. nao sincronizado no iLux.'); e.statusCode = 409; throw e; }

  const items = events.map((ev) => `${ev.eventType} (${ev.serialNumber || 's/serie'})`).join('; ');
  const body = String(defect || `PrintGuard — consolidado: ${items}`).slice(0, 4000);
  const requestKey = `printguard:consolidado:${ids.sort().join('-')}`.slice(0, 190);

  const existing = await prisma.serviceOrder.findFirst({ where: { tenantId, requestKey } });
  if (existing) {
    await prisma.printGuardTelemetryEvent.updateMany({ where: { tenantId, id: { in: ids } }, data: { state: 'APPROVED', serviceOrderId: existing.id, ticketId: existing.ticketId } });
    return existing;
  }

  const result = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({ data: { tenantId, contactId: contact.id, subject: body.slice(0, 240), status: 'pending', priority: priority || 'medium' } });
    const serviceOrder = await tx.serviceOrder.create({
      data: {
        tenantId, contactId: contact.id, equipmentId: localEquipment.id, ticketId: ticket.id,
        requestKey, externalSource: 'firebird', status: 'AGUARDANDO_ILUX', cdOstp: osType.code,
        nmsuportet: nmsuportet || null, defect: body,
      },
    });
    await tx.printGuardTelemetryEvent.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { state: 'APPROVED', ticketId: ticket.id, serviceOrderId: serviceOrder.id, errorCode: null, errorMessage: null },
    });
    return serviceOrder;
  });

  // Ack por evento para o PrintGuard, quando o helper estiver exposto.
  if (typeof printGuard.notifyRemote === 'function') {
    for (const ev of events) {
      try {
        await printGuard.notifyRemote(ev.connection, ev.externalEventId, 'outcome', {
          status: 'resolved',
          resolution: 'O.S. consolidada criada no Multiatendimento.',
          metadata: { serviceOrderId: result.id, consolidated: ids.length },
        });
      } catch { /* notificacao remota nunca bloqueia */ }
    }
  }
  return result;
}

module.exports = {
  parkQueue,
  parkCoverage,
  equipmentRanking,
  equipmentTimeline,
  consolidateToServiceOrder,
  bindingCandidates,
  correctBinding,
  updateDecisionWorkflow,
  notifyManagerIncident,
  __testing: {
    computeHealth, healthBucket, pickOsType, tonerLevelFromPayload, severityRank,
    priorityForIncident, recommendationForIncident,
  },
};
