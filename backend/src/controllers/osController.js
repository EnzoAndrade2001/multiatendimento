const prisma = require('../lib/prisma');
const pdfmake = require('pdfmake');
const path = require('path');
const fs = require('fs');
const { draftServiceOrder } = require('../services/geminiService');
const evolutionService = require('../services/evolutionService');

// WhatsApp pessoal do Robson: recebe aviso de toda O.S. aberta pelo CRM
const ROBSON_WHATSAPP = '555194414291';

async function notifyRobsonNewOS(tenantId, os) {
  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings?.evolutionUrl || !settings?.evolutionKey) {
      console.log('[notifyRobsonNewOS] Evolution não configurada, aviso não enviado.');
      return;
    }

    const instance = await prisma.waInstance.findFirst({
      where: { tenantId, status: 'connected' }
    });
    if (!instance) {
      console.log('[notifyRobsonNewOS] Nenhuma instância de WhatsApp conectada, aviso não enviado.');
      return;
    }

    const clienteNome = os.contact?.fantasyName || os.contact?.name || 'Cliente não identificado';
    const equipamento = [os.equipment?.manufacturer, os.equipment?.model].filter(Boolean).join(' ') || 'N/A';
    const numeroOS = os.externalId || os.id.slice(-6).toUpperCase();

    const texto = `🛠️ *NOVA O.S. ABERTA NO CRM*\n\n`
      + `*Nº:* ${numeroOS}\n`
      + `*Cliente:* ${clienteNome}\n`
      + `*Equipamento:* ${equipamento}\n`
      + `*Defeito:* ${os.defect || 'Não informado'}\n`
      + `*Técnico:* ${os.nmsuportet || 'Não definido'}`;

    await evolutionService.sendText(settings.evolutionUrl, settings.evolutionKey, instance.instanceName, ROBSON_WHATSAPP, texto);
    console.log(`[notifyRobsonNewOS] Aviso de nova O.S. enviado para ${ROBSON_WHATSAPP}.`);
  } catch (err) {
    console.error('[notifyRobsonNewOS] erro ao notificar Robson:', err.message);
  }
}

