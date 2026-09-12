const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const aiService = require('../src/services/aiService');
const { INTENTS, answerQuestion } = require('../src/services/aiAssistantService');

const SETTINGS = { aiProvider: 'anthropic', anthropicKey: 'sk-test' };

function patch(context, { customer = null, customers = [], receivables = [], contracts = [] } = {}) {
  const originals = {
    findFirst: prisma.crmCustomer.findFirst,
    findMany: prisma.crmCustomer.findMany,
    syncFindMany: prisma.externalSyncRecord.findMany,
    settingsFindUnique: prisma.tenantSettings.findUnique,
    chat: aiService.chat,
  };
  context.after(() => {
    prisma.crmCustomer.findFirst = originals.findFirst;
    prisma.crmCustomer.findMany = originals.findMany;
    prisma.externalSyncRecord.findMany = originals.syncFindMany;
    prisma.tenantSettings.findUnique = originals.settingsFindUnique;
    aiService.chat = originals.chat;
  });
  prisma.crmCustomer.findFirst = async () => customer;
  prisma.crmCustomer.findMany = async () => customers;
  prisma.externalSyncRecord.findMany = async ({ where }) => {
    if (where.entity === 'receivables') return receivables;
    if (where.entity === 'contracts') return contracts;
    return [];
  };
  prisma.tenantSettings.findUnique = async () => ({ firebirdLastSyncAt: new Date('2026-09-12T12:00:00-03:00') });
}

// Classificação e narração usam o mesmo aiService.chat; distinguimos pelo
// texto do prompt de sistema (o mesmo truque de qualquer teste de orquestração
// de 2 passos sobre um único adaptador).
function mockChat({ intent, clienteNome = null, answer = 'resposta simulada' }) {
  aiService.chat = async (_settings, systemPrompt) => {
    if (systemPrompt.includes('classifica perguntas internas')) {
      return JSON.stringify({ intent, clienteNome });
    }
    return answer;
  };
}

test('pergunta fora do escopo devolve mensagem fixa sem consultar cliente', async (context) => {
  patch(context, {});
  mockChat({ intent: INTENTS.FORA_DO_ESCOPO });
  const result = await answerQuestion({ tenantId: 't1', settings: SETTINGS, pergunta: 'qual a previsão do tempo?', crmCustomerId: null, canViewFinancial: true });
  assert.equal(result.intent, INTENTS.FORA_DO_ESCOPO);
  assert.match(result.answer, /só consigo responder/i);
});

test('boletos_abertos sem crm.financial.view nunca chega a consultar títulos', async (context) => {
  let receivablesQueried = false;
  patch(context, { customer: { id: 'c1', externalId: '500', name: 'Padaria Silva' } });
  prisma.externalSyncRecord.findMany = async ({ where }) => {
    if (where.entity === 'receivables') receivablesQueried = true;
    return [];
  };
  mockChat({ intent: INTENTS.BOLETOS_ABERTOS });
  const result = await answerQuestion({ tenantId: 't1', settings: SETTINGS, pergunta: 'boleto em aberto?', crmCustomerId: 'c1', canViewFinancial: false });
  assert.match(result.answer, /não tem permissão/i);
  assert.equal(receivablesQueried, false);
});

test('boletos_abertos com contexto da conversa soma só os títulos em aberto/vencidos do cliente certo', async (context) => {
  patch(context, {
    customer: { id: 'c1', externalId: '500', name: 'Padaria Silva' },
    receivables: [
      { externalId: '1', payload: { clientExternalId: '500', valreceita: 100, valreceitapaga: 0, dtvectorec: '2026-08-01' } }, // vencido
      { externalId: '2', payload: { clientExternalId: '500', valreceita: 200, valreceitapaga: 200, dtpagtorec: '2026-08-05' } }, // pago, não entra
      { externalId: '3', payload: { clientExternalId: '500', valreceita: 50, valreceitapaga: 0, dtvectorec: '2026-09-30' } }, // em aberto, futuro
    ],
  });
  mockChat({ intent: INTENTS.BOLETOS_ABERTOS, answer: 'a Padaria Silva tem 2 títulos em aberto' });
  const result = await answerQuestion({ tenantId: 't1', settings: SETTINGS, pergunta: 'esse cliente tem boleto em aberto?', crmCustomerId: 'c1', canViewFinancial: true });
  assert.equal(result.data.totalEmAberto, 2);
  assert.equal(result.data.valorTotalEmAberto, 150);
  assert.equal(result.customer.name, 'Padaria Silva');
  assert.equal(result.answer, 'a Padaria Silva tem 2 títulos em aberto');
});

test('nome citado bate em mais de um cliente -> pede para o atendente escolher, sem adivinhar', async (context) => {
  patch(context, {
    customers: [
      { id: 'c1', name: 'João da Silva', fantasyName: null },
      { id: 'c2', name: 'João da Silva Filho', fantasyName: null },
    ],
  });
  mockChat({ intent: INTENTS.STATUS_CONTRATO, clienteNome: 'João da Silva' });
  const result = await answerQuestion({ tenantId: 't1', settings: SETTINGS, pergunta: 'contrato do João da Silva está ativo?', crmCustomerId: null, canViewFinancial: true });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.data, undefined);
});

test('nome citado não bate com ninguém -> diz que não encontrou, não inventa cliente', async (context) => {
  patch(context, { customers: [] });
  mockChat({ intent: INTENTS.RESUMO_CLIENTE, clienteNome: 'Empresa Inexistente' });
  const result = await answerQuestion({ tenantId: 't1', settings: SETTINGS, pergunta: 'dados da Empresa Inexistente', crmCustomerId: null, canViewFinancial: true });
  assert.match(result.answer, /não encontrei/i);
  assert.equal(result.customer, null);
});

test('status_contrato sem nenhum contrato sincronizado marca hasData=false em vez de inventar', async (context) => {
  patch(context, { customer: { id: 'c1', externalId: '500', name: 'Padaria Silva' }, contracts: [] });
  mockChat({ intent: INTENTS.STATUS_CONTRATO });
  const result = await answerQuestion({ tenantId: 't1', settings: SETTINGS, pergunta: 'contrato ativo?', crmCustomerId: 'c1', canViewFinancial: true });
  assert.equal(result.data.hasData, false);
});
