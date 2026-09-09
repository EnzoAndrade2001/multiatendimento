const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStatementDocDefinition, lineValue, normalizeAccent } = require('../src/templates/statementTemplate');

function flattenText(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { if (node.trim()) out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => flattenText(n, out)); return out; }
  if (typeof node === 'object') {
    if (typeof node.text === 'string') out.push(node.text);
    else if (node.text) flattenText(node.text, out);
    for (const key of ['stack', 'columns', 'table', 'body', 'ul', 'ol']) {
      if (node[key]) flattenText(node[key], out);
    }
  }
  return out;
}

const baseStatement = {
  externalId: '14893',
  period: '2026/08',
  statementDate: '2026-09-04T00:00:00',
  dueDate: '2026-09-22T00:00:00',
  invoiceNumber: '14894',
  customerExternalId: '107',
  totalValue: 2075.35,
  fixedValue: 1080,
  excessValue: 995.35,
  discountValue: 0,
  surchargeValue: 0,
  notes: null,
  lines: [
    {
      lineNo: 0, contractExternalId: '585', equipmentName: 'MULTIFUNCIONAL XEROX', equipmentExternalId: '333',
      equipmentSerial: 'ABC', meterCode: 'PBA4', installLocation: 'RECEPCAO',
      periodStart: '2026-07-21T00:00:00', periodEnd: '2026-08-20T00:00:00',
      meterStart: 615734, meterEnd: 620123, qtyProduction: 4389, qtyFranchise: 23000, qtyExcess: 0,
      franchiseCharged: 405, excessCharged: 0, invoiceValue: 0, isProrated: false,
    },
    {
      lineNo: 1, contractExternalId: '585', equipmentName: 'IMPRESSORA CORA', equipmentExternalId: '335',
      meterCode: 'CORA4', periodStart: '2026-07-21T00:00:00', periodEnd: '2026-08-20T00:00:00',
      meterStart: 94642, meterEnd: 96142, qtyProduction: 1500, qtyFranchise: 700, qtyExcess: 868,
      franchiseCharged: 135, excessCharged: 150, invoiceValue: 0, isProrated: true,
    },
  ],
};

test('normalizeAccent valida #RRGGBB e cai para o vermelho padrao', () => {
  assert.equal(normalizeAccent('#1d4ed8'), '#1D4ED8');
  assert.equal(normalizeAccent('azul'), '#D62828');
  assert.equal(normalizeAccent(null), '#D62828');
});

test('lineValue usa franquia+excedente cobrados (COB)', () => {
  assert.equal(lineValue({ franchiseCharged: 405, excessCharged: 130.2 }), 535.2);
  assert.equal(lineValue({ franchiseCharged: 0, excessCharged: 0, invoiceValue: 90 }), 90);
  assert.equal(lineValue({ franchiseCharged: 0, excessCharged: 0, invoiceValue: 0 }), 0);
});

test('buildStatementDocDefinition monta um demonstrativo com linhas e totais', () => {
  const doc = buildStatementDocDefinition({
    statement: baseStatement,
    company: { name: 'MINHA EMPRESA LTDA', cnpj: '12.345.678/0001-90' },
    customer: { name: 'CLIENTE TESTE', code: '107', document: '99.999.999/0001-99' },
    accentColor: '#1D4ED8',
  });
  const text = flattenText(doc.content).join(' | ');
  assert.match(text, /DEMONSTRATIVO DE FATURAMENTO/);
  assert.match(text, /2026\/08/);
  assert.match(text, /MINHA EMPRESA LTDA/);
  assert.match(text, /CLIENTE TESTE/);
  assert.match(text, /QUADRO RESUMO/);
  assert.match(text, /MULTIFUNCIONAL XEROX/);
  assert.match(text, /TOTAL DO DEMONSTRATIVO/);
  // total = 2.075,35 formatado pt-BR
  assert.match(text, /2\.075,35/);
  assert.match(text, /1\.080,00/); // valor fixo
  assert.match(text, /995,35/); // excedentes
  assert.equal(doc.defaultStyle.font, 'Roboto');
});

test('header-only (sem linhas) mostra aviso e total', () => {
  const doc = buildStatementDocDefinition({
    statement: { ...baseStatement, lines: [], totalValue: 6168.25, fixedValue: 858.33, excessValue: 5309.92 },
    company: {}, customer: { name: 'X' }, accentColor: '#D62828',
  });
  const text = flattenText(doc.content).join(' | ');
  assert.match(text, /sem detalhamento de produção/i);
  assert.match(text, /6\.168,25/);
});

test('desconto/acrescimo do header NAO entram no bloco de totais', () => {
  // A reconciliacao e fixo + excedente == total; VALDESCONTO/VALACRESCIMO do
  // header sao do boleto, nao do demonstrativo -- exibi-los sugeriria subtracao.
  const doc = buildStatementDocDefinition({
    statement: { ...baseStatement, discountValue: 430.6, surchargeValue: 10 },
    company: {}, customer: { name: 'X' },
  });
  const t1 = flattenText(doc.content).join(' | ');
  assert.doesNotMatch(t1, /Descontos/);
  assert.doesNotMatch(t1, /Acréscimos/);
  assert.match(t1, /TOTAL DO DEMONSTRATIVO/);
});
