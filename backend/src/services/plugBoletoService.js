const axios = require('axios');
const prisma = require('../lib/prisma');
const { decryptSecret } = require('./printGuardCrypto');

// PlugBoleto (TecnoSpeed) - impressao de boleto direto pela API, sem a pasta
// monitorada. Espelha o fluxo que o agente ja faz em fetch_billing_pdf:
//   GET  {endpoint}/{protocolo}                     (protocolo em cache no titulo)
//   POST {endpoint} {TipoImpressao,Boletos:[chave]} -> {_dados:{protocolo}}  (fallback)
// A resposta e um PDF (%PDF) ou um JSON com _dados.situacao = PROCESSANDO.

const PRINTABLE_STATUSES = new Set(['EMITIDO', 'REGISTRADO', 'LIQUIDADO']);
const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = Number(process.env.PLUGBOLETO_POLL_MS) > 0 ? Number(process.env.PLUGBOLETO_POLL_MS) : 5000;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function billingError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

// A instalacao pode nao ter PlugBoleto configurado (fallback continua sendo o
// agente/pasta). Retorna null nesse caso, nunca lanca.
async function resolveConfig(tenantId) {
  let settings;
  try {
    settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        plugBoletoEnabled: true,
        plugBoletoBaseUrl: true,
        plugBoletoPrintPath: true,
        plugBoletoCedenteCnpj: true,
        plugBoletoTokenCipher: true,
      },
    });
  } catch (error) {
    console.error('[plugboleto] falha ao ler config:', error.message);
    return null;
  }
  if (!settings || !settings.plugBoletoEnabled) return null;

  const cnpj = String(settings.plugBoletoCedenteCnpj || '').replace(/\D/g, '');
  let token = null;
  try {
    token = settings.plugBoletoTokenCipher ? decryptSecret(settings.plugBoletoTokenCipher) : null;
  } catch (error) {
    console.error('[plugboleto] token cifrado invalido:', error.message);
    return null;
  }
  if (!cnpj || !token) return null;

  const base = String(settings.plugBoletoBaseUrl || '').trim().replace(/\/+$/, '');
  const printPath = `/${String(settings.plugBoletoPrintPath || '').trim().replace(/^\/+|\/+$/g, '')}`;
  if (!/^https:\/\//i.test(base) || printPath === '/') return null;

  return {
    endpoint: `${base}${printPath}`,
    headers: {
      'Content-Type': 'application/json',
      'cnpj-cedente': cnpj,
      'token-cedente': token,
    },
  };
}

// O CRM tem os dados para tentar o PlugBoleto? (status imprimivel + chave ou
// protocolo). Nao considera a config - quem checa isso e fetchBoletoPdf.
function isBoletoPrintable(receivable) {
  if (!receivable) return false;
  const status = normalizeStatus(receivable.boletoStatus);
  if (status && !PRINTABLE_STATUSES.has(status)) return false;
  return Boolean(receivable.boletoPdfProtocol || receivable.boletoIntegrationId);
}

function boletoFileName(receivable, customerName) {
  const invoice = String(
    receivable.invoiceNumber || receivable.ourNumber || receivable.externalId || 'SEM-NUMERO',
  ).replace(/[^A-Za-z0-9_-]+/g, '');
  const customer = String(customerName || 'CLIENTE')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 70) || 'CLIENTE';
  return `BOLETO ${invoice} - ${customer}.pdf`;
}

async function requestPrintProtocol(config, integrationId) {
  if (!integrationId) {
    throw billingError('Boleto sem chave de integracao no iLux para gerar o PDF.', 409);
  }
  const response = await axios.post(
    config.endpoint,
    { TipoImpressao: '0', Boletos: [String(integrationId).trim()] },
    { headers: config.headers, timeout: REQUEST_TIMEOUT_MS, responseType: 'json', validateStatus: () => true },
  );
  const protocolo = response.data && response.data._dados && response.data._dados.protocolo;
  if (!protocolo) {
    const message = (response.data && response.data._mensagem) || 'A geracao do PDF do boleto nao retornou protocolo.';
    throw billingError(message);
  }
  return String(protocolo).trim();
}

async function downloadByProtocol(config, protocolo) {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const response = await axios.get(`${config.endpoint}/${encodeURIComponent(protocolo)}`, {
      headers: config.headers,
      timeout: REQUEST_TIMEOUT_MS,
      responseType: 'arraybuffer',
      validateStatus: () => true,
    });
    const body = Buffer.from(response.data || []);
    if (body.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      if (body.length > MAX_PDF_BYTES) throw billingError('O PDF do boleto excedeu o limite de 20 MB.', 413);
      return body;
    }
    // Nao e PDF -> deve ser JSON (PROCESSANDO ou erro).
    let parsed = null;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw billingError('O servico bancario nao devolveu um PDF valido para o boleto.');
    }
    const situacao = normalizeStatus(parsed && parsed._dados && parsed._dados.situacao);
    if (situacao !== 'PROCESSANDO' || attempt === POLL_ATTEMPTS) {
      throw billingError((parsed && parsed._mensagem) || 'Nao foi possivel recuperar o PDF do boleto no PlugBoleto.');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw billingError('O PDF do boleto nao ficou pronto no tempo esperado.', 504);
}

// Busca o PDF do boleto no PlugBoleto. Lanca (com .statusCode) se nao der -
// quem chama trata como "cai para o agente/pasta".
async function fetchBoletoPdf({ tenantId, receivable, customerName }) {
  const config = await resolveConfig(tenantId);
  if (!config) throw billingError('PlugBoleto nao configurado para esta empresa.', 501);

  const status = normalizeStatus(receivable.boletoStatus);
  if (status && !PRINTABLE_STATUSES.has(status)) {
    throw billingError(`Boleto ainda nao pode ser impresso. Situacao: ${status || 'nao informada'}.`, 409);
  }

  const protocolo = String(receivable.boletoPdfProtocol || '').trim()
    || (await requestPrintProtocol(config, receivable.boletoIntegrationId));

  const pdf = await downloadByProtocol(config, protocolo);
  return {
    pdfBase64: pdf.toString('base64'),
    fileName: boletoFileName(receivable, customerName),
    mimeType: 'application/pdf',
    documentType: 'boleto',
    source: 'plugboleto',
  };
}

module.exports = {
  resolveConfig,
  isBoletoPrintable,
  fetchBoletoPdf,
  PRINTABLE_STATUSES,
};
