// Re-render do demonstrativo pelo CRM (Fase 2 "faturamento sem a pasta").
// Espelha tryPlugBoletoDirect: quando o tenant tem statementRerenderEnabled e o
// demonstrativo ja foi sincronizado (CrmBillingStatement), o CRM gera o PDF a
// partir desses valores -- sem a pasta monitorada e sem round-trip com o agente.
// Falha/desligado -> billingError(..., 501) e o fluxo cai para o agente/pasta.

const path = require('path');
const pdfmake = require('pdfmake');
const prisma = require('../lib/prisma');
const { getLatestCompanyProfile } = require('./companyProfileService');
const { buildStatementDocDefinition } = require('../templates/statementTemplate');

const MAX_PDF_BYTES = 20 * 1024 * 1024;
let fontsReady = false;

function billingError(message, statusCode = 502) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(__dirname, '..', '..', 'node_modules', 'pdfmake', 'fonts', 'Roboto');
  pdfmake.setFonts({
    Roboto: {
      normal: path.join(dir, 'Roboto-Regular.ttf'),
      bold: path.join(dir, 'Roboto-Medium.ttf'),
      italics: path.join(dir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(dir, 'Roboto-MediumItalic.ttf'),
    },
  });
  fontsReady = true;
}

function renderToBuffer(docDefinition) {
  ensureFonts();
  return new Promise((resolve, reject) => {
    let stream;
    try {
      const doc = pdfmake.createPdf(docDefinition);
      Promise.resolve(doc.getStream()).then((s) => {
        stream = s;
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.once('error', reject);
        stream.once('end', () => resolve(Buffer.concat(chunks)));
        stream.end();
      }).catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}

function safePart(value, fallback) {
  return String(value || fallback || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 90) || fallback;
}

// Localiza o demonstrativo sincronizado que corresponde ao titulo. Preferimos o
// vinculo direto por receivableExternalId; caindo para o SEQDEMONSTRATIVO que o
// titulo carrega (statementExternalId).
async function resolveStatement(tenantId, receivable = {}) {
  const receivableId = receivable.externalId != null ? String(receivable.externalId) : null;
  const statementId = receivable.statementExternalId != null ? String(receivable.statementExternalId) : null;

  const or = [];
  if (receivableId) or.push({ receivableExternalId: receivableId });
  if (statementId) or.push({ externalId: statementId });
  if (!or.length) return null;

  return prisma.crmBillingStatement.findFirst({
    where: { tenantId, externalSource: 'ilux_web', OR: or },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { syncedAt: 'desc' },
  });
}

async function isStatementRerenderable(tenantId, receivable) {
  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { statementRerenderEnabled: true },
    });
    if (!settings?.statementRerenderEnabled) return false;
    const statement = await resolveStatement(tenantId, receivable);
    return Boolean(statement);
  } catch (error) {
    console.error('[statement-rerender] verificacao falhou:', error.message);
    return false;
  }
}

async function loadCustomer(tenantId, receivable = {}, statement = {}, customerName) {
  const externalId = statement.customerExternalId || receivable.customerExternalId || null;
  let crmCustomer = null;
  if (externalId) {
    crmCustomer = await prisma.crmCustomer.findFirst({
      where: { tenantId, externalSource: 'ilux_web', externalId: String(externalId) },
      select: {
        name: true, fantasyName: true, cpfCnpj: true, address: true,
        neighborhood: true, city: true, state: true, zipCode: true, phone: true,
      },
    });
  }
  return {
    name: customerName || crmCustomer?.name || receivable.customerName || 'Cliente',
    code: externalId || '',
    document: crmCustomer?.cpfCnpj || receivable.customerDocument || '',
    address: crmCustomer?.address || '',
    number: '',
    neighborhood: crmCustomer?.neighborhood || '',
    city: crmCustomer?.city || '',
    state: crmCustomer?.state || '',
    zipCode: crmCustomer?.zipCode || '',
    phone: crmCustomer?.phone || '',
    stateRegistration: '',
  };
}

