const test = require('node:test');
const assert = require('node:assert/strict');
const { __testing } = require('../src/services/parkService');
const {
  computeHealth,
  healthBucket,
  pickOsType,
  tonerLevelFromPayload,
  severityRank,
  priorityForIncident,
  recommendationForIncident,
  reopenExpiredMonitoring,
  recommendationEvidence,
  matchesManagerFilters,
  managerMetrics,
} = __testing;
const prisma = require('../src/lib/prisma');
const { parkCoverage } = require('../src/services/parkService');

test('computeHealth: penaliza chamados recentes e equipamento inativo', () => {
  assert.equal(computeHealth({ callCount90d: 0, ageMinutes: 0, equipmentActive: true }), 100);
  assert.equal(computeHealth({ callCount90d: 3, ageMinutes: 0, equipmentActive: true }), 73);
  assert.equal(computeHealth({ callCount90d: 10, ageMinutes: 0, equipmentActive: true }), 40); // cap -60
  assert.equal(computeHealth({ callCount90d: 0, ageMinutes: 0, equipmentActive: false }), 75);
});

test('healthBucket: faixas', () => {
  assert.equal(healthBucket(90), 'ok');
  assert.equal(healthBucket(60), 'warn');
  assert.equal(healthBucket(30), 'bad');
  assert.equal(healthBucket(null), 'unknown');
});

test('severityRank: ordena CRITICAL > WARNING > INFO', () => {
  assert.ok(severityRank('CRITICAL') > severityRank('WARNING'));
  assert.ok(severityRank('WARNING') > severityRank('INFO'));
  assert.equal(severityRank('qualquer'), 0);
});

test('tonerLevelFromPayload: le percentual de varios campos', () => {
  assert.equal(tonerLevelFromPayload({ level: 35 }), 35);
  assert.equal(tonerLevelFromPayload({ toner: { overall: 12 } }), 12);
  assert.equal(tonerLevelFromPayload({ levelPct: 8 }), 8);
  assert.equal(tonerLevelFromPayload({ level: 120 }), null); // fora de 0-100
  assert.equal(tonerLevelFromPayload({}), null);
});

test('pickOsType: escolhe tipo de suprimento para toner e tecnico para erro', () => {
  const types = [
    { code: '1', name: 'Manutencao Corretiva' },
    { code: '2', name: 'Entrega de Suprimento' },
    { code: '3', name: 'Instalacao' },
  ];
  assert.equal(pickOsType(types, 'toner.low')?.code, '2');
  assert.equal(pickOsType(types, 'hardware.error')?.code, '1');
  assert.equal(pickOsType(types, 'evento.desconhecido'), null);
  assert.equal(pickOsType([], 'toner.low'), null);
});

test('priorityForIncident: toner que acaba em ate um dia recebe prioridade operacional alta', () => {
  const result = priorityForIncident({
    severity: 'CRITICAL',
    mappingState: 'MATCHED',
    isHardware: false,
    isLowToner: true,
    tonerDaysLeft: 0.5,
    state: 'RECEIVED',
    monitoringUntil: null,
    hasOpenServiceOrder: false,
    ageMinutes: 30,
  });
  assert.equal(result.level, 'P1');
  assert.ok(result.score >= 75);
  assert.ok(result.reasons.some((reason) => /1 dia/i.test(reason)));
});

test('priorityForIncident: prazo de monitoramento expirado reentra com agravamento', () => {
  const base = {
    severity: 'LOW',
    mappingState: 'MATCHED',
    isHardware: false,
    isLowToner: false,
    tonerDaysLeft: null,
    state: 'MONITORING',
    hasOpenServiceOrder: false,
    ageMinutes: 60,
  };
  const active = priorityForIncident({ ...base, monitoringUntil: new Date(Date.now() + 60_000) });
  const expired = priorityForIncident({ ...base, monitoringUntil: new Date(Date.now() - 60_000) });
  assert.equal(active.monitoringExpired, false);
  assert.equal(expired.monitoringExpired, true);
  assert.ok(expired.score > active.score);
  assert.ok(expired.reasons.some((reason) => /expirou/i.test(reason)));
});

