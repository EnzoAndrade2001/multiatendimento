const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { getCompanyProfileFromIluxWeb } = require('./iluxWebService');

const COMPANY_ENTITY = 'companyInfo';
const COMPANY_REQUEST_ENTITY = 'companyInfoRequest';

function readValue(record = {}, ...keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function normalizeCompanyProfile(record = {}) {
  const code = readValue(record, 'companyCode', 'cdempresa', 'cdEmpresa', 'CDEMPRESA');
  const address = readValue(record, 'address', 'endereco', 'logradouro');
  const number = readValue(record, 'number', 'num', 'numero');

  return {
    code,
    name: readValue(record, 'name', 'nmempresa', 'razaoSocial', 'razao_social'),
    tradeName: readValue(record, 'tradeName', 'fantasia', 'nmfantasia', 'nomeFantasia', 'nome_fantasia'),
    cnpj: readValue(record, 'cnpj', 'cpfCnpj', 'cpf_cnpj'),
    stateRegistration: readValue(record, 'stateRegistration', 'inscest', 'ie', 'inscricaoEstadual'),
    address,
    number,
    addressFull: [address, number].filter(Boolean).join(', ') || null,
    neighborhood: readValue(record, 'neighborhood', 'bairro'),
    zipCode: readValue(record, 'zipCode', 'cep'),
    city: readValue(record, 'city', 'cidade'),
    state: readValue(record, 'state', 'uf'),
    phone: readValue(record, 'phone', 'fone', 'fone1', 'telefone', 'celular'),
    areaCode: readValue(record, 'areaCode', 'ddd'),
    capturedAt: readValue(record, 'capturedAt', 'captured_at') || new Date().toISOString(),
  };
}

async function getLatestCompanyProfile(tenantId) {
  const record = await prisma.externalSyncRecord.findFirst({
    where: { tenantId, source: 'ilux_web', entity: COMPANY_ENTITY },
    orderBy: [{ receivedAt: 'desc' }, { syncedAt: 'desc' }],
    select: { id: true, externalId: true, payload: true, receivedAt: true, syncedAt: true },
  });

  if (!record) return null;

  return {
    ...normalizeCompanyProfile(record.payload || {}),
    externalId: record.externalId,
    receivedAt: record.receivedAt,
    syncedAt: record.syncedAt,
  };
}

async function getPendingCompanyRequest(tenantId) {
  return prisma.externalSyncRecord.findFirst({
    where: {
      tenantId,
      source: 'crm',
      entity: COMPANY_REQUEST_ENTITY,
      OR: [
        { payload: { path: ['status'], equals: 'pending' } },
        { payload: { path: ['status'], equals: 'processing' } },
      ],
    },
    orderBy: { receivedAt: 'asc' },
    select: { id: true, payload: true, receivedAt: true },
  });
}

async function getLatestCompanyRequest(tenantId) {
  return prisma.externalSyncRecord.findFirst({
    where: { tenantId, source: 'crm', entity: COMPANY_REQUEST_ENTITY },
    orderBy: { receivedAt: 'desc' },
    select: { id: true, payload: true, receivedAt: true },
  });
}

async function requestCompanySync(tenantId, requestedBy) {
  const profile = await getCompanyProfileFromIluxWeb();
  if (!profile || typeof profile !== 'object') {
    throw new Error('O LCDDIGITALWEB não devolveu o cadastro da empresa.');
  }
  const id = crypto.randomUUID();
  const normalized = normalizeCompanyProfile(profile);
  await prisma.externalSyncRecord.create({
    data: {
      id,
      tenantId,
      source: 'ilux_web',
      entity: COMPANY_ENTITY,
      // Cada sincronização gera um registro próprio; isso evita colisão na
      // chave única quando a mesma empresa é sincronizada novamente.
      externalId: id,
      payload: { ...profile, requestedBy: requestedBy || null, syncedAt: new Date().toISOString() },
    },
  });
  return { id, status: 'ok', alreadyQueued: false, profile: normalized };
}

module.exports = {
  COMPANY_ENTITY,
  COMPANY_REQUEST_ENTITY,
  normalizeCompanyProfile,
  getLatestCompanyProfile,
  getPendingCompanyRequest,
  getLatestCompanyRequest,
  requestCompanySync,
};
