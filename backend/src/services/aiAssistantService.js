const prisma = require('../lib/prisma');
const aiService = require('./aiService');
const { findTenantCustomer, loadContracts, normalizeReceivable } = require('../controllers/crmController');

// Assistente corporativo de leitura. O modelo somente interpreta a pergunta e
// apresenta um resultado que foi calculado pelo backend. Nenhum SQL produzido
// pela IA e executado no banco.
const INTENTS = Object.freeze({
  RECEITA_PREVISTA: 'receita_prevista',
  CONTAS_RECEBER: 'contas_receber',
  BOLETOS_ABERTOS: 'contas_receber',
  CONTAS_PAGAR: 'contas_pagar',
  INADIMPLENTES: 'clientes_inadimplentes',
  OS_ABERTAS: 'os_abertas',
  STATUS_CONTRATO: 'status_contrato',
  SAUDE_EQUIPAMENTO: 'saude_equipamento',
  RESUMO_CLIENTE: 'resumo_cliente',
  FORA_DO_ESCOPO: 'fora_do_escopo',
});

const FINANCIAL_INTENTS = new Set([
  INTENTS.RECEITA_PREVISTA, INTENTS.CONTAS_RECEBER, INTENTS.CONTAS_PAGAR, INTENTS.INADIMPLENTES,
]);
const SCOPE_MESSAGE = 'Só consigo responder sobre receita prevista, contas a receber, contas a pagar, inadimplência, ordens de serviço, contratos, equipamentos e dados de clientes.';
const STALE_METER_DAYS = 7;

function plain(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function stripJsonFences(text) { return String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim(); }
function parseJsonSafe(text, fallback) { try { return JSON.parse(stripJsonFences(text)); } catch { return fallback; } }
function formatDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
function money(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function monthRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}
function validDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function resolvePeriod(periodo) {
  const fallback = monthRange();
  const start = validDate(periodo?.inicio) || fallback.start;
  const endBase = validDate(periodo?.fim);
  const end = endBase ? new Date(endBase.getTime() + 86_399_999) : fallback.end;
  return start <= end ? { start, end } : fallback;
}
function inPeriod(value, period) {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime()) && date >= period.start && date <= period.end;
}

function keywordIntent(question) {
  const q = plain(question);
  if (/contas? a pagar|despesas?|fornecedores? a pagar/.test(q)) return INTENTS.CONTAS_PAGAR;
  if (/inadimpl|devedor|vencid/.test(q) && /client|quem|maior|quant/.test(q)) return INTENTS.INADIMPLENTES;
  if (/receita prevista|previsao de receita|faturamento previsto/.test(q)) return INTENTS.RECEITA_PREVISTA;
  if (/ordens? de servico|\bo\.?s\.?\b|chamados?/.test(q) && /abert|pendent|andamento|quant/.test(q)) return INTENTS.OS_ABERTAS;
  if (/contas? a receber|boletos?|titulos?|recebiveis?/.test(q)) return INTENTS.CONTAS_RECEBER;
  if (/contrat/.test(q)) return INTENTS.STATUS_CONTRATO;
  if (/equipamento|impressora|contador|leitura/.test(q)) return INTENTS.SAUDE_EQUIPAMENTO;
  if (/cadastro|endereco|telefone|cnpj|cpf|cliente/.test(q)) return INTENTS.RESUMO_CLIENTE;
  return null;
}

async function classifyQuestion(settings, pergunta) {
  const shortcut = keywordIntent(pergunta);
  const now = new Date().toISOString().slice(0, 10);
  const systemPrompt = [
    'Você classifica perguntas internas e gerenciais sobre dados de uma empresa de outsourcing de impressão.',
    `Hoje é ${now}. Responda SOMENTE JSON: {"intent":string,"clienteNome":string|null,"periodo":{"inicio":"YYYY-MM-DD","fim":"YYYY-MM-DD"}|null}.`,
    `Intenções permitidas: ${Object.values(INTENTS).join(', ')}.`,
    'Receita prevista usa títulos com vencimento no período. Contas a receber inclui títulos abertos. Contas a pagar inclui despesas e fornecedores. O.S. significa ordem de serviço.',
    'clienteNome é null quando a pergunta é sobre a empresa inteira. Converta mês, hoje, semana e ano em datas exatas. Nunca invente nome.',
  ].join('\n');
  try {
    const raw = await aiService.chat(settings, systemPrompt, [], pergunta, { maxOutputTokens: 240 });
    const parsed = parseJsonSafe(raw, null);
    return {
      intent: shortcut || (Object.values(INTENTS).includes(parsed?.intent) ? parsed.intent : INTENTS.FORA_DO_ESCOPO),
      clienteNome: typeof parsed?.clienteNome === 'string' ? parsed.clienteNome.trim() || null : null,
      periodo: parsed?.periodo || null,
    };
  } catch {
    return { intent: shortcut || INTENTS.FORA_DO_ESCOPO, clienteNome: null, periodo: null };
  }
}

