const test = require('node:test');
const assert = require('node:assert/strict');
const {
  historyEquipmentCode,
  selectPreviousServiceOrders,
} = require('../src/utils/serviceOrderHistory');

test('history equipment code accepts LCD Web legacy field names', () => {
  assert.equal(historyEquipmentCode({ equipmentCodigoLegado: ' 950 ' }), '950');
  assert.equal(historyEquipmentCode({ equipamentoCodigoLegado: 951 }), '951');
});

test('selects the latest five customer orders across equipment and excludes current order', () => {
  const orders = [
    { externalId: '8000', canonicalId: 'current-uuid', createdAt: '2026-11-01T10:00:00Z', equipmentExternalId: 'EQ-1' },
    { externalId: '7', createdAt: '2026-10-05T10:00:00Z', equipmentExternalId: 'EQ-2' },
    { externalId: '120', createdAt: '2026-10-04T10:00:00Z', equipmentExternalId: 'EQ-3' },
    { externalId: '119', createdAt: '2026-10-03T10:00:00Z', equipmentExternalId: 'EQ-1' },
    { externalId: '118', createdAt: '2026-10-02T10:00:00Z', equipmentExternalId: 'EQ-4' },
    { externalId: '117', createdAt: '2026-10-01T10:00:00Z', equipmentExternalId: 'EQ-2' },
    { externalId: '116', createdAt: '2026-09-30T10:00:00Z', equipmentExternalId: 'EQ-1' },
  ];

  const result = selectPreviousServiceOrders(orders, {
    currentOrderIds: ['8000', 'current-uuid'],
  });

  assert.deepEqual(result.map((order) => order.externalId), ['7', '120', '119', '118', '117']);
});

test('sorts Firebird Brazilian dates as day/month/year', () => {
  const result = selectPreviousServiceOrders([
    { externalId: '403', createdAt: '15/02/2026 08:00:00' },
    { externalId: '401', createdAt: '03/04/2026 08:00:00' },
    { externalId: '402', createdAt: '10/03/2026 08:00:00' },
  ]);

  assert.deepEqual(result.map((order) => order.externalId), ['401', '402', '403']);
});

test('uses the separate opening time when Firebird gives a date without time', () => {
  const result = selectPreviousServiceOrders([
    { externalId: '501', createdAt: '10/06/2026', time: '09:00' },
    { externalId: '502', createdAt: '10/06/2026', time: '15:30' },
  ]);

  assert.deepEqual(result.map((order) => order.externalId), ['502', '501']);
});