test('priorityForIncident: O.S. aberta reduz urgencia de nova abertura', () => {
  const input = {
    severity: 'CRITICAL', mappingState: 'MATCHED', isHardware: true, isLowToner: false,
    tonerDaysLeft: null, state: 'RECEIVED', monitoringUntil: null, ageMinutes: 20,
  };
  const withoutOrder = priorityForIncident({ ...input, hasOpenServiceOrder: false });
  const withOrder = priorityForIncident({ ...input, hasOpenServiceOrder: true });
  assert.ok(withOrder.score < withoutOrder.score);
  assert.ok(withOrder.reasons.some((reason) => /O\.S\. aberta/i.test(reason)));
});

test('recommendationForIncident: vinculo pendente sempre prevalece sobre abertura de O.S.', () => {
  const recommendation = recommendationForIncident({
    mappingState: 'AMBIGUOUS',
    openServiceOrder: null,
    isHardware: true,
    isLowToner: false,
    severity: 'CRITICAL',
    toner: {},
    trend: {},
    state: 'RECEIVED',
  });
  assert.equal(recommendation.action, 'FIX_BINDING');
  assert.equal(recommendation.confidence, 'high');
});

test('recommendationForIncident: O.S. existente impede recomendacao duplicada', () => {
  const recommendation = recommendationForIncident({
    mappingState: 'MATCHED',
    openServiceOrder: { id: 'os-1', number: '91750' },
    isHardware: true,
    isLowToner: false,
    severity: 'CRITICAL',
    toner: {},
    trend: {},
    state: 'RECEIVED',
  });
  assert.equal(recommendation.action, 'VIEW_SERVICE_ORDER');
  assert.match(recommendation.explanation, /91750/);
});

test('recommendationForIncident: baixa evidencia recomenda monitoramento com prazo', () => {
  const recommendation = recommendationForIncident({
    mappingState: 'MATCHED',
    openServiceOrder: null,
    isHardware: false,
    isLowToner: true,
    severity: 'LOW',
    toner: { daysLeft: 40 },
    trend: { points: 1, reliable: false },
    state: 'RECEIVED',
  });
  assert.equal(recommendation.action, 'MONITOR');
  assert.equal(recommendation.confidence, 'low');
});

test('recommendationEvidence: explica regra, entradas e dados ausentes sem inventar estoque', () => {
  const evidence = recommendationEvidence({
    recommendation: { action: 'OPEN_SERVICE_ORDER', confidence: 'medium' },
    priority: { reasons: ['Insumo previsto para acabar'] }, severity: 'WARNING', mappingState: 'MATCHED',
    isLowToner: true, toner: { levelPct: 8, daysLeft: 2 }, trend: { points: 1 }, supply: {},
    customer: { id: 'c1' }, equipment: { id: 'e1' }, ageMinutes: 20, lastSignalAt: '2026-08-31T12:00:00Z',
  });
  assert.equal(evidence.rule, 'OPEN_SERVICE_ORDER');
  assert.equal(evidence.inputs.tonerDaysLeft, 2);
  assert.ok(evidence.missing.includes('stock'));
  assert.ok(evidence.missing.includes('route'));
  assert.ok(evidence.missing.includes('meterHistory'));
});

test('matchesManagerFilters: combina prioridade, sem responsavel, prazo e reincidencia', () => {
  const incident = { priority: { level: 'P1' }, workflow: { assignedTo: null, decisionDueAt: null }, callCount90d: 3, supply: {}, equipment: {} };
  assert.equal(matchesManagerFilters(incident, { priority: 'P1,P2', unassigned: 'true', withoutDeadline: 'true', recurrent: 'true' }), true);
  assert.equal(matchesManagerFilters(incident, { priority: 'P3' }), false);
  assert.equal(matchesManagerFilters({ ...incident, workflow: { assignedTo: { id: 'u1' } } }, { assignedToId: 'none' }), false);
});

test('managerMetrics: calcula SLA, tempo medio e carga por responsavel', () => {
  const now = new Date('2026-08-31T15:00:00Z');
  const incidents = [
    { state: 'RECEIVED', receivedAt: '2026-08-31T12:00:00Z', priority: { level: 'P1' }, workflow: { assignedTo: { id: 'u1', name: 'Ana' }, decisionDueAt: '2026-08-31T14:00:00Z' }, recommendation: {} },
    { state: 'MONITORING', receivedAt: '2026-08-31T13:00:00Z', priority: { level: 'P3' }, workflow: { assignedTo: null, decisionAt: '2026-08-31T14:00:00Z', monitoringUntil: '2026-09-01T12:00:00Z' }, recommendation: { action: 'VIEW_SERVICE_ORDER' }, openServiceOrder: { id: 'os1' } },
  ];
  const metrics = managerMetrics(incidents, { now });
  assert.equal(metrics.pending, 2);
  assert.equal(metrics.overdue, 1);
  assert.equal(metrics.slaCompliancePct, 50);
  assert.equal(metrics.avgDecisionMinutes, 60);
  assert.equal(metrics.duplicatesAvoided, 1);
  assert.equal(metrics.unassigned, 1);
  assert.equal(metrics.byAssignee[0].overdue, 1);
});