async function phraseAnswer(settings, { pergunta, intent, data, customerName }) {
  const systemPrompt = [
    'Você é o Assistente iLux, voltado a consultas internas e gerenciais.',
    'Responda em português do Brasil, de forma direta. Use SOMENTE o JSON fornecido.',
    'Nunca invente, estime ou altere números. Se hasData=false, explique que os dados ainda não estão sincronizados.',
    `Escopo: ${customerName || 'empresa inteira'}. Intenção: ${intent}. Dados: ${JSON.stringify(data)}`,
  ].join('\n');
  try {
    return await aiService.chat(settings, systemPrompt, [], pergunta, { maxOutputTokens: 700 });
  } catch {
    return data.summary || 'A consulta foi concluída, mas não foi possível gerar a explicação. Tente novamente.';
  }
}

async function searchCustomersByName(tenantId, name) {
  const q = String(name || '').trim();
  if (!q) return [];
  return prisma.crmCustomer.findMany({ where: { tenantId, OR: [{ name: { contains: q, mode: 'insensitive' } }, { fantasyName: { contains: q, mode: 'insensitive' } }, { cpfCnpj: { contains: q } }] }, orderBy: { name: 'asc' }, take: 8 });
}
async function resolveCustomer({ tenantId, crmCustomerId, clienteNome }) {
  if (crmCustomerId) {
    const customer = await prisma.crmCustomer.findFirst({ where: { id: crmCustomerId, tenantId } });
    if (customer) return { customer };
  }
  if (!clienteNome) return { companyWide: true };
  const matches = await searchCustomersByName(tenantId, clienteNome);
  if (!matches.length) return { notFound: true, clienteNome };
  if (matches.length === 1) return { customer: matches[0] };
  return { candidates: matches.map(({ id, name, fantasyName }) => ({ id, name, fantasyName })) };
}

async function loadReceivables(tenantId, customer) {
  const records = await prisma.externalSyncRecord.findMany({
    where: { tenantId, source: 'firebird', entity: 'receivables', ...(customer?.externalId ? { payload: { path: ['clientExternalId'], equals: String(customer.externalId) } } : {}) },
    select: { externalId: true, payload: true, receivedAt: true }, orderBy: { receivedAt: 'desc' }, take: 20000,
  });
  return records.map(normalizeReceivable).filter((item) => !item.isCancelled);
}
async function fetchReceivablesData(tenantId, customer, period, forecastOnly = false) {
  const records = await loadReceivables(tenantId, customer);
  if (!records.length) return { hasData: false, summary: 'Não há contas a receber sincronizadas para este escopo.' };
  const open = records.filter((item) => ['open', 'overdue'].includes(item.status) && (!forecastOnly || inPeriod(item.dueAt, period)));
  const total = open.reduce((sum, item) => sum + money(item.openValue), 0);
  return {
    hasData: true, periodo: forecastOnly ? { inicio: formatDate(period.start), fim: formatDate(period.end) } : null,
    quantidade: open.length, valorTotal: total, totalEmAberto: open.length, valorTotalEmAberto: total, vencidos: open.filter((item) => item.status === 'overdue').length,
    summary: `${open.length} título(s), total de R$ ${total.toFixed(2)}.`,
    titulos: open.sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0)).slice(0, 12).map((item) => ({ numero: item.ourNumber || item.externalId, vencimento: formatDate(item.dueAt), valor: money(item.openValue), situacao: item.status })),
  };
}
async function fetchDelinquentData(tenantId, customer) {
  const records = (await loadReceivables(tenantId, customer)).filter((item) => item.status === 'overdue');
  if (!records.length) return { hasData: true, quantidadeClientes: 0, valorVencido: 0, clientes: [], summary: 'Nenhum cliente inadimplente encontrado.' };
  const customers = await prisma.crmCustomer.findMany({ where: { tenantId }, select: { externalId: true, name: true, fantasyName: true } });
  const names = new Map(customers.map((item) => [String(item.externalId), item.fantasyName || item.name]));
  const grouped = new Map();
  for (const item of records) {
    const key = String(item.clientExternalId || 'sem-cliente');
    const current = grouped.get(key) || { cliente: names.get(key) || 'Cliente não identificado', quantidade: 0, valor: 0 };
    current.quantidade += 1; current.valor += money(item.openValue); grouped.set(key, current);
  }
  const list = [...grouped.values()].sort((a, b) => b.valor - a.valor);
  const total = list.reduce((sum, item) => sum + item.valor, 0);
  return { hasData: true, quantidadeClientes: list.length, valorVencido: total, clientes: list.slice(0, 15), summary: `${list.length} cliente(s) inadimplente(s), total vencido de R$ ${total.toFixed(2)}.` };
}

