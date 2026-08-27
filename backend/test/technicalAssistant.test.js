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
