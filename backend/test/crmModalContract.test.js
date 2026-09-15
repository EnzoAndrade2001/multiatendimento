const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseHistoryPagination,
  paginateServiceOrders,
  getCrmCapabilities,
  syncMetadata,
  isServiceOrderAwaitingAttendance,
} = require('../src/controllers/crmController');

test('paginacao de O.S. usa limites seguros e offset explicito', () => {
  assert.deepEqual(parseHistoryPagination({}), { limit: 25, offset: 0 });
  assert.deepEqual(parseHistoryPagination({ limit: '500', offset: '-8' }), { limit: 100, offset: 0 });
  assert.deepEqual(parseHistoryPagination({ limit: '10', offset: '30' }), { limit: 10, offset: 30 });
  assert.deepEqual(parseHistoryPagination({ limit: 'abc', offset: 'abc' }), { limit: 25, offset: 0 });
});

test('pagina informa total real, hasMore e proximo offset', () => {
  const orders = Array.from({ length: 27 }, (_, index) => ({ id: index + 1 }));
  const first = paginateServiceOrders(orders, { limit: 10, offset: 0 });
  assert.equal(first.total, 27);
  assert.equal(first.items.length, 10);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 10);

  const last = paginateServiceOrders(orders, { limit: 10, offset: 20 });
  assert.equal(last.items.length, 7);
  assert.equal(last.hasMore, false);
  assert.equal(last.nextOffset, null);
});

test('capacidades do modal refletem permissoes sem ampliar acesso', () => {
  const basic = getCrmCapabilities({ role: 'agent', permissions: ['crm.view', 'inbox.view'] });
  assert.equal(basic.tabs.serviceOrders, true);
  assert.equal(basic.tabs.financial, false);
  assert.equal(basic.actions.openConversation, true);
  assert.equal(basic.actions.createServiceOrder, false);
  assert.equal(basic.actions.sendFinancialDocuments, false);

  const financial = getCrmCapabilities({
    role: 'agent',
    permissions: ['crm.view', 'crm.financial.view', 'crm.financial.send'],
  });
  assert.equal(financial.tabs.financial, true);
  assert.equal(financial.actions.sendFinancialDocuments, true);

  const admin = getCrmCapabilities({ role: 'admin', permissions: [] });
  assert.equal(Object.values(admin.tabs).every(Boolean), true);
  assert.equal(Object.values(admin.actions).every(Boolean), true);
});

test('metadados de sincronizacao tem formato estavel e fallback seguro', () => {
  const metadata = syncMetadata({
    firebirdLastSyncStatus: 'online',
    firebirdLastSyncAt: new Date('2026-08-21T12:00:00Z'),
    firebirdLastSyncError: null,
  });
  assert.equal(metadata.source, 'firebird');
  assert.equal(metadata.status, 'online');
  assert.equal(metadata.lastSyncedAt, '2026-08-21T12:00:00.000Z');
  assert.equal(metadata.error, null);

  assert.deepEqual(syncMetadata(null, '2026-08-20T10:00:00.000Z'), {
    source: 'firebird', status: 'ok', lastSyncedAt: '2026-08-20T10:00:00.000Z', error: null,
  });
});

test('card operacional conta somente O.S. que ainda aguardam atendimento', () => {
  assert.equal(isServiceOrderAwaitingAttendance({ status: 'PENDENTE', attendedAt: null }), true);
  assert.equal(isServiceOrderAwaitingAttendance({ status: 'EM_ATENDIMENTO', attendedAt: '2026-09-14T10:00:00Z' }), false);
  assert.equal(isServiceOrderAwaitingAttendance({ status: 'PENDENTE', resolvedAt: new Date() }), false);
  assert.equal(isServiceOrderAwaitingAttendance({ status: 'FINALIZADA', attendedAt: null }), false);
});