// Enriquece as linhas do demonstrativo com o numero do contrato (CrmContract) e
// o patrimonio do equipamento (CrmEquipment) -- campos que o iLux mostra e que
// nao estao em CrmBillingStatementLine. Uma consulta por tipo, nao por linha.
async function enrichLines(tenantId, lines = []) {
  const contractIds = [...new Set(lines.map((l) => l.contractExternalId).filter(Boolean).map(String))];
  const equipIds = [...new Set(lines.map((l) => l.equipmentExternalId).filter(Boolean).map(String))];

  const [contracts, equipments] = await Promise.all([
    contractIds.length
      ? prisma.crmContract.findMany({
        where: { tenantId, externalSource: 'ilux_web', externalId: { in: contractIds } },
        select: { externalId: true, number: true },
      })
      : [],
    equipIds.length
      ? prisma.crmEquipment.findMany({
        where: { tenantId, externalSource: 'ilux_web', externalId: { in: equipIds } },
        select: { externalId: true, assetTag: true, model: true, serialNumber: true },
      })
      : [],
  ]);
  const contractBy = new Map(contracts.map((c) => [String(c.externalId), c]));
  const equipBy = new Map(equipments.map((e) => [String(e.externalId), e]));

  return lines.map((l) => {
    const c = contractBy.get(String(l.contractExternalId));
    const e = equipBy.get(String(l.equipmentExternalId));
    return {
      ...l,
      contractNumber: c?.number || null,
      equipmentAsset: e?.assetTag || null,
      equipmentName: l.equipmentName || e?.model || null,
      equipmentModel: l.equipmentModel || e?.model || null,
      equipmentSerial: l.equipmentSerial || e?.serialNumber || null,
    };
  });
}

async function loadCompany(tenantId) {
  const profile = await getLatestCompanyProfile(tenantId).catch(() => null);
  if (profile) return profile;
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      companyName: true, companyCnpj: true, companyIE: true, companyAddress: true,
      companyBairro: true, companyCep: true, companyCity: true, companyState: true, companyPhone: true,
    },
  }).catch(() => null);
  if (!settings) return {};
  return {
    name: settings.companyName,
    tradeName: settings.companyName,
    cnpj: settings.companyCnpj,
    stateRegistration: settings.companyIE,
    address: settings.companyAddress,
    addressFull: settings.companyAddress,
    neighborhood: settings.companyBairro,
    zipCode: settings.companyCep,
    city: settings.companyCity,
    state: settings.companyState,
    phone: settings.companyPhone,
  };
}

/**
 * Gera o PDF do demonstrativo a partir de CrmBillingStatement.
 * Lanca billingError(..., 501) quando o re-render nao se aplica (flag desligada
 * ou demonstrativo nao sincronizado) -- o chamador entao cai para o agente.
 */
async function renderStatementPdf({ tenantId, receivable, customerName }) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { statementRerenderEnabled: true, osAccentColor: true },
  });
  if (!settings?.statementRerenderEnabled) {
    throw billingError('Re-render de demonstrativo desativado para este tenant.', 501);
  }

  const statement = await resolveStatement(tenantId, receivable);
  if (!statement) {
    throw billingError('Demonstrativo ainda nao sincronizado do ILUX WEB para este titulo.', 501);
  }

  const [company, customer, lines] = await Promise.all([
    loadCompany(tenantId),
    loadCustomer(tenantId, receivable, statement, customerName),
    enrichLines(tenantId, statement.lines || []),
  ]);

  const docDefinition = buildStatementDocDefinition({
    statement,
    lines,
    company,
    customer,
    accentColor: settings.osAccentColor || '#D62828',
  });

  const pdf = await renderToBuffer(docDefinition);
  if (!pdf || !pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) {
    throw billingError('O re-render do demonstrativo nao produziu um PDF valido.', 502);
  }
  if (pdf.length > MAX_PDF_BYTES) {
    throw billingError('O demonstrativo re-renderizado excedeu o limite de 20 MB.', 502);
  }

  const period = safePart(statement.period || receivable.billingPeriod, statement.externalId || 'PERIODO');
  const customerSafe = safePart(customer.name, 'CLIENTE');
  return {
    pdfBase64: pdf.toString('base64'),
    fileName: `DEMONSTRATIVO ${period} - ${customerSafe}.pdf`,
    mimeType: 'application/pdf',
    documentType: 'statement',
    source: 'crm-rerender',
  };
}

module.exports = { renderStatementPdf, isStatementRerenderable, resolveStatement };