function normalizePayable(record) {
  const p = record?.payload || record || {};
  const value = money(p.value ?? p.valdespesa);
  const paidValue = money(p.paidValue ?? p.valdespesapaga);
  const paidAt = p.paidAt || p.dtpagtodesp || null;
  return { externalId: record.externalId || p.externalId || p.seqdespesa, supplier: p.supplierName || p.nmfornecedor || p.fantasia || 'Fornecedor não identificado', dueAt: p.dueAt || p.dtvectodesp, paidAt, value, openValue: Math.max(0, money(p.openValue ?? (value - paidValue))), cancelled: Boolean(p.cancelled || plain(p.status).includes('cancel')) };
}
async function fetchPayablesData(tenantId, period) {
  const rows = await prisma.externalSyncRecord.findMany({ where: { tenantId, source: 'firebird', entity: 'payables' }, select: { externalId: true, payload: true, receivedAt: true }, take: 20000 });
  if (!rows.length) return { hasData: false, summary: 'As contas a pagar ainda não foram sincronizadas por este agente iLux.' };
  const open = rows.map(normalizePayable).filter((item) => !item.cancelled && !item.paidAt && item.openValue > 0 && inPeriod(item.dueAt, period));
  const total = open.reduce((sum, item) => sum + item.openValue, 0);
  return { hasData: true, periodo: { inicio: formatDate(period.start), fim: formatDate(period.end) }, quantidade: open.length, valorTotal: total, summary: `${open.length} conta(s) a pagar, total de R$ ${total.toFixed(2)}.`, contas: open.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).slice(0, 15).map((item) => ({ fornecedor: item.supplier, vencimento: formatDate(item.dueAt), valor: item.openValue })) };
}

