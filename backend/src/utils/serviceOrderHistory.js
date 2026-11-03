const { parseFirebirdDate } = require('./firebirdDate');

function historyEquipmentCode(item) {
  const raw = item?.raw && typeof item.raw === 'object' ? item.raw : item || {};
  return String(
    item?.equipmentExternalId
    || item?.equipmentCodigoLegado
    || item?.equipamentoCodigoLegado
    || item?.equipmentCode
    || raw.cdequipamento
    || ''
  ).trim();
}

function selectPreviousServiceOrders(orders, {
  currentOrderIds = [],
} = {}) {
  const uniqueOrders = new Map();
  for (const item of Array.isArray(orders) ? orders : []) {
    const id = String(item?.externalId || '').trim();
    if (id && !uniqueOrders.has(id)) uniqueOrders.set(id, item);
  }

  const currentIds = new Set(currentOrderIds.map((id) => String(id || '').trim()).filter(Boolean));
  return [...uniqueOrders.values()]
    .filter((item) => {
      const id = String(item.externalId || '').trim();
      const canonicalId = String(item.canonicalId || '').trim();
      return !currentIds.has(id) && !currentIds.has(canonicalId);
    })
    .sort((left, right) => {
      const leftTime = parseFirebirdDate(left.createdAt, left.time)?.getTime() || 0;
      const rightTime = parseFirebirdDate(right.createdAt, right.time)?.getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, 5);
}

module.exports = {
  historyEquipmentCode,
  selectPreviousServiceOrders,
};
