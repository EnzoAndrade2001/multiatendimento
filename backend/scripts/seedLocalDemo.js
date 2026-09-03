/*
 * Dados locais para validar a interface completa sem tocar no banco da VPS.
 * Uso: DATABASE_URL=... node scripts/seedLocalDemo.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const daysAgo = (days, hours = 0) => new Date(Date.now() - ((days * 24) + hours) * 60 * 60 * 1000);

async function ensureDemoServiceOrders(tenantId) {
  const current = await prisma.serviceOrder.count({ where: { tenantId, externalSource: 'demo' } });
  if (current > 0) return;
  const contacts = await prisma.contact.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, take: 2 });
  if (!contacts.length) return;
  const equipment = [];
  for (const [index, contact] of contacts.entries()) {
    equipment.push(await prisma.equipment.create({
      data: {
        tenantId,
        contactId: contact.id,
        externalSource: 'demo',
        externalId: `DEMO-EQ-${index + 1}`,
        model: index === 0 ? 'RICOH IM C3000' : 'CANON G7010',
        manufacturer: index === 0 ? 'RICOH' : 'CANON',
        serialNumber: `SERIE-DEMO-${index + 1}`,
        sector: index === 0 ? 'Financeiro' : 'Recepção',
      },
    }));
  }
  await prisma.serviceOrder.createMany({ data: equipment.map((item, index) => ({
    tenantId,
    contactId: contacts[index].id,
    equipmentId: item.id,
    externalSource: 'demo',
    externalId: `DEMO-OS-${index + 1}`,
    cdOstp: `OS-DEMO-${String(index + 1).padStart(3, '0')}`,
    defect: index === 0 ? 'Troca de toner preto' : 'Equipamento não imprime',
    status: index === 0 ? 'PENDENTE' : 'EM_ATENDIMENTO',
    technicalNotes: index === 0 ? null : 'Diagnóstico iniciado pelo técnico.',
    createdAt: daysAgo(index + 1),
    updatedAt: new Date(),
  })) });
}

async function main() {
  const existing = await prisma.tenant.findUnique({ where: { slug: 'demo-lcd' }, select: { id: true } });
  if (existing) {
    const demoCustomer = await prisma.crmCustomer.findFirst({ where: { tenantId: existing.id, externalId: 'DEMO-001' } });
    const demoContact = await prisma.contact.findFirst({ where: { tenantId: existing.id, phone: '5551998765432' } });
    if (demoCustomer && demoContact && demoContact.crmCustomerId !== demoCustomer.id) {
      await prisma.contact.update({ where: { id: demoContact.id }, data: { crmCustomerId: demoCustomer.id } });
    }
    await ensureDemoServiceOrders(existing.id);
    await prisma.waInstance.updateMany({
      where: { tenantId: existing.id },
      data: { status: 'connected', healthStatus: 'healthy', lastConnectionState: 'open', lastHealthError: null },
    });
    console.log('Tenant demo-lcd ja existe; instancias demo restauradas como conectadas.');
    return;
  }

  const password = await bcrypt.hash('demo1234', 10);
  const tenant = await prisma.tenant.create({
    data: {
      name: 'LCD Digital (Ambiente local)',
      slug: 'demo-lcd',
      plan: 'enterprise',
      maxConnections: 5,
      maxUsers: 20,
      primaryColor: '#D4AF37',
      settings: {
        create: {
          botEnabled: true,
          botName: 'LCD Bot Demo',
          botTransferWord: 'atendente',
          companyName: 'LCD Digital - Ambiente local',
          companyPhone: '(51) 3333-0000',
          companyCity: 'Porto Alegre',
          companyState: 'RS',
          ratingEnabled: true,
          firebirdSyncEnabled: false,
        },
      },
    },
  });

  const [admin, agent, finance] = await Promise.all([
    prisma.user.create({ data: { tenantId: tenant.id, name: 'Luciano (Admin)', email: 'admin@demo.local', password, role: 'admin', accessProfile: 'admin' } }),
    prisma.user.create({ data: { tenantId: tenant.id, name: 'Ana Atendimento', email: 'ana@demo.local', password, role: 'agent', accessProfile: 'agent' } }),
    prisma.user.create({ data: { tenantId: tenant.id, name: 'Carlos Financeiro', email: 'financeiro@demo.local', password, role: 'agent', accessProfile: 'financeiro' } }),
  ]);

  const team = await prisma.team.create({ data: { tenantId: tenant.id, name: 'Atendimento geral' } });
  await prisma.teamMember.createMany({ data: [{ teamId: team.id, userId: admin.id }, { teamId: team.id, userId: agent.id }] });

  const [atendimento, financeiro, oficial] = await Promise.all([
    prisma.waInstance.create({ data: { tenantId: tenant.id, instanceName: 'lcd-atendimento', phone: '5551994412679', status: 'connected', healthStatus: 'healthy', lastConnectionState: 'open', lastConnectionAt: new Date(), lastWebhookAt: new Date(), provider: 'evolution_qr' } }),
    prisma.waInstance.create({ data: { tenantId: tenant.id, instanceName: 'lcd-financeiro', phone: '5555193896363', status: 'connected', healthStatus: 'healthy', lastConnectionState: 'open', lastConnectionAt: new Date(), lastWebhookAt: new Date(), provider: 'evolution_qr' } }),
    prisma.waInstance.create({ data: { tenantId: tenant.id, instanceName: 'oficial', phone: '555556498525', status: 'connected', healthStatus: 'healthy', lastConnectionState: 'open', lastConnectionAt: new Date(), lastWebhookAt: new Date(), provider: 'meta_cloud' } }),
  ]);

  const tagData = [
    { name: 'Urgente', color: '#EF6A6A' },
    { name: 'Financeiro', color: '#8B7CFF' },
    { name: 'Tecnico', color: '#56C8D8' },
    { name: 'VIP', color: '#D4AF37' },
  ];
  await prisma.tag.createMany({ data: tagData.map((tag) => ({ ...tag, tenantId: tenant.id })) });

  const quickResponses = [
    ['/ola', 'Olá! Sou da equipe LCD Digital. Como posso ajudar?'],
    ['/prazo', 'Vou verificar o prazo e retorno para você em seguida.'],
    ['/boleto', 'Vou encaminhar o boleto atualizado neste atendimento.'],
  ];
  await prisma.quickResponse.createMany({ data: quickResponses.map(([shortcut, message], index) => ({ tenantId: tenant.id, shortcut, message, category: index === 2 ? 'FINANCEIRO' : 'GERAL', isFavorite: index === 0 })) });

  const contacts = await Promise.all([
    ['Mariana Souza', '5551998765432', atendimento, 'Empresa Horizonte', 'financeiro'],
    ['Rafael Oliveira', '5551987654321', atendimento, 'Colégio Monte Azul', 'tecnico'],
    ['Juliana Martins', '5551976543210', financeiro, 'Grupo Sul', 'financeiro'],
    ['Felipe Costa', '5551965432109', atendimento, 'Felipe Costa', 'vip'],
    ['Patricia Lima', '5551954321098', oficial, 'Clínica Vida', 'tecnico'],
    ['Roberto Mendes', '5551943210987', atendimento, 'Roberto Mendes', ''],
    ['Aline Freitas', '5551932109876', financeiro, 'Aline Freitas', 'financeiro'],
    ['Bruno Teixeira', '5551921098765', atendimento, 'Bruno Teixeira', ''],
  ].map(([name, phone, instance, fantasyName, label]) => prisma.contact.create({
    data: {
      tenantId: tenant.id,
      instanceId: instance.id,
      phone,
      whatsapp: phone,
      whatsappJid: `${phone}@s.whatsapp.net`,
      name,
      fantasyName,
      email: `${phone.slice(-4)}@demo.local`,
      city: 'Porto Alegre',
      state: 'RS',
      tags: label ? JSON.stringify([label]) : '[]',
      notes: 'Contato criado para validação local da interface.',
      enableWhatsAppAlerts: true,
    },
  })));

  const ticketSpecs = [
    { contact: contacts[0], instance: atendimento, status: 'open', priority: 'urgent', agent: agent, unreadCount: 2, subject: 'Boleto vencido - segunda via' },
    { contact: contacts[1], instance: atendimento, status: 'pending', priority: 'high', agent: null, unreadCount: 1, subject: 'Equipamento parado' },
    { contact: contacts[2], instance: financeiro, status: 'open', priority: 'medium', agent: finance, unreadCount: 0, subject: 'Conferencia de faturamento' },
    { contact: contacts[3], instance: atendimento, status: 'open', priority: 'low', agent: agent, unreadCount: 0, subject: 'Solicitacao comercial' },
    { contact: contacts[4], instance: oficial, status: 'pending', priority: 'urgent', agent: null, unreadCount: 4, subject: 'Chamado tecnico - impressora' },
    { contact: contacts[5], instance: atendimento, status: 'resolved', priority: 'medium', agent: agent, unreadCount: 0, subject: 'Troca de toner' },
    { contact: contacts[6], instance: financeiro, status: 'bot', priority: 'medium', agent: null, unreadCount: 1, subject: 'Nota fiscal' },
    { contact: contacts[7], instance: atendimento, status: 'open', priority: 'high', agent: agent, unreadCount: 0, subject: 'Atualizacao cadastral' },
  ];

  for (let index = 0; index < ticketSpecs.length; index += 1) {
    const spec = ticketSpecs[index];
    const createdAt = daysAgo(index % 4, index);
    const ticket = await prisma.ticket.create({
      data: {
        tenantId: tenant.id,
        instanceId: spec.instance.id,
        contactId: spec.contact.id,
        teamId: team.id,
        agentId: spec.agent?.id || null,
        status: spec.status,
        priority: spec.priority,
        subject: spec.subject,
        unreadCount: spec.unreadCount,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
        lastMessageAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
        lastCustomerMessageAt: createdAt,
        sessionStartedAt: createdAt,
        slaDueAt: new Date(createdAt.getTime() + 8 * 60 * 60 * 1000),
        resolvedAt: spec.status === 'resolved' ? new Date(createdAt.getTime() + 2 * 60 * 60 * 1000) : null,
      },
    });

    await prisma.message.createMany({ data: [
      { ticketId: ticket.id, body: `Olá, preciso de ajuda com ${spec.subject.toLowerCase()}.`, fromMe: false, createdAt },
      { ticketId: ticket.id, body: spec.status === 'resolved' ? 'Tudo certo, obrigado pelo atendimento!' : 'Olá! Já vou verificar isso para você.', fromMe: true, agentId: spec.agent?.id || admin.id, createdAt: new Date(createdAt.getTime() + 10 * 60 * 1000) },
    ] });
  }

  const customer = await prisma.crmCustomer.create({ data: { tenantId: tenant.id, externalId: 'DEMO-001', name: 'Empresa Horizonte Ltda.', fantasyName: 'Horizonte', cpfCnpj: '12.345.678/0001-90', phone: '5551998765432', city: 'Porto Alegre', state: 'RS', email: 'contato@horizonte.demo', address: 'Rua das Flores, 100', externalSource: 'demo' } });
  await prisma.contact.update({ where: { id: contacts[0].id }, data: { crmCustomerId: customer.id } });
  await prisma.crmEquipment.createMany({ data: [
    { tenantId: tenant.id, customerId: customer.id, externalId: 'EQ-001', model: 'RICOH IM C3000', manufacturer: 'RICOH', serialNumber: 'RCH-DEMO-001', city: 'Porto Alegre', state: 'RS', isActive: true, externalSource: 'demo' },
    { tenantId: tenant.id, customerId: customer.id, externalId: 'EQ-002', model: 'CANON G7010', manufacturer: 'CANON', serialNumber: 'CAN-DEMO-002', city: 'Porto Alegre', state: 'RS', isActive: true, externalSource: 'demo' },
  ] });

  await prisma.revenueSnapshot.create({ data: { tenantId: tenant.id, snapshotDate: new Date(), mrrInRisk: 32606.60, vazamentoValor: 4200, stalledCount: 2, avgOpenHours: 14.5, avgSlaHours: 8.2, avgCsat: 4.6 } });
  await ensureDemoServiceOrders(tenant.id);

  console.log('Demo local criada.');
  console.log('Login: admin@demo.local / demo1234');
  console.log('Empresa: demo-lcd');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