async function fetchOpenOrdersData(tenantId, customer) {
  const closed = ['FINALIZADA', 'FINALIZADO', 'FECHADA', 'FECHADO', 'CONCLUIDA', 'CONCLUIDO', 'CANCELADA', 'CANCELADO'];
  const rows = await prisma.serviceOrder.findMany({ where: { tenantId, ...(customer ? { contact: { crmCustomerId: customer.id } } : {}) }, select: { externalId: true, status: true, defect: true, createdAt: true, contact: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10000 });
  const open = rows.filter((item) => !closed.includes(String(item.status || '').toUpperCase()));
  return { hasData: true, quantidade: open.length, summary: `${open.length} ordem(ns) de serviço em aberto.`, ordens: open.slice(0, 15).map((item) => ({ numero: item.externalId, cliente: item.contact?.name, status: item.status, defeito: item.defect })) };
}
async function fetchContractData(tenantId, customer) {
  const records = customer?.externalId
    ? await loadContracts(tenantId, customer.externalId)
    : (await prisma.externalSyncRecord.findMany({ where: { tenantId, source: 'firebird', entity: 'contracts' }, select: { externalId: true, payload: true }, take: 20000 })).map((row) => row.payload);
  if (!records.length) return { hasData: false, summary: 'Não há contratos sincronizados para este escopo.' };
  const active = records.filter((item) => item.isActive !== false && !/cancel|encerr|inativ/.test(plain(item.status)));
  const monthly = active.reduce((sum, item) => sum + money(item.monthlyValue || item.value), 0);
  return { hasData: true, total: records.length, ativos: active.length, valorMensal: monthly, summary: `${active.length} contrato(s) ativo(s), valor mensal de R$ ${monthly.toFixed(2)}.`, contratos: active.slice(0, 15).map((item) => ({ numero: item.number || item.externalId, tipo: item.type, valorMensal: money(item.monthlyValue || item.value), fim: formatDate(item.endsAt) })) };
}
async function fetchEquipmentData(tenantId, customer) {
  const equipments = await prisma.crmEquipment.findMany({ where: { tenantId, ...(customer ? { customerId: customer.id } : {}) }, orderBy: { updatedAt: 'desc' }, take: 10000 });
  const active = equipments.filter((item) => item.isActive);
  const stale = active.filter((item) => !item.lastMeterReadAt || (Date.now() - new Date(item.lastMeterReadAt).getTime()) / 86_400_000 > STALE_METER_DAYS);
  return { hasData: Boolean(equipments.length), total: equipments.length, ativos: active.length, semLeituraRecente: stale.length, summary: `${active.length} equipamento(s) ativo(s); ${stale.length} sem leitura recente.`, equipamentos: stale.slice(0, 15).map((item) => ({ modelo: item.model, serie: item.serialNumber, ultimaLeitura: formatDate(item.lastMeterReadAt) })) };
}
async function fetchCustomerSummary(tenantId, customer) {
  if (customer) {
    const full = await findTenantCustomer(tenantId, customer.id);
    return { hasData: true, nome: full.name, fantasia: full.fantasyName, cpfCnpj: full.cpfCnpj, telefone: full.phone, email: full.email, endereco: [full.address, full.city, full.state].filter(Boolean).join(', '), equipamentos: full.equipments?.length || 0, summary: `Cadastro de ${full.fantasyName || full.name}.` };
  }
  const total = await prisma.crmCustomer.count({ where: { tenantId } });
  return { hasData: true, totalClientes: total, summary: `${total} cliente(s) cadastrados no CRM iLux.` };
}

async function answerQuestion({ tenantId, settings, pergunta, crmCustomerId, canViewFinancial }) {
  const { intent, clienteNome, periodo } = await classifyQuestion(settings, pergunta);
  if (intent === INTENTS.FORA_DO_ESCOPO) return { intent, answer: SCOPE_MESSAGE, customer: null };
  if (FINANCIAL_INTENTS.has(intent) && !canViewFinancial) return { intent, answer: 'Você não tem permissão para consultar informações financeiras.', customer: null };
  const resolution = await resolveCustomer({ tenantId, crmCustomerId, clienteNome });
  if (resolution.candidates) return { intent, candidates: resolution.candidates, answer: 'Encontrei mais de um cliente. Selecione o cadastro correto.' };
  if (resolution.notFound) return { intent, answer: `Não encontrei o cliente “${resolution.clienteNome}” na base sincronizada.`, customer: null };
  const customer = resolution.customer || null;
  const period = resolvePeriod(periodo);
  const data = intent === INTENTS.RECEITA_PREVISTA ? await fetchReceivablesData(tenantId, customer, period, true)
    : intent === INTENTS.CONTAS_RECEBER ? await fetchReceivablesData(tenantId, customer, period, false)
    : intent === INTENTS.CONTAS_PAGAR ? await fetchPayablesData(tenantId, period)
    : intent === INTENTS.INADIMPLENTES ? await fetchDelinquentData(tenantId, customer)
    : intent === INTENTS.OS_ABERTAS ? await fetchOpenOrdersData(tenantId, customer)
    : intent === INTENTS.STATUS_CONTRATO ? await fetchContractData(tenantId, customer)
    : intent === INTENTS.SAUDE_EQUIPAMENTO ? await fetchEquipmentData(tenantId, customer)
    : await fetchCustomerSummary(tenantId, customer);
  const settingsRow = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { firebirdLastSyncAt: true } });
  const answer = await phraseAnswer(settings, { pergunta, intent, data, customerName: customer?.name });
  return { intent, answer, data, scope: customer ? 'customer' : 'company', customer: customer ? { id: customer.id, name: customer.name } : null, syncedAt: settingsRow?.firebirdLastSyncAt || null };
}

module.exports = { INTENTS, answerQuestion, __testing: { classifyQuestion, resolveCustomer, parseJsonSafe, keywordIntent, resolvePeriod } };
