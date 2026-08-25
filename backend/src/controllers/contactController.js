const prisma = require('../lib/prisma');
const xlsx = require('xlsx');
const evolutionService = require('../services/evolutionService');

async function list(req, res) {
  const q = req.query.q || req.query.search;
  const withoutDocument = ['1', 'true', 'yes'].includes(String(req.query.withoutDocument || '').toLowerCase());
  console.log(`[Contacts] Busca executada | tenant=${req.user.tenantId} | comFiltro=${Boolean(q)}`);
  const where = { tenantId: req.user.tenantId };
  if (withoutDocument) {
    where.OR = [
      { cpfCnpj: null },
      { cpfCnpj: '' },
    ];
  }
  if (q) where.OR = [
    {
      AND: [
        ...(withoutDocument ? [{ OR: [{ cpfCnpj: null }, { cpfCnpj: '' }] }] : []),
        {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { fantasyName: { contains: q, mode: 'insensitive' } },
            ...(withoutDocument ? [] : [{ cpfCnpj: { contains: q, mode: 'insensitive' } }]),
            { phone: { contains: q } },
            { whatsapp: { contains: q } },
          ],
        },
      ],
    },
  ];

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      tickets: {
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true, status: true, updatedAt: true },
      },
    },
  });
  res.json(contacts);
}

async function getHistory(req, res) {
  const { id } = req.params;
  const contact = await prisma.contact.findFirst({
    where: { id, tenantId: req.user.tenantId },
  });
  if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

  const tickets = await prisma.ticket.findMany({
    where: { contactId: id, tenantId: req.user.tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      agent: { select: { id: true, name: true } },
    },
  });
  res.json({ contact, tickets });
}

async function updateContact(req, res) {
  const { id } = req.params;
  const { 
    notes, tags, name, fantasyName, phone, whatsapp, email,
    cpfCnpj, address, city, state, zipCode,
    enableWhatsAppBilling
  } = req.body;

  const contact = await prisma.contact.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

  let normalizedPhone;
  if (phone !== undefined) {
    normalizedPhone = evolutionService.normalizePhoneNumber(phone);
    if (!normalizedPhone) return res.status(400).json({ error: 'Telefone invalido' });
  }

  let normalizedWhatsApp;
  if (whatsapp !== undefined) {
    normalizedWhatsApp = String(whatsapp || '').trim()
      ? evolutionService.normalizePhoneNumber(whatsapp)
      : null;
    if (String(whatsapp || '').trim() && !normalizedWhatsApp) {
      return res.status(400).json({ error: 'WhatsApp invalido' });
    }
  }

  const updated = await prisma.contact.update({
    where: { id },
    data: {
      ...(notes !== undefined && { notes }),
      ...(tags !== undefined && { tags: typeof tags === 'string' ? tags : JSON.stringify(tags) }),
      ...(name !== undefined && { name }),
      ...(fantasyName !== undefined && { fantasyName: String(fantasyName) }),
      ...(phone !== undefined && { phone: normalizedPhone }),
      ...(whatsapp !== undefined && { whatsapp: normalizedWhatsApp }),
      ...(email !== undefined && { email }),
      ...(cpfCnpj !== undefined && { cpfCnpj }),
      ...(address !== undefined && { address }),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(zipCode !== undefined && { zipCode }),
      ...(enableWhatsAppBilling !== undefined && { enableWhatsAppBilling: Boolean(enableWhatsAppBilling) }),
    },
  });
  res.json(updated);
}

