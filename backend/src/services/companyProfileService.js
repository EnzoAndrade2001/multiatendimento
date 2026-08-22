const crypto = require('crypto');
const prisma = require('../lib/prisma');

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
    where: { tenantId, source: 'firebird', entity: COMPANY_ENTITY },
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
  const pending = await getPendingCompanyRequest(tenantId);
  if (pending) return { id: pending.id, status: 'pending', alreadyQueued: true };

  const id = crypto.randomUUID();
  await prisma.externalSyncRecord.create({
    data: {
      id,
      tenantId,
      source: 'crm',
      entity: COMPANY_REQUEST_ENTITY,
      externalId: id,
      payload: {
        status: 'pending',
        requestedAt: new Date().toISOString(),
        requestedBy: requestedBy || null,
      },
    },
  });

  return { id, status: 'pending', alreadyQueued: false };
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
