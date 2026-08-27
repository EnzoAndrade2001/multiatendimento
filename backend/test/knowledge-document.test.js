const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { buildPdfPageRanges, chunkPages, extractPdfPagesInBatches, formatProcessingError, validateSignature } = require('../src/services/knowledgeDocumentService');

function buildSearchablePdf(pageCount) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const parts = [];
    doc.on('data', (chunk) => parts.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);
    for (let page = 1; page <= pageCount; page += 1) {
      doc.addPage();
      doc.fontSize(12).text(`MARCADOR_PAGINA_${page} conteudo pesquisavel do manual para indexacao.`, 72, 72);
    }
    doc.end();
  });
}

test('valida assinatura real do PDF e rejeita arquivo disfarçado', () => {
  assert.equal(validateSignature(Buffer.from('%PDF-1.7 arquivo'), 'application/pdf'), true);
  assert.equal(validateSignature(Buffer.from('arquivo executável'), 'application/pdf'), false);
});

test('divide manual extenso preservando página e ordem', () => {
  const chunks = chunkPages([{ page: 7, text: `ERRO SC 542\n${'Procedimento técnico aprovado. '.repeat(220)}` }]);
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.map((item) => item.position), chunks.map((_, index) => index));
  assert.ok(chunks.every((item) => item.pageStart === 7 && item.pageEnd === 7));
  assert.match(chunks[0].section, /ERRO SC 542/);
});

test('aceita apenas imagens com assinatura compatível', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.equal(validateSignature(png, 'image/png'), true);
  assert.equal(validateSignature(Buffer.from('not png'), 'image/png'), false);
});

test('nao expoe detalhes internos do banco ao falhar processamento', () => {
  const message = formatProcessingError(new Error('Invalid tx.knowledgeChunk.createMany() invocation: Transaction already closed'));
  assert.match(message, /limite de segurança/i);
  assert.doesNotMatch(message, /createMany|Transaction/i);
});

test('preserva orientacao segura e acionavel para arquivo grande sem texto', () => {
  const error = new Error('O arquivo nao possui texto pesquisavel. Envie um PDF pesquisavel ou divida o manual.');
  error.publicMessage = true;
  assert.match(formatProcessingError(error), /PDF pesquisavel/i);
});

test('divide PDF extenso em intervalos pequenos sem perder paginas', () => {
  assert.deepEqual(buildPdfPageRanges(31, 12), [
    { first: 1, last: 12 },
    { first: 13, last: 24 },
    { first: 25, last: 31 },
  ]);
  assert.deepEqual(buildPdfPageRanges(0, 12), []);
});

test('extrai PDF pesquisavel em lotes cobrindo todas as paginas em ordem', async () => {
  const pdf = await buildSearchablePdf(15);
  const { pageCount, pages } = await extractPdfPagesInBatches(pdf, 6);

  assert.equal(pageCount, 15);
  assert.equal(pages.length, 15);
  assert.deepEqual(pages.map((item) => item.page), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.ok(pages.every((item) => item.text.includes(`MARCADOR_PAGINA_${item.page}`)));
});
