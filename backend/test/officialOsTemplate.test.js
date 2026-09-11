const test = require('node:test');
const assert = require('node:assert/strict');
const { renderOfficialOsTemplate } = require('../src/templates/officialOsTemplate');

const base = {
  number: '123',
  company: { brand: 'Softilux Sistemas', name: 'SOFTILUX DESENVOLVIMENTO DE SISTEMAS' },
  client: {}, equipment: {}, visit: {}, history: [],
};

test('usa a cor de destaque da empresa no cabecalho e nas faixas', () => {
  const html = renderOfficialOsTemplate({ ...base, accentColor: '#1D4ED8', accentTextColor: '#FFFFFF' });
  assert.match(html, /\.section-title-red \{ background: #1D4ED8;/);
  assert.match(html, /\.logo-fallback \{ width: 15mm; color: #1D4ED8;/);
  assert.match(html, /border-left: 3px solid #1D4ED8/);
  assert.doesNotMatch(html, /#c62828/i); // o vermelho padrao nao aparece mais
});

test('cor invalida cai para o vermelho padrao', () => {
  const html = renderOfficialOsTemplate({ ...base, accentColor: 'azul' });
  assert.match(html, /\.section-title-red \{ background: #C62828;/);
});

test('logo de texto usa as iniciais da marca, nao "LCD"', () => {
  const html = renderOfficialOsTemplate({ ...base }); // sem logoDataUri
  assert.match(html, /<span class="logo-fallback">SS<\/span>/); // Softilux Sistemas
  assert.doesNotMatch(html, />LCD</);
});

test('sem marca, o logo de texto cai para "OS"', () => {
  const html = renderOfficialOsTemplate({ ...base, company: {} });
  assert.match(html, /<span class="logo-fallback">OS<\/span>/);
});

test('exibe Code 128 com o numero da O.S. por padrao', () => {
  const html = renderOfficialOsTemplate(base);
  assert.match(html, /class="os-barcode"/);
  assert.match(html, /aria-label="Código de barras da O\.S\. 123"/);
  assert.match(html, /<svg[^>]+viewBox=/);
  assert.match(html, /data-barcode-value="123"/);
});

test('permite desativar o codigo de barras na configuracao', () => {
  const html = renderOfficialOsTemplate({ ...base, barcodeEnabled: false });
  assert.doesNotMatch(html, /class="os-barcode"/);
  assert.doesNotMatch(html, /<svg/);
});