test('parkCoverage: considera somente equipamentos com vinculo PrintGuard confirmado', { concurrency: false }, async () => {
  const originals = {
    bindingFindMany: prisma.printGuardBinding.findMany,
    bindingCount: prisma.printGuardBinding.count,
    equipmentFindMany: prisma.crmEquipment.findMany,
    customerFindMany: prisma.crmCustomer.findMany,
  };
  let bindingWhere;
  let equipmentWhere;
  prisma.printGuardBinding.findMany = async ({ where }) => {
    bindingWhere = where;
    return [
      { id: 'b-new', equipmentId: 'eq-1', lastSeenAt: new Date() },
      { id: 'b-old', equipmentId: 'eq-1', lastSeenAt: new Date(Date.now() - 10 * 86400000) },
      { id: 'b-never', equipmentId: 'eq-2', lastSeenAt: null },
    ];
  };
  prisma.printGuardBinding.count = async () => 3;
  prisma.crmEquipment.findMany = async ({ where }) => {
    equipmentWhere = where;
    return [
      { id: 'eq-1', model: 'Modelo A', serialNumber: 'A1', customerId: 'c1', lastMeterReadAt: null },
      { id: 'eq-2', model: 'Modelo B', serialNumber: 'B1', customerId: 'c1', lastMeterReadAt: null },
    ];
  };
  prisma.crmCustomer.findMany = async () => [{ id: 'c1', name: 'Cliente' }];
  try {
    const result = await parkCoverage('tenant-1');
    assert.equal(bindingWhere.state, 'MATCHED');
    assert.equal(bindingWhere.equipmentId.not, null);
    assert.deepEqual(new Set(equipmentWhere.id.in), new Set(['eq-1', 'eq-2']));
    assert.equal(equipmentWhere.isActive, true);
    assert.equal(result.summary.total, 2);
    assert.equal(result.summary.active, 1);
    assert.equal(result.summary.noSignal, 1);
    assert.equal(result.summary.pendingBindings, 3);
    assert.equal(result.rows.find((row) => row.id === 'eq-1').status, 'ativo');
  } finally {
    prisma.printGuardBinding.findMany = originals.bindingFindMany;
    prisma.printGuardBinding.count = originals.bindingCount;
    prisma.crmEquipment.findMany = originals.equipmentFindMany;
    prisma.crmCustomer.findMany = originals.customerFindMany;
  }
});

test('monitoramento vencido reabre somente eventos encontrados e registra antes/depois', { concurrency: false }, async () => {
  const originals = {
    findMany: prisma.printGuardTelemetryEvent.findMany,
    updateMany: prisma.printGuardTelemetryEvent.updateMany,
    auditCreate: prisma.auditEvent.create,
  };
  const audits = [];
  let updateArgs;
  prisma.printGuardTelemetryEvent.findMany = async () => [{ id: 'evt-1', monitoringUntil: new Date('2026-08-01'), monitoringCondition: 'nova leitura', assignedToId: 'u-1' }];
  prisma.printGuardTelemetryEvent.updateMany = async (args) => { updateArgs = args; return { count: 1 }; };
  prisma.auditEvent.create = async ({ data }) => { audits.push(data); return data; };
  try {
    assert.equal(await reopenExpiredMonitoring('tenant-1', new Date('2026-08-02')), 1);
    assert.deepEqual(updateArgs.where.id.in, ['evt-1']);
    assert.equal(updateArgs.data.state, 'RECEIVED');
    assert.equal(audits[0].action, 'PRINTGUARD_MONITORING_EXPIRED');
    assert.equal(audits[0].metadata.before.state, 'MONITORING');
    assert.equal(audits[0].metadata.after.state, 'RECEIVED');
  } finally {
    prisma.printGuardTelemetryEvent.findMany = originals.findMany;
    prisma.printGuardTelemetryEvent.updateMany = originals.updateMany;
    prisma.auditEvent.create = originals.auditCreate;
  }
});
