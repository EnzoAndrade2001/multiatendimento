const prisma = require('../lib/prisma');
const aiService = require('./aiService');
const { findTenantCustomer, loadContracts, normalizeReceivable } = require('../controllers/crmController');

// Assistente interno de leitura (Fase 1): responde perguntas em linguagem
// natural sobre um cliente do iLux a partir do que ja esta sincronizado no
// Postgres do CRM. Nunca escreve nada e nunca deixa o modelo "calcular" ou
// inventar dado financeiro/cadastral - o modelo so classifica a pergunta e,
// depois, narra em portugues um JSON que o backend montou com consultas
// deterministicas. Ver memoria "billing-docs-off-folder" / "ilux-firebird-data-quirks".

const INTENTS = Object.freeze({
  BOLETOS_ABERTOS: 'boletos_abertos',
  STATUS_CONTRATO: 'status_contrato',
  SAUDE_EQUIPAMENTO: 'saude_equipamento',
  RESUMO_CLIENTE: 'resumo_cliente',
  FORA_DO_ESCOPO: 'fora_do_escopo',
});

const SCOPE_MESSAGE = 'Por enquanto só consigo responder sobre: boletos em aberto, status do contrato, situação dos equipamentos e dados cadastrais do cliente.';

const STALE_METER_DAYS = 7;

function stripJsonFences(text) {
  return String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
}

function parseJsonSafe(text, fallback) {
  try { return JSON.parse(stripJsonFences(text)); }
  catch { return fallback; }
}

function formatDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pt-BR');
}

function formatMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Passo 1: o modelo só decide QUAL pergunta é essa e QUAL cliente foi citado
// (quando não veio do contexto da conversa). Nunca responde com dado nenhum
// nesta etapa - é puramente classificação.
async function classifyQuestion(settings, pergunta) {
  const systemPrompt = [
    'Você classifica perguntas internas de uma equipe de suporte sobre clientes de uma empresa de outsourcing de impressão.',
    `Responda SOMENTE com um JSON no formato {"intent": string, "clienteNome": string|null}.`,
    `"intent" deve ser um destes valores exatos: "${INTENTS.BOLETOS_ABERTOS}" (boleto, fatura, título, pagamento em aberto/vencido/pago), "${INTENTS.STATUS_CONTRATO}" (contrato ativo, vigência, franquia, valor mensal), "${INTENTS.SAUDE_EQUIPAMENTO}" (impressora, equipamento, contador, última leitura), "${INTENTS.RESUMO_CLIENTE}" (dados cadastrais gerais, endereço, telefone) ou "${INTENTS.FORA_DO_ESCOPO}" quando a pergunta não é sobre nenhum desses temas.`,
    '"clienteNome" é o nome do cliente citado na pergunta, ou null se nenhum nome foi citado (a pergunta pode vir sem nome quando o cliente já está claro pelo contexto).',
    'Nunca invente nome de cliente. Responda só o JSON, sem explicações.',
  ].join('\n');
  const raw = await aiService.chat(settings, systemPrompt, [], pergunta, { maxOutputTokens: 200 });
  const parsed = parseJsonSafe(raw, null);
  const intent = Object.values(INTENTS).includes(parsed?.intent) ? parsed.intent : INTENTS.FORA_DO_ESCOPO;
  const clienteNome = typeof parsed?.clienteNome === 'string' ? parsed.clienteNome.trim() || null : null;
  return { intent, clienteNome };
}

// Passo 3 (depois dos dados resolvidos): o modelo só narra o JSON em
// português curto, nunca acrescenta número/data que não esteja nele.
async function phraseAnswer(settings, { pergunta, intent, data, customerName }) {
  const systemPrompt = [
    'Você é um assistente interno para um atendente que está no meio de uma conversa de WhatsApp com um cliente.',
    'Responda em português, curto e direto (poucas frases, sem enrolação), pronto para o atendente ler rápido.',
    'Use SOMENTE os dados do JSON abaixo. Nunca invente, estime ou arredonde números/datas que não estejam explicitamente no JSON.',
    'Se "hasData" for false, diga claramente que não há esse dado sincronizado para este cliente - não tente adivinhar.',
    `Cliente: ${customerName || 'não identificado'}.`,
    `Dados (JSON): ${JSON.stringify(data)}`,
  ].join('\n');
  return aiService.chat(settings, systemPrompt, [], pergunta, { maxOutputTokens: 500 });
}

async function searchCustomersByName(tenantId, name) {
  const q = String(name || '').trim();
  if (!q) return [];
  return prisma.crmCustomer.findMany({
    where: {
      tenantId,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { fantasyName: { contains: q, mode: 'insensitive' } },
        { cpfCnpj: { contains: q } },
      ],
    },
    orderBy: { name: 'asc' },
    take: 5,
  });
}

// Contexto da conversa (crmCustomerId) sempre vence: se o atendente abriu o
// painel a partir de um ticket vinculado, não há por que confiar num nome
// que o modelo pode ter entendido errado.
async function resolveCustomer({ tenantId, crmCustomerId, clienteNome }) {
  if (crmCustomerId) {
    const customer = await prisma.crmCustomer.findFirst({ where: { id: crmCustomerId, tenantId } });
    if (customer) return { customer };
  }
  if (!clienteNome) return { notFound: true, reason: 'sem-nome' };
  const matches = await searchCustomersByName(tenantId, clienteNome);
  if (matches.length === 0) return { notFound: true, reason: 'sem-resultado', clienteNome };
  if (matches.length === 1) return { customer: matches[0] };
  return { candidates: matches.map((item) => ({ id: item.id, name: item.name, fantasyName: item.fantasyName })) };
}