async function getMedia(req, res) {
  const { id } = req.params;
  const contact = await prisma.contact.findFirst({ where: { id, tenantId: req.user.tenantId } });
  if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

  const messages = await prisma.message.findMany({
    where: {
      ticket: { contactId: id, tenantId: req.user.tenantId },
      mediaUrl: { not: null },
      mediaType: { in: ['image', 'document', 'audio'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, mediaUrl: true, mediaType: true, body: true, createdAt: true },
  });
  res.json(messages);
}

async function create(req, res) {
  const { 
    name, phone, fantasyName, email, cpfCnpj, 
    address, city, state, zipCode, instanceId,
    equipment // Objeto opcional { manufacturer, model, serialNumber, type, sector }
  } = req.body;
  const { tenantId } = req.user;

  const cleanPhone = evolutionService.normalizePhoneNumber(phone);
  if (!cleanPhone) return res.status(400).json({ error: 'Telefone invalido' });

  const phoneCandidates = evolutionService.buildPhoneLookupCandidates(cleanPhone);
  const exists = await prisma.contact.findFirst({
    where: {
      tenantId,
      OR: [
        { phone: { in: phoneCandidates } },
        { whatsapp: { in: phoneCandidates } },
      ],
    },
  });
  if (exists) return res.status(400).json({ error: 'Telefone já cadastrado' });

  let finalInstanceId = instanceId;
  if (!finalInstanceId) {
    const inst = await prisma.waInstance.findFirst({ where: { tenantId, status: { in: ['CONNECTED', 'connected', 'open'] } } });
    if (!inst) {
      const anyInst = await prisma.waInstance.findFirst({ where: { tenantId } });
      if (!anyInst) return res.status(400).json({ error: 'Nenhuma conexão WhatsApp encontrada' });
      finalInstanceId = anyInst.id;
    } else {
      finalInstanceId = inst.id;
    }
  }

  const contact = await prisma.contact.create({
    data: { 
      name, 
      phone: cleanPhone, 
      fantasyName: fantasyName || null,
      email: email || null,
      cpfCnpj: cpfCnpj || null,
      address: address || null,
      city: city || null,
      state: state || null,
      zipCode: zipCode || null,
      tenantId, 
      instanceId: finalInstanceId 
    }
  });

  // Cria equipamento se fornecido
  if (equipment && equipment.model) {
    await prisma.equipment.create({
      data: {
        tenantId,
        contactId: contact.id,
        manufacturer: equipment.manufacturer || null,
        model: equipment.model,
        serialNumber: equipment.serialNumber || null,
        type: equipment.type || null,
        sector: equipment.sector || 'Geral'
      }
    });
  }

  res.json(contact);
}

async function getTags(req, res) {
  const { tenantId } = req.user;
  const contacts = await prisma.contact.findMany({
    where: { tenantId },
    select: { tags: true }
  });

  const allTags = new Set();
  contacts.forEach(c => {
    try {
      const tags = JSON.parse(c.tags || '[]');
      tags.forEach(t => allTags.add(t));
    } catch {}
  });

  res.json(Array.from(allTags));
}

async function importExcel(req, res) {
  console.log('[importExcel] Request received', { file: req.file?.originalname, size: req.file?.size });
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const { tenantId } = req.user;

    // Busca uma instância para vincular os contatos (prioriza conectada, mas aceita qualquer uma para testes)
    let inst = await prisma.waInstance.findFirst({ 
      where: { 
        tenantId, 
        status: { in: ['CONNECTED', 'connected', 'open'] } 
      } 
    });

    if (!inst) {
      inst = await prisma.waInstance.findFirst({ where: { tenantId } });
    }
    
    if (!inst) return res.status(400).json({ error: 'Nenhuma instância de WhatsApp encontrada para este tenant. Crie uma conexão primeiro (mesmo que não conectada) para permitir a importação.' });

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let importedContacts = 0;
    let importedEquipments = 0;

    for (const row of rows) {
      // Mapeamento esperado: Nome, Telefone, CNPJ, Endereço, Modelo Equipamento, Número Série, Setor Equipamento
      // Adaptar para nomes das colunas ou buscar chaves de forma flexível
      // Mapeamento Flexível de Colunas
      const rawName = row['Cliente (Razão)'] || row['Cliente'] || row['NOME'] || row['Nome'] || row['cliente'];
      const name = rawName ? String(rawName).trim() : null;
      
      const rawFantasy = row['Cliente (Fantasia)'] || row['Fantasia'] || row['Nome Fantasia'] || row['fantasyName'];
      const fantasyName = rawFantasy ? String(rawFantasy).trim() : null;
      
      const rawCpf = row['CNPJ'] || row['CPF'] || row['CpfCnpj'] || row['cpfCnpj'] || row['CNPJ/CPF'];
      const cpfCnpj = rawCpf ? String(rawCpf).trim() : null;
      
      let phone = row['Celular'] || row['Fone (1)'] || row['Fone'] || row['TELEFONE'] || row['Telefone'] || row['phone'] || row['whatsapp'];
      
      const addr = row['Endereço'] || row['ENDEREÇO'] || row['Rua'] || row['address'];
      const num = row['Número'] || '';
      const address = [addr, num].filter(Boolean).join(', ');
      
      const city = row['Cidade'] || row['CIDADE'] || row['city'];
      const state = row['UF'] || row['ESTADO'] || row['State'];
      const bairro = row['Bairro'] || row['BAIRRO'] || '';
      
      const equipModel = row['Modelo'] || row['MODELO'] || row['Modelo Equipamento'] || row['Equipamento'] || row['Máquina'] || row['model'];
      const equipSerial = row['Serie'] || row['SERIE'] || row['Série'] || row['Número Série'] || row['serial'];
      const equipManufacturer = row['Fabricante'] || row['FABRICANTE'] || row['manufacturer'];
      const equipType = row['Equipamento Tipo'] || row['Tipo'] || row['TIPO'] || row['type'];
      // Local de instalação e Departamento são detalhes do equipamento
      const loc = row['Local Instalação'] || '';
      const dep = row['Departamento'] || '';
      const equipSector = [dep, loc].filter(Boolean).join(' - ') || 'Geral';
      const equipAddr = address; // O endereço da linha da planilha vai para o equipamento individual

      if (!phone) continue;
      phone = evolutionService.normalizePhoneNumber(phone);
      if (!phone) continue;

      const phoneCandidates = evolutionService.buildPhoneLookupCandidates(phone);

      // Upsert do Contato - Tenta encontrar por telefone, ou CPF/CNPJ, ou Nome Fantasia
      let contact = await prisma.contact.findFirst({ 
        where: { 
          tenantId,
          OR: [
            { phone: { in: phoneCandidates } },
            { whatsapp: { in: phoneCandidates } },
            cpfCnpj ? { cpfCnpj } : undefined,
            fantasyName ? { fantasyName } : undefined,
            name ? { name } : undefined
          ].filter(Boolean)
        } 
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: { tenantId, instanceId: inst.id, phone, name, fantasyName, cpfCnpj, address, city, state }
        });
        importedContacts++;
      } else {
        await prisma.contact.update({
          where: { id: contact.id },
          data: { 
            name: name || contact.name, 
            fantasyName: fantasyName || contact.fantasyName,
            cpfCnpj: cpfCnpj || contact.cpfCnpj, 
            address: address || contact.address,
            city: city || contact.city,
            state: state || contact.state,
            // Se o contato antigo não tinha telefone mas o novo tem, atualiza
            phone: contact.phone || phone 
          }
        });
      }

      // Adiciona o Equipamento se existir
      if (equipModel) {
        const existEquip = await prisma.equipment.findFirst({
          where: { contactId: contact.id, serialNumber: equipSerial ? String(equipSerial) : null, model: equipModel }
        });

        if (!existEquip) {
          await prisma.equipment.create({
            data: {
              tenantId,
              contactId: contact.id,
              model: String(equipModel),
              manufacturer: equipManufacturer ? String(equipManufacturer) : null,
              type: equipType ? String(equipType) : null,
              serialNumber: equipSerial ? String(equipSerial) : null,
              sector: equipSector ? String(equipSector) : null,
              address: equipAddr ? String(equipAddr) : null
            }
          });
          importedEquipments++;
        } else {
          // Atualiza o equipamento existente com os novos campos (Fabricante, Tipo, etc)
          await prisma.equipment.update({
            where: { id: existEquip.id },
            data: {
              manufacturer: equipManufacturer ? String(equipManufacturer) : (existEquip.manufacturer),
              type: equipType ? String(equipType) : (existEquip.type),
              sector: equipSector ? String(equipSector) : (existEquip.sector),
              address: equipAddr ? String(equipAddr) : (existEquip.address)
            }
          });
          importedEquipments++;
        }
      }
    }

    res.json({ success: true, message: `Importação concluída. ${importedContacts} contatos e ${importedEquipments} equipamentos cadastrados/atualizados.` });
  } catch (err) {
    console.error('[importExcel] erro:', err.message);
    res.status(500).json({ error: 'Erro ao importar planilha' });
  }
}

async function deleteContact(req, res) {
  const { id } = req.params;
  const { tenantId } = req.user;
  try {
    await prisma.contact.delete({ where: { id, tenantId } });
    res.json({ message: 'Contato excluído com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir contato' });
  }
}

module.exports = { list, getHistory, updateContact, getMedia, create, getTags, importExcel, deleteContact };
