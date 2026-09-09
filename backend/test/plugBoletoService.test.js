process.env.PRINTGUARD_ENCRYPTION_KEY = process.env.PRINTGUARD_ENCRYPTION_KEY || 'a'.repeat(64);
process.env.PLUGBOLETO_POLL_MS = '5';

const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const prisma = require('../src/lib/prisma');
const { encryptSecret } = require('../src/services/printGuardCrypto');
const svc = require('../src/services/plugBoletoService');

const PDF = Buffer.from('%PDF-1.4\n...\n%%EOF');

function patchSettings(context, row) {
  const original = prisma.tenantSettings.findUnique;
  context.after(() => { prisma.tenantSettings.findUnique = original; });
  prisma.tenantSettings.findUnique = async () => row;
}

function patchAxios(context, { get, post } = {}) {
  const og = { get: axios.get, post: axios.post };
  context.after(() => { axios.get = og.get; axios.post = og.post; });
  axios.get = get || (async () => { throw new Error('GET nao esperado'); });
  axios.post = post || (async () => { throw new Error('POST nao esperado'); });
}

const validRow = () => ({
  plugBoletoEnabled: true,
  plugBoletoBaseUrl: 'https://plugboleto.com.br/api/v1',
  plugBoletoPrintPath: '/boletos/impressao/lote',
  plugBoletoCedenteCnpj: '35.692.721/0001-94',
  plugBoletoTokenCipher: encryptSecret('token-secreto-123'),
});

test('isBoletoPrintable: status imprimivel + protocolo/chave', () => {
  assert.equal(svc.isBoletoPrintable({ boletoStatus: 'EMITIDO', boletoPdfProtocol: 'p1' }), true);
  assert.equal(svc.isBoletoPrintable({ boletoStatus: '', boletoIntegrationId: 'c1' }), true);
  assert.equal(svc.isBoletoPrintable({ boletoStatus: 'BAIXADO', boletoPdfProtocol: 'p1' }), false);
  assert.equal(svc.isBoletoPrintable({ boletoStatus: 'EMITIDO' }), false);
  assert.equal(svc.isBoletoPrintable(null), false);
});

test('resolveConfig: null quando desligado, sem token ou sem cnpj', async (context) => {
  patchSettings(context, { ...validRow(), plugBoletoEnabled: false });
  assert.equal(await svc.resolveConfig('t1'), null);
});

test('resolveConfig: config valida monta endpoint e headers', async (context) => {
  patchSettings(context, validRow());
  const cfg = await svc.resolveConfig('t1');
  assert.equal(cfg.endpoint, 'https://plugboleto.com.br/api/v1/boletos/impressao/lote');
  assert.equal(cfg.headers['cnpj-cedente'], '35692721000194');
  assert.equal(cfg.headers['token-cedente'], 'token-secreto-123');
});

test('fetchBoletoPdf: protocolo em cache -> GET devolve %PDF', async (context) => {
  patchSettings(context, validRow());
  let seenUrl = null;
  let seenHeaders = null;
  patchAxios(context, {
    get: async (url, opts) => { seenUrl = url; seenHeaders = opts.headers; return { data: PDF }; },
  });
  const out = await svc.fetchBoletoPdf({
    tenantId: 't1',
    receivable: { boletoStatus: 'EMITIDO', boletoPdfProtocol: 'PROTO-9', invoiceNumber: '4321', externalId: '99' },
    customerName: 'Acme Ltda',
  });
  assert.equal(out.documentType, 'boleto');
  assert.equal(out.source, 'plugboleto');
  assert.equal(Buffer.from(out.pdfBase64, 'base64').toString('utf8').startsWith('%PDF'), true);
  assert.match(seenUrl, /\/boletos\/impressao\/lote\/PROTO-9$/);
  assert.equal(seenHeaders['token-cedente'], 'token-secreto-123');
  assert.match(out.fileName, /^BOLETO 4321 - ACME LTDA\.pdf$/);
});

test('fetchBoletoPdf: sem protocolo -> POST pega protocolo, depois GET', async (context) => {
  patchSettings(context, validRow());
  let posted = null;
  patchAxios(context, {
    post: async (url, body) => { posted = body; return { data: { _dados: { protocolo: 'NEW-1' } } }; },
    get: async (url) => (url.endsWith('/NEW-1') ? { data: PDF } : { data: Buffer.from('{}') }),
  });
  const out = await svc.fetchBoletoPdf({
    tenantId: 't1',
    receivable: { boletoStatus: 'REGISTRADO', boletoIntegrationId: 'CHAVE-7' },
    customerName: 'Cliente',
  });
  assert.deepEqual(posted, { TipoImpressao: '0', Boletos: ['CHAVE-7'] });
  assert.equal(Buffer.from(out.pdfBase64, 'base64').toString('utf8').startsWith('%PDF'), true);
});

test('fetchBoletoPdf: status nao imprimivel -> 409', async (context) => {
  patchSettings(context, validRow());
  patchAxios(context, {});
  await assert.rejects(
    () => svc.fetchBoletoPdf({ tenantId: 't1', receivable: { boletoStatus: 'BAIXADO', boletoPdfProtocol: 'p' } }),
    (e) => e.statusCode === 409,
  );
});

test('fetchBoletoPdf: sem config -> 501 (fluxo cai para o agente)', async (context) => {
  patchSettings(context, { ...validRow(), plugBoletoEnabled: false });
  await assert.rejects(
    () => svc.fetchBoletoPdf({ tenantId: 't1', receivable: { boletoStatus: 'EMITIDO', boletoPdfProtocol: 'p' } }),
    (e) => e.statusCode === 501,
  );
});

test('fetchBoletoPdf: servico devolve erro JSON -> lanca com a mensagem', async (context) => {
  patchSettings(context, validRow());
  patchAxios(context, {
    get: async () => ({ data: Buffer.from(JSON.stringify({ _mensagem: 'Boleto nao encontrado' })) }),
  });
  await assert.rejects(
    () => svc.fetchBoletoPdf({ tenantId: 't1', receivable: { boletoStatus: 'EMITIDO', boletoPdfProtocol: 'p' } }),
    /Boleto nao encontrado/,
  );
});
