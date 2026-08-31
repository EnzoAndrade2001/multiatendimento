const test = require('node:test');
const assert = require('node:assert/strict');
const {
  linearPagesPerDay,
  tonerDaysLeft,
  franchiseProjection,
  daysUntilCycleClose,
  equipmentInsights,
} = require('../src/services/parkMetricsService');
const prisma = require('../src/lib/prisma');

test('linearPagesPerDay: reta perfeita retorna a inclinacao', () => {
  const points = [
    { readAt: '2026-08-01', reading: 100000 },
    { readAt: '2026-08-11', reading: 104500 },
    { readAt: '2026-08-21', reading: 109000 },
  ];
  assert.equal(Math.round(linearPagesPerDay(points)), 450);
});

test('linearPagesPerDay: menos de 2 pontos = null', () => {
  assert.equal(linearPagesPerDay([{ readAt: '2026-08-01', reading: 1 }]), null);
  assert.equal(linearPagesPerDay([]), null);
});

test('linearPagesPerDay: contador que "regrediu" por ruido nao vira negativo', () => {
  const points = [
    { readAt: '2026-08-01', reading: 100000 },
    { readAt: '2026-08-02', reading: 99999 },
  ];
  assert.equal(linearPagesPerDay(points), 0);
});

test('tonerDaysLeft: usa rendimento nominal quando disponivel', () => {
  // 40% de 8000 pag = 3200 pag; a 400 pag/dia -> 8 dias
  assert.equal(tonerDaysLeft({ levelPct: 40, pagesPerDay: 400, yieldPages: 8000 }), 8);
});

test('tonerDaysLeft: sem consumo retorna null', () => {
  assert.equal(tonerDaysLeft({ levelPct: 40, pagesPerDay: 0, yieldPages: 8000 }), null);
  assert.equal(tonerDaysLeft({ levelPct: 40, pagesPerDay: null }), null);
});

test('franchiseProjection: projeta estouro e valor do excedente', () => {
  const r = franchiseProjection({
    pageFranchise: 10000,
    producedThisCycle: 9000,
    pagesPerDay: 500,
    cycleDaysLeft: 6,
    excessPageValue: 0.35,
  });
  assert.equal(r.projected, 12000);
  assert.equal(r.overPages, 2000);
  assert.equal(r.overValue, 700);
  assert.equal(r.willExceed, true);
  assert.equal(r.consumedPct, 90);
});

test('franchiseProjection: dentro da franquia nao acusa estouro', () => {
  const r = franchiseProjection({ pageFranchise: 10000, producedThisCycle: 3000, pagesPerDay: 100, cycleDaysLeft: 10 });
  assert.equal(r.willExceed, false);
  assert.equal(r.overPages, 0);
  assert.equal(r.remaining, 7000);
});

test('daysUntilCycleClose: conta ate o ultimo dia do mes (data local)', () => {
  assert.equal(daysUntilCycleClose(new Date(2026, 7, 20)), 11); // 31 - 20
  assert.equal(daysUntilCycleClose(new Date(2026, 7, 31)), 0);
  assert.equal(daysUntilCycleClose(new Date(2026, 1, 10)), 18); // fev/2026 tem 28 dias
});

test('equipmentInsights consulta leituras e contratos uma vez para varios equipamentos', { concurrency: false }, async () => {
  const originalReadings = prisma.crmMeterReading.findMany;
  const originalContracts = prisma.crmContract.findMany;
  let readingCalls = 0;
  let contractCalls = 0;
  prisma.crmMeterReading.findMany = async () => { readingCalls += 1; return []; };
  prisma.crmContract.findMany = async () => { contractCalls += 1; return []; };
  try {
    const result = await equipmentInsights('tenant-1', [
      { equipmentExternalId: 'eq-1', contractExternalId: 'c-1' },
      { equipmentExternalId: 'eq-2', contractExternalId: 'c-2' },
      { equipmentExternalId: 'eq-1', contractExternalId: 'c-1' },
    ]);
    assert.equal(result.size, 2);
    assert.equal(readingCalls, 1);
    assert.equal(contractCalls, 1);
  } finally {
    prisma.crmMeterReading.findMany = originalReadings;
    prisma.crmContract.findMany = originalContracts;
  }
});
