const prisma = require('../lib/prisma');

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- puro: matematica de contador ----------

// Regressao linear (minimos quadrados) de reading ~ tempo(dias).
// points: [{ readAt: Date|string, reading: number }]. Retorna paginas/dia.
function linearPagesPerDay(points) {
  const clean = (points || [])
    .map((p) => ({ t: new Date(p.readAt).getTime(), y: Number(p.reading) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y))
    .sort((a, b) => a.t - b.t);
  if (clean.length < 2) return null;

  const t0 = clean[0].t;
  const xs = clean.map((p) => (p.t - t0) / DAY_MS);
  const ys = clean.map((p) => p.y);
  const n = clean.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;

  const slope = (n * sxy - sx * sy) / denom;
  // Contador so cresce; ruido pode dar slope levemente negativo -> zera.
  return slope > 0 ? slope : 0;
}

// Dias ate o toner acabar, dado nivel (%), consumo e rendimento nominal.
function tonerDaysLeft({ levelPct, pagesPerDay, yieldPages }) {
  const rate = Number(pagesPerDay);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const lvl = Number(levelPct);
  if (!Number.isFinite(lvl) || lvl < 0) return null;
  if (yieldPages && Number.isFinite(Number(yieldPages))) {
    return Math.max(0, ((lvl / 100) * Number(yieldPages)) / rate);
  }
  // Sem rendimento: aproximacao grosseira assumindo ~5.000 pag por 100%.
  return Math.max(0, ((lvl / 100) * 5000) / rate);
}

// Projecao de franquia no fechamento do ciclo.
function franchiseProjection({ pageFranchise, producedThisCycle, pagesPerDay, cycleDaysLeft, excessPageValue }) {
  const franchise = Math.max(0, Number(pageFranchise) || 0);
  const produced = Math.max(0, Number(producedThisCycle) || 0);
  const rate = Math.max(0, Number(pagesPerDay) || 0);
  const daysLeft = Math.max(0, Number(cycleDaysLeft) || 0);
  const unit = Math.max(0, Number(excessPageValue) || 0);

  const projected = Math.round(produced + rate * daysLeft);
  const over = Math.max(0, projected - franchise);
  return {
    franchise,
    produced,
    projected,
    remaining: Math.max(0, franchise - produced),
    consumedPct: franchise ? Math.round((produced / franchise) * 100) : null,
    projectedPct: franchise ? Math.round((projected / franchise) * 100) : null,
    overPages: over,
    overValue: Math.round(over * unit * 100) / 100,
    willExceed: projected > franchise,
  };
}

function daysUntilCycleClose(referenceDate = new Date()) {
  const d = new Date(referenceDate);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return Math.max(0, lastDay - d.getDate());
}

// ---------- leitura: historico e contrato ----------

async function meterTrend(tenantId, equipmentExternalId, { meterCode = null, days = 60 } = {}) {
  if (!equipmentExternalId) return { pagesPerDay: null, points: 0, current: null };
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.crmMeterReading.findMany({
    where: {
      tenantId,
      equipmentExternalId: String(equipmentExternalId),
      ...(meterCode ? { meterCode: String(meterCode) } : {}),
      readAt: { gte: since },
    },
    orderBy: { readAt: 'asc' },
    select: { readAt: true, reading: true, meterCode: true },
  });
  if (!rows.length) return { pagesPerDay: null, points: 0, current: null, windowDays: days };

  const pagesPerDay = linearPagesPerDay(rows);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const spanDays = Math.max(0, (new Date(last.readAt).getTime() - new Date(first.readAt).getTime()) / DAY_MS);
  return {
    pagesPerDay: pagesPerDay == null ? null : Math.round(pagesPerDay),
    points: rows.length,
    current: last.reading,
    firstAt: first.readAt,
    lastAt: last.readAt,
    spanDays: Math.round(spanDays),
    windowDays: days,
    reliable: rows.length >= 3 && spanDays >= 7,
  };
}

async function resolveContract(tenantId, { contractExternalId }) {
  if (!contractExternalId) return null;
  return prisma.crmContract.findFirst({
    where: { tenantId, externalId: String(contractExternalId) },
  });
}

// Monta o retrato de um equipamento para o card da fila / sub-abas.
async function equipmentInsight(tenantId, {
  equipmentExternalId,
  contractExternalId = null,
  tonerLevelPct = null,
  producedThisCycle = null,
  meterCode = null,
  yieldPages = null,
} = {}) {
  const [trend, contract] = await Promise.all([
    meterTrend(tenantId, equipmentExternalId, { meterCode }),
    resolveContract(tenantId, { contractExternalId }),
  ]);

  const toner = {
    levelPct: tonerLevelPct == null ? null : Number(tonerLevelPct),
    daysLeft: tonerDaysLeft({ levelPct: tonerLevelPct, pagesPerDay: trend.pagesPerDay, yieldPages }),
  };

  let franchise = null;
  if (contract && contract.pageFranchise) {
    franchise = franchiseProjection({
      pageFranchise: contract.pageFranchise,
      producedThisCycle: producedThisCycle,
      pagesPerDay: trend.pagesPerDay,
      cycleDaysLeft: daysUntilCycleClose(),
      excessPageValue: contract.excessPageValue,
    });
  }

  return {
    trend,
    toner,
    contract: contract && {
      externalId: contract.externalId,
      number: contract.number,
      type: contract.type,
      modality: contract.modality,
      isActive: contract.isActive,
      pageFranchise: contract.pageFranchise,
      excessPageValue: contract.excessPageValue,
      monthlyValue: contract.monthlyValue,
    },
    franchise,
  };
}

module.exports = {
  linearPagesPerDay,
  tonerDaysLeft,
  franchiseProjection,
  daysUntilCycleClose,
  meterTrend,
  resolveContract,
  equipmentInsight,
};