async function fetchReceivablesData(tenantId, customer) {
  if (!customer.externalId) return { hasData: false };
  const records = await prisma.externalSyncRecord.findMany({
    where: {
      tenantId,
      source: 'firebird',
      entity: 'receivables',
      payload: { path: ['clientExternalId'], equals: String(customer.externalId) },
    },
    select: { externalId: true, payload: true, receivedAt: true },
    orderBy: { receivedAt: 'desc' },
    take: 300,
  });
  if (!records.length) return { hasData: false };
  const receivables = records.map(normalizeReceivable).filter((item) => !item.isCancelled);
  const open = receivables.filter((item) => item.status === 'open' || item.status === 'overdue');
  return {
    hasData: true,
    totalEmAberto: open.length,
    valorTotalEmAberto: formatMoney(open.reduce((sum, item) => sum + (item.openValue || 0), 0)),
    titulos: open
      .sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0))
      .slice(0, 10)
      .map((item) => ({
        numero: item.ourNumber || item.externalId,
        vencimento: formatDate(item.dueAt),
        valor: formatMoney(item.openValue),
        situacao: item.status === 'overdue' ? 'vencido' : 'em aberto',
      })),
  };
}

async function fetchContractData(tenantId, customer) {
  if (!customer.externalId) return { hasData: false };
  const contracts = await loadContracts(tenantId, customer.externalId);
  if (!contracts.length) return { hasData: false };
  return {
    hasData: true,
    contratos: contracts.map((contract) => ({
      numero: contract.number,
      tipo: contract.type,
      ativo: Boolean(contract.isActive),
      inicio: formatDate(contract.startsAt),
      fim: formatDate(contract.endsAt),
      valorMensal: formatMoney(contract.monthlyValue),
      valorFranquia: formatMoney(contract.franchiseValue),
    })),
  };
}

function fetchEquipmentData(customerWithEquipments) {
  const equipments = customerWithEquipments.equipments || [];
  if (!equipments.length) return { hasData: false };
  const now = Date.now();
  const active = equipments.filter((item) => item.isActive);
  return {
    hasData: true,
    totalEquipamentos: equipments.length,
    ativos: active.length,
    equipamentos: active.slice(0, 15).map((item) => {
      const lastReadAt = item.lastMeterReadAt ? new Date(item.lastMeterReadAt) : null;
      const daysSinceRead = lastReadAt ? (now - lastReadAt.getTime()) / 86_400_000 : null;
      return {
        modelo: item.model,
        numeroSerie: item.serialNumber,
        contadorPaginas: item.pageCounter ?? null,
        ultimaLeitura: formatDate(lastReadAt),
        semLeituraRecente: daysSinceRead !== null ? daysSinceRead > STALE_METER_DAYS : null,
      };
    }),
  };
}

function fetchCustomerSummary(customerWithEquipments) {
  const equipments = customerWithEquipments.equipments || [];
  return {
    hasData: true,
    nome: customerWithEquipments.name,
    nomeFantasia: customerWithEquipments.fantasyName,
    cpfCnpj: customerWithEquipments.cpfCnpj,
    telefone: customerWithEquipments.phone,
    email: customerWithEquipments.email,
    endereco: [customerWithEquipments.address, customerWithEquipments.neighborhood, customerWithEquipments.city, customerWithEquipments.state]
      .filter(Boolean).join(', ') || null,
    totalEquipamentos: equipments.length,
    equipamentosAtivos: equipments.filter((item) => item.isActive).length,
  };
}

async function answerQuestion({ tenantId, settings, pergunta, crmCustomerId, canViewFinancial }) {
  const { intent, clienteNome } = await classifyQuestion(settings, pergunta);

  if (intent === INTENTS.FORA_DO_ESCOPO) {
    return { intent, answer: SCOPE_MESSAGE, customer: null };
  }

  const resolution = await resolveCustomer({ tenantId, crmCustomerId, clienteNome });
  if (resolution.candidates) {
    return { intent, candidates: resolution.candidates, answer: 'Encontrei mais de um cliente com esse nome. Qual deles?' };
  }
  if (resolution.notFound) {
    return {
      intent,
      answer: clienteNome
        ? `Não encontrei nenhum cliente chamado "${clienteNome}" na base.`
        : 'Não identifiquei de qual cliente é a pergunta. Pode informar o nome?',
      customer: null,
    };
  }

  if (intent === INTENTS.BOLETOS_ABERTOS && !canViewFinancial) {
    return {
      intent,
      answer: 'Você não tem permissão para consultar dados financeiros deste cliente.',
      customer: { id: resolution.customer.id, name: resolution.customer.name },
    };
  }

  const customer = intent === INTENTS.SAUDE_EQUIPAMENTO || intent === INTENTS.RESUMO_CLIENTE
    ? await findTenantCustomer(tenantId, resolution.customer.id)
    : resolution.customer;

  const data = intent === INTENTS.BOLETOS_ABERTOS ? await fetchReceivablesData(tenantId, customer)
    : intent === INTENTS.STATUS_CONTRATO ? await fetchContractData(tenantId, customer)
    : intent === INTENTS.SAUDE_EQUIPAMENTO ? fetchEquipmentData(customer)
    : fetchCustomerSummary(customer);

  const settingsRow = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { firebirdLastSyncAt: true } });
  const answer = await phraseAnswer(settings, { pergunta, intent, data, customerName: customer.name });

  return {
    intent,
    answer,
    data,
    customer: { id: customer.id, name: customer.name },
    syncedAt: settingsRow?.firebirdLastSyncAt || null,
  };
}

module.exports = {
  INTENTS,
  answerQuestion,
  __testing: { classifyQuestion, resolveCustomer, parseJsonSafe },
};