async function getEquipments(req, res) {
  const { contactId } = req.params;
  const { tenantId } = req.user;

  try {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return res.json([]);

    // Sincroniza os equipamentos do CRM para o contato
    const { syncCrmEquipmentsToEquipment } = require('../services/crmSyncService');
    await syncCrmEquipmentsToEquipment(tenantId, contactId);

    const equipments = await prisma.equipment.findMany({
      where: {
        tenantId,
        isActive: true,
        contactId
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(equipments);
  } catch (err) {
    console.error('[getEquipments] erro crítico:', err);
    res.status(500).json({ error: 'Erro ao buscar equipamentos' });
  }
}

async function addEquipment(req, res) {
  const { contactId } = req.params;
  const { manufacturer, model, serialNumber, sector, address, type } = req.body;
  const equipment = await prisma.equipment.create({
    data: {
      tenantId: req.user.tenantId,
      contactId,
      manufacturer,
      model,
      serialNumber,
      sector,
      address,
      type
    }
  });
  res.json(equipment);
}

async function updateEquipment(req, res) {
  const { id } = req.params;
  const { manufacturer, model, serialNumber, sector, address, type, isActive } = req.body;
  const equipment = await prisma.equipment.update({
    where: { id, tenantId: req.user.tenantId },
    data: { manufacturer, model, serialNumber, sector, address, type, isActive }
  });
  res.json(equipment);
}

async function deleteEquipment(req, res) {
  const { id } = req.params;
  const { tenantId } = req.user;
  try {
    await prisma.equipment.delete({ where: { id, tenantId } });
    res.json({ message: 'Equipamento excluído com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir equipamento' });
  }
}

async function getOSList(req, res) {
  const { startDate, endDate, search, status } = req.query;
  const { tenantId } = req.user;

  const where = { tenantId };

  if (status) {
    where.status = status;
  }

  if (startDate && startDate.length > 0) {
    if (!where.createdAt) where.createdAt = {};
    where.createdAt.gte = new Date(startDate);
  }
  if (endDate && endDate.length > 0) {
    if (!where.createdAt) where.createdAt = {};
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    where.createdAt.lte = end;
  }

  if (search) {
    where.OR = [
      { id: { contains: search, mode: 'insensitive' } },
      { contact: { name: { contains: search, mode: 'insensitive' } } },
      { contact: { fantasyName: { contains: search, mode: 'insensitive' } } },
      { equipment: { model: { contains: search, mode: 'insensitive' } } },
      { equipment: { serialNumber: { contains: search, mode: 'insensitive' } } },
      { equipment: { contact: { name: { contains: search, mode: 'insensitive' } } } },
      { equipment: { contact: { fantasyName: { contains: search, mode: 'insensitive' } } } }
    ];
  }

  const orders = await prisma.serviceOrder.findMany({
    where,
    include: {
      contact: true,
      equipment: {
        include: {
          contact: true
        }
      },
      user: { select: { name: true } },
      closedBy: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  res.json(orders);
}

async function createOS(req, res) {
  const { contactId, equipmentId, ticketId, defect, status, cdOstp, nmsuportet } = req.body;
  const { tenantId } = req.user;

  try {
    const os = await prisma.serviceOrder.create({
      data: {
        tenantId,
        userId: req.user.id,
        contactId,
        equipmentId,
        ticketId,
        defect,
        status: status || 'PENDENTE',
        cdOstp,
        nmsuportet,
        // Toda O.S. aberta pelo CRM é enviada para o CRM legado (Firebird) do Robson,
        // independente da origem do equipamento.
        externalSource: 'firebird',
        externalId: null
      },
      include: { contact: true, equipment: true }
    });
    res.json(os);

    // Avisa o Robson no WhatsApp pessoal dele (não bloqueia a resposta da API)
    notifyRobsonNewOS(tenantId, os);
  } catch (err) {
    console.error('[createOS] erro:', err.message);
    res.status(500).json({ error: 'Erro ao criar ordem de serviço.' });
  }
}

async function getOSTypes(req, res) {
  try {
    const types = await prisma.crmOsType.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { code: 'asc' }
    });
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOSTechnicians(req, res) {
  try {
    const techs = await prisma.crmTechnician.findMany({
      where: { tenantId: req.user.tenantId, isActive: true },
      orderBy: { name: 'asc' }
    });
    res.json(techs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateOS(req, res) {
  const { id } = req.params;
  const { status, technicalNotes, meters } = req.body;
  const { tenantId, id: userId } = req.user;

  // Trava de segurança: Exigir relatório para finalizar ou arquivar
  if ((status === 'FINALIZADA' || status === 'ARQUIVADA') && (!technicalNotes || technicalNotes.trim().length < 5)) {
    return res.status(400).json({ error: 'Relatório Técnico é obrigatório para finalizar ou arquivar a O.S.' });
  }

  const data = {
    status,
    technicalNotes,
    meters: meters ? JSON.stringify(meters) : undefined
  };

  if (status === 'FINALIZADA' || status === 'ARQUIVADA') {
    data.closedAt = new Date();
    data.closedById = userId;
  }

  const os = await prisma.serviceOrder.update({
    where: { id, tenantId },
    data,
    include: { contact: true, equipment: true }
  });
  res.json(os);
}

async function generatePdf(req, res) {
  const { id } = req.params;
  const os = await prisma.serviceOrder.findFirst({
    where: { id, tenantId: req.user.tenantId },
    include: { 
      contact: true, 
      equipment: true, 
      tenant: { include: { settings: true } },
      user: true 
    }
  });

  if (!os) return res.status(404).json({ error: 'O.S. não encontrada' });

  // Busca o cliente real (empresa vinculada)
  let clientData = os.contact;
  let solicitante = os.contact.name;
  
  try {
    const filters = [];
    if (os.contact.phone) {
      filters.push({ whatsapp: os.contact.phone });
      filters.push({ phone: os.contact.phone });
    }
    if (os.contact.whatsapp) {
      filters.push({ phone: os.contact.whatsapp });
      filters.push({ whatsapp: os.contact.whatsapp });
    }

    if (filters.length > 0) {
      const linked = await prisma.contact.findFirst({
        where: {
          tenantId: req.user.tenantId,
          id: { not: os.contactId },
          AND: [
            { OR: filters },
            {
              OR: [
                { fantasyName: { not: '' } },
                { cpfCnpj: { not: '' } },
                { name: { contains: 'AFABAN' } }
              ]
            }
          ]
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      if (linked) {
        clientData = linked;
      }
    }
  } catch (err) {
    console.error('[generatePdf] erro ao buscar empresa vinculada:', err);
  }

  // Busca dados estruturados adicionais do cliente e equipamento no CRM
  let crmCustomer = null;
  let crmEquipment = null;
  try {
    if (clientData.externalId) {
      crmCustomer = await prisma.crmCustomer.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: 'firebird',
          externalId: clientData.externalId
        }
      });
    }
    // Fallback 1: Buscar por CPF/CNPJ se o externalId não estiver associado no contato
    if (!crmCustomer && clientData.cpfCnpj) {
      crmCustomer = await prisma.crmCustomer.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: 'firebird',
          cpfCnpj: clientData.cpfCnpj
        }
      });
    }
    // Fallback 2: Buscar por nome aproximado
    if (!crmCustomer && clientData.name) {
      crmCustomer = await prisma.crmCustomer.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: 'firebird',
          name: { contains: clientData.name.trim(), mode: 'insensitive' }
        }
      });
    }

    if (os.equipment.externalId) {
      crmEquipment = await prisma.crmEquipment.findFirst({
        where: {
          tenantId: req.user.tenantId,
          externalSource: 'firebird',
          externalId: os.equipment.externalId
        }
      });
    }
  } catch (err) {
    console.error('[generatePdf] erro ao buscar dados estruturados adicionais:', err);
  }

  try {
    const fontsPath = path.join(__dirname, '..', '..', 'node_modules', 'pdfmake', 'fonts', 'Roboto');
    console.log('[generatePdf] Carregando fontes de:', fontsPath);

    const fonts = {
      Roboto: {
        normal: path.join(fontsPath, 'Roboto-Regular.ttf'),
        bold: path.join(fontsPath, 'Roboto-Medium.ttf'),
        italics: path.join(fontsPath, 'Roboto-Italic.ttf'),
        bolditalics: path.join(fontsPath, 'Roboto-MediumItalic.ttf')
      }
    };

    pdfmake.setFonts(fonts);
    
    const dataOS = os.createdAt.toLocaleDateString('pt-BR');
    const horaOS = os.createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const emissionDate = new Date().toLocaleString('pt-BR');
    
    let meters = {};
    if (os.meters && os.meters.trim()) {
      try {
        meters = JSON.parse(os.meters);
      } catch (e) {
        console.error('[generatePdf] Erro ao parsear medidores:', os.meters);
      }
    }

    const settings = os.tenant.settings;
    const primaryColor = '#000000'; // Cor padrão preto

    // Fallback inteligente para dados da empresa
    const company = {
      name: settings?.companyName || 'CLAUDIA CARDINALI DOS SANTOS FONTOURA LTDA',
      cnpj: settings?.companyCnpj || '35.692.721/0001-94',
      ie: settings?.companyIE || '0963799100',
      address: settings?.companyAddress || 'RUA VINTE E QUATRO DE AGOSTO, 103',
      bairro: settings?.companyBairro || 'JARDIM SABARA',
      cep: settings?.companyCep || '91.215-280',
      city: settings?.companyCity || 'PORTO ALEGRE',
      state: settings?.companyState || 'RS',
      phone: settings?.companyPhone || '(051) 3028-3222'
    };

    // Identificação do atendente com fallback para o usuário atual que está gerando o documento
    let attendantName = os.user ? os.user.name : 'N/A';
    if ((attendantName === 'N/A' || !os.user) && req.user?.userId) {
      const activeUser = await prisma.user.findUnique({
        where: { id: req.user.userId }
      });
      if (activeUser) {
        attendantName = activeUser.name;
      }
    }

    // Tradução limpa do tipo de O.S.
    let displayOsType = 'ATENDIMENTO AVULSO';
    if (os.cdOstp === '01') {
      displayOsType = 'ATENDIMENTO CONTRATOS';
    } else if (os.cdOstp) {
      // Se tiver outro código cadastrado, tenta cruzar com o nome do tipo
      const typeRecord = await prisma.crmOsType.findFirst({
        where: { tenantId: req.user.tenantId, code: os.cdOstp }
      });
      if (typeRecord) {
        displayOsType = typeRecord.name.toUpperCase();
      } else {
        displayOsType = `TIPO ${os.cdOstp}`;
      }
    }

    const docDefinition = {
      pageSize: 'A4',
      pageMargins: [30, 20, 30, 25],
      footer: (currentPage, pageCount) => {
        return {
          stack: [
            { canvas: [{ type: 'line', x1: 30, y1: 0, x2: 565, y2: 0, lineWidth: 0.5, lineColor: '#EEEEEE' }] },
            {
              columns: [
                { text: `Documento gerado em ${emissionDate}`, fontSize: 6.5, color: '#999', margin: [30, 6, 0, 0] },
                { text: `Página ${currentPage} de ${pageCount}`, fontSize: 6.5, color: '#999', alignment: 'right', margin: [0, 6, 30, 0] }
              ]
            }
          ]
        };
      },
      content: [
        // Top Banner / Header
        {
          table: {
            widths: [100, '*', 180],
            body: [
              [
                {
                  stack: (() => {
                    try {
                      if (os.tenant.logoUrl) {
                        const logoFilename = os.tenant.logoUrl.split('/').pop();
                        const logoPath = path.resolve(__dirname, '..', '..', 'uploads', logoFilename);
                        const ext = path.extname(logoFilename).toLowerCase();
                        const allowed = ['.png', '.jpg', '.jpeg'];
                        if (allowed.includes(ext) && fs.existsSync(logoPath)) {
                          return [{ image: logoPath, width: 85, alignment: 'center', margin: [0, 10, 0, 10] }];
                        }
                      }
                    } catch (err) {}
                    return [{ text: 'LOGO', style: 'logoPlaceholder' }];
                  })(),
                  border: [true, true, true, true],
                  borderColor: ['#333333', '#333333', '#333333', '#333333']
                },
                {
                  stack: [
                    { text: company.name, bold: true, fontSize: 10, margin: [0, 2, 0, 2], color: primaryColor, alignment: 'center' },
                    { text: `CNPJ: ${company.cnpj}   |   Insc.Estadual: ${company.ie}`, fontSize: 7.5, margin: [0, 0, 0, 1], color: '#333', alignment: 'center' },
                    { text: `Endereço: ${company.address}`, fontSize: 7.5, margin: [0, 0, 0, 1], color: '#333', alignment: 'center' },
                    { text: `Cidade: ${company.city} (${company.state})   |   Bairro: ${company.bairro}`, fontSize: 7.5, margin: [0, 0, 0, 1], color: '#333', alignment: 'center' },
                    { text: `Fone: ${company.phone}   |   CEP: ${company.cep}`, fontSize: 7.5, color: '#333', alignment: 'center' }
                  ],
                  border: [false, true, true, true],
                  borderColor: [null, '#333333', '#333333', '#333333']
                },
                {
                  stack: [
                    { text: 'ORDEM DE SERVIÇO', bold: true, fontSize: 11, alignment: 'center', color: '#FFFFFF', margin: [0, 4, 0, 4] },
                    {
                      table: {
                        widths: ['*', '*'],
                        body: [
                          [{ text: 'Número:', style: 'miniLabel' }, { text: `Data: ${dataOS}`, style: 'miniLabel' }],
                          [{ text: os.externalId || os.id.substring(os.id.length - 6).toUpperCase(), style: 'miniValue' }, { text: `Hora: ${horaOS}`, style: 'miniLabel' }],
                          [{ text: `Atendente: ${attendantName.toUpperCase()}`, style: 'miniLabel', colSpan: 2 }, {}],
                          [{ text: `Técnico: ${(os.nmsuportet || 'N/A').toUpperCase()}`, style: 'miniLabel', colSpan: 2 }, {}],
                          [{ text: `Tipo O.S.: ${displayOsType}`, style: 'miniLabel', colSpan: 2 }, {}]
                        ]
                      },
                      layout: 'noBorders',
                      margin: [5, 2, 5, 2]
                    }
                  ],
                  fillColor: primaryColor,
                  border: [false, true, true, true],
                  borderColor: [null, '#333333', '#333333', '#333333']
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#333333',
            vLineColor: () => '#333333'
          }
        },

        // Client Data Section
        { 
          table: {
            widths: ['*'],
            body: [[{ text: 'Cliente / Equipamento', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*', '*'],
            body: [
              [
                { text: [{ text: 'Cliente: ', style: 'label' }, { text: clientData.externalId ? `${clientData.externalId} - ${clientData.name}` : (clientData.name || 'N/A'), style: 'value' }], colSpan: 2, border: [true, false, true, true] },
                {}
              ],
              [
                { text: [{ text: 'Endereço: ', style: 'label' }, { text: crmCustomer?.address || clientData.address || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Equipamento: ', style: 'label' }, { text: os.equipment.externalId ? `${os.equipment.externalId} - ${os.equipment.model || 'N/A'}` : 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Bairro: ', style: 'label' }, { text: crmCustomer?.neighborhood || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Modelo: ', style: 'label' }, { text: os.equipment.model || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Cidade: ', style: 'label' }, { text: crmCustomer?.city ? `${crmCustomer.city} (${crmCustomer.state || 'RS'})` : (clientData.city ? `${clientData.city} (${clientData.state || 'RS'})` : 'N/A'), style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Série: ', style: 'label' }, { text: os.equipment.serialNumber || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'CNPJ/CPF: ', style: 'label' }, { text: crmCustomer?.cpfCnpj || clientData.cpfCnpj || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Tipo de Contrato: ', style: 'label' }, { text: crmEquipment?.contractExternalId || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Contato: ', style: 'label' }, { text: crmCustomer?.contactName || solicitante || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Departamento: ', style: 'label' }, { text: crmEquipment?.raw?.['departamento'] || crmEquipment?.raw?.['DEPARTAMENTO'] || os.equipment.sector || 'N/A', style: 'value' }] }
              ],
              [
                { text: [{ text: 'Fone: ', style: 'label' }, { text: crmCustomer?.phone || os.contact.phone || 'N/A', style: 'value' }], border: [true, false, true, true] },
                { text: [{ text: 'Local Instalação: ', style: 'label' }, { text: crmEquipment?.installLocation || crmEquipment?.raw?.['localinstal'] || crmEquipment?.raw?.['LOCALINSTAL'] || os.equipment.sector || 'N/A', style: 'value' }] }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#CCCCCC',
            vLineColor: () => '#333333',
            paddingTop: () => 3,
            paddingBottom: () => 3
          }
        },

        // Defect Section
        { 
          table: {
            widths: ['*'],
            body: [[{ text: 'Descrição da Visita / Defeito', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  stack: [
                    { text: `Defeito: ${os.defect || 'Nenhum defeito reportado'}`, style: 'boxContent' },
                    { text: '\nSintoma:', style: 'label' },
                    { text: '\nCausa:', style: 'label' },
                    { text: '\nAção:', style: 'label' }
                  ],
                  minHeight: 100,
                  border: [true, false, true, true]
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#333333',
            vLineColor: () => '#333333',
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },

        // Meters Section
        {
          table: {
            widths: ['*'],
            body: [[{ text: 'Leitura de Contadores', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*', '*', '*'],
            body: [
              [
                { 
                  stack: [
                    { text: 'CONTADOR P&B (Mono)', style: 'label', alignment: 'center' },
                    { text: meters.mono || '____________', style: 'meterValue', alignment: 'center' }
                  ],
                  fillColor: '#FAFAFA',
                  border: [true, false, true, true]
                },
                { 
                  stack: [
                    { text: 'CONTADOR COR (Color)', style: 'label', alignment: 'center' },
                    { text: meters.color || '____________', style: 'meterValue', alignment: 'center' }
                  ],
                  fillColor: '#FAFAFA',
                  border: [true, false, true, true]
                },
                { 
                  stack: [
                    { text: 'CONTADOR SCAN', style: 'label', alignment: 'center' },
                    { text: meters.scan || '____________', style: 'meterValue', alignment: 'center' }
                  ],
                  fillColor: '#FAFAFA',
                  border: [true, false, true, true]
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#CCCCCC',
            vLineColor: () => '#333333',
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },

        // Follow-up / Technical Notes Section
        { 
          table: {
            widths: ['*'],
            body: [[{ text: 'Follow-up do Técnico / Peças Substituídas', style: 'sectionTitle', fillColor: '#E0E0E0' }]]
          },
          margin: [0, 8, 0, 0],
          layout: 'noBorders'
        },
        {
          table: {
            widths: ['*'],
            body: [
              [
                {
                  text: os.technicalNotes || '\n\n\n\n\n\n\n\n',
                  style: 'boxContent',
                  minHeight: 120,
                  border: [true, false, true, true]
                }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => '#333333',
            vLineColor: () => '#333333',
            paddingTop: () => 4,
            paddingBottom: () => 4
          }
        },

        // Signatures Section
        {
          margin: [0, 25, 0, 0],
          columns: [
            {
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#333333' }] },
                { text: 'ASSINATURA E CARIMBO DO CLIENTE', style: 'signatureLabel', margin: [0, 4, 0, 0] },
                { text: 'Data: ____/____/____', fontSize: 6.5, color: '#999' }
              ],
              alignment: 'center'
            },
            {
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 1, lineColor: '#333333' }] },
                { text: 'ASSINATURA DO TÉCNICO', style: 'signatureLabel', margin: [0, 4, 0, 0] },
                { text: attendantName.toUpperCase(), fontSize: 6.5, color: '#999' }
              ],
              alignment: 'center'
            }
          ]
        },
        {
          text: 'Declaro que os serviços acima foram executados a contento e os materiais/peças foram fornecidos conforme descrito.',
          style: 'footerNote',
          margin: [0, 15, 0, 0],
          alignment: 'center'
        }
      ],
      styles: {
        sectionTitle: { fontSize: 8.5, bold: true, color: '#000000', margin: [5, 2, 5, 2] },
        label: { fontSize: 7, color: '#333333', bold: true },
        value: { fontSize: 8.5, color: '#000000', bold: false },
        miniLabel: { fontSize: 7, color: '#FFFFFF', bold: true },
        miniValue: { fontSize: 7.5, color: '#FFFFFF', bold: true },
        boxContent: { fontSize: 8.5, lineHeight: 1.2, color: '#333333' },
        meterValue: { fontSize: 11, bold: true, color: '#000000', margin: [0, 2, 0, 0] },
        signatureLabel: { fontSize: 7, color: '#333333', bold: true },
        footerNote: { fontSize: 6.5, italic: true, color: '#888888' },
        logoPlaceholder: { fontSize: 10, bold: true, color: '#CCCCCC', background: '#F9F9F9', alignment: 'center', margin: [0, 10] }
      },
      defaultStyle: { font: 'Roboto' }
    };

    const doc = pdfmake.createPdf(docDefinition);
    const stream = await doc.getStream();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="OS_${os.id.substring(os.id.length - 6)}.pdf"`);
    
    stream.pipe(res);
    stream.end();
  } catch (err) {
    console.error('[generatePdf] erro fatal na geração do PDF:', err);
    if (!res.headersSent) {
      res.status(500).send('Erro ao gerar PDF: ' + err.message);
    }
  }
}

async function draftOS(req, res) {
  const { contactId, ticketId } = req.body;
  const { tenantId } = req.user;

  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings || !settings.geminiKey) return res.status(400).json({ error: 'Chave do Gemini não configurada' });

    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

    // Sincroniza os equipamentos do CRM para o contato
    const { syncCrmEquipmentsToEquipment } = require('../services/crmSyncService');
    await syncCrmEquipmentsToEquipment(tenantId, contactId);

    const equipments = await prisma.equipment.findMany({ 
      where: { 
        tenantId, 
        isActive: true,
        contactId
      } 
    });

    const messages = await prisma.message.findMany({
      where: { 
        ticketId,
        ticket: { tenantId }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    
    // As mensagens vêm desc, o history espera asc (antigas primeiro)
    const history = messages.reverse();

    const draft = await draftServiceOrder(settings.geminiKey, history, equipments);
    res.json(draft);
  } catch (err) {
    console.error('[draftOS]', err);
    res.status(500).json({ error: 'Erro ao gerar rascunho de O.S.' });
  }
}

module.exports = { getEquipments, addEquipment, updateEquipment, deleteEquipment, getOSList, createOS, updateOS, generatePdf, draftOS, getOSTypes, getOSTechnicians };
