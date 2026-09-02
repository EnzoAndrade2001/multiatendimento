const prisma = require('../src/lib/prisma');
const { parseFirebirdDate } = require('../src/utils/firebirdDate');

const PAGE_SIZE = 500;

function first(...values) {
  for (const value of values) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    return value;
  }
  return null;
}

async function main() {
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  for (;;) {
    const rows = await prisma.externalSyncRecord.findMany({
      where: { source: 'firebird', entity: 'serviceOrders' },
      select: { tenantId: true, externalId: true, payload: true },
      orderBy: { id: 'asc' },
      skip: offset,
      take: PAGE_SIZE,
    });
    if (!rows.length) break;
    for (const record of rows) {
      scanned += 1;
      const payload = record.payload || {};
      const raw = payload.raw && typeof payload.raw === 'object' ? payload.raw : payload;
      const createdAt = parseFirebirdDate(
        first(raw.dtinclusao, payload.dtinclusao, payload.createdAt),
        first(raw.hrinclusao, payload.hrinclusao),
      );
      const hasClosedAt = Object.prototype.hasOwnProperty.call(raw, 'dtfechamento')
        || Object.prototype.hasOwnProperty.call(payload, 'closedAt');
      const closedAt = parseFirebirdDate(first(raw.dtfechamento, payload.closedAt));
      const hasAttendedAt = Object.prototype.hasOwnProperty.call(raw, 'dtatendimento')
        || Object.prototype.hasOwnProperty.call(payload, 'resolvedAt');
      const attendedAt = parseFirebirdDate(
        first(raw.dtatendimento, payload.resolvedAt),
        first(raw.hratendimento, payload.hratendimento),
      );
      const data = {};
      if (createdAt) data.createdAt = createdAt;
      if (hasClosedAt) data.closedAt = closedAt;
      if (hasAttendedAt) data.resolvedAt = attendedAt || closedAt || null;
      if (!Object.keys(data).length) continue;
      const result = await prisma.serviceOrder.updateMany({
        where: { tenantId: record.tenantId, externalSource: 'firebird', externalId: String(record.externalId) },
        data,
      });
      updated += result.count;
    }
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  console.log(JSON.stringify({ scanned, updated }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
