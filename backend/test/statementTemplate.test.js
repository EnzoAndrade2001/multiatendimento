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
  externalId: '14719',
  period: '2026/08',
  statementDate: '2026-08-20T00:00:00',
  dueDate: '2026-09-10T00:00:00',
  invoiceNumber: '14743',
  customerExternalId: '1505',
  totalValue: 220,
  fixedValue: 220,
  excessValue: 0,
  discountValue: 0,
  surchargeValue: 0,
  notes: null,
  lines: [
    {
      lineNo: 0, contractExternalId: '652', contractNumber: '2134',
      equipmentName: 'MULTIFUNCIONAL BROTHER DCP T730W', equipmentExternalId: '2140',
      equipmentModel: 'BROTHER T730', equipmentSerial: 'U67686A6H062656',
      equipmentAsset: 'LCD DIGITAL', meterCode: 'CORA4',
      periodStart: '2026-08-14T00:00:00', periodEnd: '2026-08-20T00:00:00', readingDate: null,
      meterStart: 1, meterEnd: 1, meterDiscount: 0,
      qtyProduction: 0, qtyFranchise: 1, qtyExcess: 0,
      franchiseValue: 220, excessValue: 0, franchiseCharged: 220, excessCharged: 0,
      invoiceValue: 0, discountValue: 0, surchargeValue: 0, isProrated: false,
    },
  ],
};

const model = {
  statement: baseStatement,
  company: { name: 'CLAUDIA CARDINALI LTDA', tradeName: 'LCD DIGITAL', cnpj: '35.692.721/0001-94', stateRegistration: '0963799100', city: 'Porto Alegre', state: 'RS' },
  customer: { name: 'ANDERSON LUIZ D AVILA VAZ', code: '1505', document: '44.058.952/0001-31', address: 'RUA PATRIMONIO', number: '241', neighborhood: 'CORONEL APARICIO', city: 'PORTO ALEGRE', state: 'RS', zipCode: '91710300', phone: '90163088', stateRegistration: '8001481474' },
  accentColor: '#D62828',
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

test('layout iLux: paisagem, titulo "DO FATURAMENTO", colunas e Quadro Resumo Contrato', () => {
  const doc = buildStatementDocDefinition(model);
  assert.equal(doc.pageOrientation, 'landscape');
  const text = flattenText(doc.content).join(' | ');
  assert.match(text, /DEMONSTRATIVO DO FATURAMENTO/);
  assert.match(text, /Período: 2026\/08/);
  assert.match(text, /LCD DIGITAL/);
  assert.match(text, /ANDERSON LUIZ D AVILA VAZ/);
  assert.match(text, /Demost\.: 14719/);
  assert.match(text, /Contrato \(Seq \/ Nr\): 652 \/ 2134/);
  // colunas do iLux
  assert.match(text, /Val\.Franquia\/Taxa Fixa/);
  assert.match(text, /Excedente\/Produção\(mil\)/);
  assert.match(text, /Val\.Excedido\/Produzido/);
  // secao de equipamento + quadro resumo
  assert.match(text, /Equipamento 2140/);
  assert.match(text, /Patrimônio: LCD DIGITAL/);
  assert.match(text, /Série: U67686A6H062656/);
  assert.match(text, /Quadro Resumo Contrato/);
  assert.match(text, /Total Contrato:/);
  // valores: franquia cobrada 220,00 e total 220,0000 (4 casas como o iLux)
  assert.match(text, /220,00/);
  assert.match(text, /220,0000/);
});

test('um so contrato -> nao mostra bloco "TOTAL DO DEMONSTRATIVO" (Total Contrato ja e o total)', () => {
  const text = flattenText(buildStatementDocDefinition(model).content).join(' | ');
  assert.doesNotMatch(text, /TOTAL DO DEMONSTRATIVO/);
});

test('multi-contrato -> mostra o bloco de total geral', () => {
  const multi = {
    ...model,
    statement: {
      ...baseStatement,
      totalValue: 440, fixedValue: 440,
      lines: [
        { ...baseStatement.lines[0], lineNo: 0, contractExternalId: '652' },
        { ...baseStatement.lines[0], lineNo: 1, contractExternalId: '999', equipmentExternalId: '3000', franchiseCharged: 220 },
      ],
    },
  };
  const text = flattenText(buildStatementDocDefinition(multi).content).join(' | ');
  assert.match(text, /TOTAL DO DEMONSTRATIVO/);
  assert.match(text, /440,00/);
});

test('header-only (sem linhas) mostra aviso e nao quebra', () => {
  const doc = buildStatementDocDefinition({
    ...model,
    statement: { ...baseStatement, lines: [], totalValue: 6168.25, fixedValue: 858.33, excessValue: 5309.92 },
  });
  const text = flattenText(doc.content).join(' | ');
  assert.match(text, /não detalha produção/i);
  assert.match(text, /Demost\.: 14719/);
});
