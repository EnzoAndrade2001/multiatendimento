const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const technicalAssistantService = require('../src/services/technicalAssistantService');
const knowledgeSearchService = require('../src/services/knowledgeSearchService');
const botPromptService = require('../src/services/botPromptService');

test('reconhece tecnico autorizado por telefone com ou sem DDI', { concurrency: false }, async () => {
  const previousFindMany = prisma.user.findMany;
  const previousTechnicalFindMany = prisma.technicalContact.findMany;
  technicalAssistantService.clearActorCache();
  prisma.technicalContact.findMany = async () => [{
    id: 'contact-1', name: 'Robson', phone: '51999998888', firebirdSupportName: 'ROBSON',
  }];
  try {
    const actor = await technicalAssistantService.resolveWhatsAppActor({ tenantId: 'tenant-tech', phone: '5551999998888' });
    assert.deepEqual(actor, {
      type: 'TECHNICIAN', audience: 'TECHNICIAN', userId: null, technicalContactId: 'contact-1', name: 'Robson', firebirdSupportName: 'ROBSON',
    });
  } finally {
    prisma.user.findMany = previousFindMany;
    prisma.technicalContact.findMany = previousTechnicalFindMany;
    technicalAssistantService.clearActorCache();
  }
});

test('telefone sem usuario tecnico permanece no modo cliente', { concurrency: false }, async () => {
  const previousFindMany = prisma.user.findMany;
  const previousTechnicalFindMany = prisma.technicalContact.findMany;
  technicalAssistantService.clearActorCache();
  prisma.technicalContact.findMany = async () => [];
  prisma.user.findMany = async () => [{ id: 'agent-1', name: 'Camille', phone: '5551999998888', role: 'agent', accessProfile: 'agent' }];
  try {
    assert.equal(await technicalAssistantService.resolveWhatsAppActor({ tenantId: 'tenant-customer', phone: '5551999998888' }), null);
  } finally {
    prisma.user.findMany = previousFindMany;
    prisma.technicalContact.findMany = previousTechnicalFindMany;
    technicalAssistantService.clearActorCache();
  }
});

test('mantem compatibilidade com tecnico legado cadastrado como usuario', { concurrency: false }, async () => {
  const previousFindMany = prisma.user.findMany;
  const previousTechnicalFindMany = prisma.technicalContact.findMany;
  technicalAssistantService.clearActorCache();
  prisma.technicalContact.findMany = async () => [];
  prisma.user.findMany = async () => [{
    id: 'legacy-tech', name: 'Robson', phone: '51999998888', role: 'agent', accessProfile: 'tecnico', firebirdSupportName: 'ROBSON',
  }];
  try {
    const actor = await technicalAssistantService.resolveWhatsAppActor({ tenantId: 'tenant-tech', phone: '5551999998888' });
    assert.equal(actor?.userId, 'legacy-tech');
    assert.equal(actor?.technicalContactId, null);
  } finally {
    prisma.user.findMany = previousFindMany;
    prisma.technicalContact.findMany = previousTechnicalFindMany;
    technicalAssistantService.clearActorCache();
  }
});

test('busca de tecnico inclui documentos tecnicos e respostas gerais, sem abrir material reservado de atendente', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'services', 'knowledgeSearchService.js'), 'utf8');
  assert.match(source, /requestedAudience === 'TECHNICIAN'/);
  assert.match(source, /audience: documentAudience/);
});

test('prompt tecnico separa o assistente interno do atendimento ao cliente', () => {
  const prompt = botPromptService.buildFinalPrompt({
    userPrompt: 'Atenda com cordialidade.', equipContext: '', currentNotes: '', knowledgeContext: 'manual',
    contactName: 'Contato', transferWord: 'humano', assistantMode: 'TECHNICIAN', technicianName: 'Robson',
  });
  assert.match(prompt, /ASSISTENTE TECNICO INTERNO/);
  assert.match(prompt, /N[aã]o revele dados de clientes|Nao revele dados de clientes/);
  assert.match(prompt, /[[ROUTE: SUPORTE]]/);
});

test('auditoria registra modo e publico usados pela resposta', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'controllers', 'webhookController.js'), 'utf8');
  assert.match(source, /assistantMode/);
  assert.match(source, /audience: knowledgeAudience/);
  assert.match(source, /actorUserId/);
  assert.match(source, /actorTechnicalContactId/);
});

test('parseModeChoice so aceita escolha explicita do menu de modo', () => {
  assert.equal(technicalAssistantService.parseModeChoice('1'), 'TECHNICIAN');
  assert.equal(technicalAssistantService.parseModeChoice('1 - assistente'), 'TECHNICIAN');
  assert.equal(technicalAssistantService.parseModeChoice('quero o Assistente Técnico'), 'TECHNICIAN');
  assert.equal(technicalAssistantService.parseModeChoice('2'), 'CUSTOMER');
  assert.equal(technicalAssistantService.parseModeChoice('atendimento normal'), 'CUSTOMER');
  // Pergunta técnica de verdade não pode ser confundida com escolha de modo.
  assert.equal(technicalAssistantService.parseModeChoice('erro 303-403 na xerox'), null);
  assert.equal(technicalAssistantService.parseModeChoice('bom dia'), null);
  assert.equal(technicalAssistantService.parseModeChoice(''), null);
});

test('isMenuRequest so reconhece a mensagem inteira, nao duvida com a palavra menu', () => {
  assert.equal(technicalAssistantService.isMenuRequest('menu'), true);
  assert.equal(technicalAssistantService.isMenuRequest('Menu'), true);
  assert.equal(technicalAssistantService.isMenuRequest('trocar modo'), true);
  assert.equal(technicalAssistantService.isMenuRequest('mudar de modo'), true);
  assert.equal(technicalAssistantService.isMenuRequest('menu de configuração da impressora'), false);
  assert.equal(technicalAssistantService.isMenuRequest('como abro o menu na tela'), false);
  assert.equal(technicalAssistantService.isMenuRequest('erro 303-403'), false);
});

test('janela de inatividade do tecnico vem de env em minutos, padrao 10', () => {
  assert.equal(technicalAssistantService.TECHNICIAN_SESSION_INACTIVITY_MS, technicalAssistantService.TECHNICIAN_SESSION_INACTIVITY_MINUTES * 60 * 1000);
  assert.ok(technicalAssistantService.TECHNICIAN_SESSION_INACTIVITY_MINUTES >= 1);
});

test('menu de modo e envio nao entram no historico do LLM', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'controllers', 'webhookController.js'), 'utf8');
  assert.match(source, /TECHNICIAN_MODE_MENU/);
  assert.match(source, /\['TECHNICIAN_MODE_MENU', 'TECHNICIAN_MODE_SET'\]\.includes\(m\.automationType\)/);
});
