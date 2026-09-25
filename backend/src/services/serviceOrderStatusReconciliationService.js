const prisma = require('../lib/prisma');
const { normalizeServiceOrderStatus, rawServiceOrderStatus } = require('../utils/serviceOrderStatus');
const { LCD_OFFICIAL_SOURCES } = require('../utils/externalSource');

async function reconcileServiceOrderStatuses(tenantId, { equipmentId = null, limit = 1000 } = {}) {
  const orders = await prisma.serviceOrder.findMany({
    where: {
      tenantId,
      externalSource: { in: LCD_OFFICIAL_SOURCES },
      externalId: { not: null },
      status: { notIn: ['FINALIZADA', 'CANCELADA'] },
      ...(equipmentId ? { equipmentId } : {}),
    },
    select: { id: true, externalId: true, status: true },
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(Number(limit) || 1000, 5000)),
  });
  if (!orders.length) return { checked: 0, updated: 0 };

  const records = await prisma.externalSyncRecord.findMany({
    where: { tenantId, source: 'ilux_web', entity: 'serviceOrders', externalId: { in: orders.map((order) => order.externalId) } },
    select: { externalId: true, payload: true },
  });
  const statuses = new Map();
  for (const record of records) {
    const rawStatus = rawServiceOrderStatus(record.payload);
    const closedAt = record.payload?.closedAt || record.payload?.raw?.dtfechamento || null;
    if (rawStatus == null && !closedAt) continue;
    statuses.set(String(record.externalId), normalizeServiceOrderStatus(rawStatus, { closedAt }));
  }
  const changed = orders.filter((order) => {
    const status = statuses.get(String(order.externalId));
    return status && status !== order.status;
  });
  await Promise.all(changed.map((order) => prisma.serviceOrder.update({
    where: { id: order.id },
    data: { status: statuses.get(String(order.externalId)) },
  })));
  return { checked: orders.length, updated: changed.length };
}

module.exports = { reconcileServiceOrderStatuses };
