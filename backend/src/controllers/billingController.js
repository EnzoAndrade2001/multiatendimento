const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const evolutionService = require('../services/evolutionService');
const billingDocuments = require('../services/billingDocumentService');
const { mediaPath } = require('../utils/uploads');

let io = null;

function setIo(socketIo) {
  io = socketIo;
}

function resolveToken(tenant) {
  return tenant?.settings?.firebirdClientToken || process.env.FIREBIRD_SYNC_TOKEN || '';
}

function assertToken(req, tenant) {
  const expected = resolveToken(tenant);
  const provided = req.header('x-firebird-token') || req.header('authorization')?.replace(/^Bearer\s+/i, '');

  if (!expected) {
    throw new Error('Token de sincronização não configurado no CRM.');
  }

  if (!provided || provided !== expected) {
    throw new Error('Token de sincronização inválido.');
  }
}

function getCpfCnpjVariations(query) {
  const clean = String(query || '').replace(/\D/g, '');
  if (!clean) return [];

  const variations = [clean, String(query)];

  if (clean.length === 11) {
    const formatted = `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
    variations.push(formatted);
  } else if (clean.length === 14) {
    const formatted = `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12, 14)}`;
    variations.push(formatted);
  }

  return [...new Set(variations)];
}

function normalizeBillingPhone(value) {
  const normalized = evolutionService.normalizePhoneNumber(value);
  if (!normalized || String(normalized).toLowerCase().endsWith('@g.us')) return '';

  const digits = String(normalized).replace(/\D/g, '');
  // O iLux desta operação usa números brasileiros: 55 + DDD + 8/9 dígitos.
  // Impede transformar valores como "05101" em "5505101".
  if (!digits.startsWith('55') || ![12, 13].includes(digits.length)) return '';
  return digits;
}

function getBillingContactPhone(contact) {
  for (const candidate of [contact?.whatsapp, contact?.whatsappJid, contact?.phone]) {
    const normalized = normalizeBillingPhone(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function selectBillingContact(contacts) {
  const validContacts = (contacts || []).filter((contact) => getBillingContactPhone(contact));
  if (!validContacts.length) return null;

  return [...validContacts].sort((left, right) => {
    const score = (contact) => (
      (contact.enableWhatsAppBilling ? 100 : 0)
      + (contact.whatsapp || contact.whatsappJid ? 20 : 0)
      + (contact.externalSource !== 'firebird' ? 10 : 0)
    );
    return score(right) - score(left);
  })[0];
}

async function findContactForBilling(tenantId, crmCustomer, queryCpfCnpj) {
  // 1. Tenta usar os contatos já vinculados ao CrmCustomer (passado como argumento)
  if (crmCustomer && crmCustomer.id) {
    const crmWithContacts = await prisma.crmCustomer.findUnique({
      where: { id: crmCustomer.id },
      include: { whatsappContacts: true }
    });
    if (crmWithContacts && crmWithContacts.whatsappContacts.length > 0) {
      // Prioridade 1: Contato com Opt-in E Telefone preenchido
      const best = selectBillingContact(crmWithContacts.whatsappContacts);
      if (best) return best;
    }
  }

  const cleanQuery = String(queryCpfCnpj || '').replace(/\D/g, '');
  if (!cleanQuery) return null;

  const variations = getCpfCnpjVariations(queryCpfCnpj);

  // 2. Tenta buscar outro CrmCustomer pelo CPF/CNPJ (caso o vinculado não tenha contatos)
  const fallbackCrm = await prisma.crmCustomer.findFirst({
    where: {
      tenantId,
      cpfCnpj: { in: variations }
    },
    include: {
      whatsappContacts: true
    }
  });

  if (fallbackCrm && fallbackCrm.whatsappContacts.length > 0) {
    const best = selectBillingContact(fallbackCrm.whatsappContacts);
    if (best) return best;
  }

  // Fallback: Busca todos os contatos do tenant
  const contacts = await prisma.contact.findMany({
    where: { tenantId }
  });

  // 3. Tenta correspondência exata de CPF/CNPJ no próprio Contact
  let matches = contacts.filter(c => {
    if (c.cpfCnpj) {
      const cleanDb = c.cpfCnpj.replace(/\D/g, '');
      if (cleanDb === cleanQuery) return true;
    }
    return false;
  });

  if (matches.length > 0) {
    // Prioriza o que tem Opt-in e telefone
    return selectBillingContact(matches);
  }

  // 4. Tenta por raiz do CNPJ (primeiros 8 dígitos) no nome
  if (cleanQuery.length === 14) {
    const rootCnpj = cleanQuery.slice(0, 8); 
    const rootCnpjFormatted = `${rootCnpj.slice(0, 2)}.${rootCnpj.slice(2, 5)}.${rootCnpj.slice(5, 8)}`; 

    matches = contacts.filter(c => {
      const nameLower = (c.name || '').toLowerCase();
      return nameLower.includes(rootCnpj) || nameLower.includes(rootCnpjFormatted);
    });

    if (matches.length > 0) {
      return selectBillingContact(matches);
    }
  }

  // 5. Tenta por CPF completo formatado ou limpo no nome
  if (cleanQuery.length === 11) {
    const cpfFormatted = `${cleanQuery.slice(0, 3)}.${cleanQuery.slice(3, 6)}.${cleanQuery.slice(6, 9)}-${cleanQuery.slice(9, 11)}`;
    matches = contacts.filter(c => {
      const nameLower = (c.name || '').toLowerCase();
      return nameLower.includes(cleanQuery) || nameLower.includes(cpfFormatted);
    });

    if (matches.length > 0) {
      return selectBillingContact(matches);
    }
  }

  return null;
}

async function sendBilling(req, res) {
    const { tenantSlug, cpfCnpj, sendPolicy } = req.body;
    const files = req.files || [];

    try {
      if (!tenantSlug) {
        return res.status(400).json({ error: 'tenantSlug é obrigatório.' });
      }
      if (!cpfCnpj) {
        return res.status(400).json({ error: 'cpfCnpj é obrigatório.' });
      }
      if (files.length === 0) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        include: { settings: true, instances: true },
      });

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant não encontrado.' });
      }

      // Valida token do client local
      assertToken(req, tenant);

      const contact = await findContactByCpfCnpj(tenant.id, cpfCnpj);
      if (!contact) {
        // Registra a falha no log de cobrança
        await prisma.billingLog.create({
          data: {
            tenantId: tenant.id,
            cpfCnpj,
            fileName: files.map(f => f.originalname).join(', '),
            status: 'FAILED',
            errorMessage: 'Cliente não encontrado no CRM.'
          }
        });
        return res.status(404).json({ error: 'Cliente não encontrado no CRM.' });
      }

      const isSendToAll = String(sendPolicy).toLowerCase() === 'todos';

      if (!isSendToAll && !contact.enableWhatsAppBilling) {
        // Registra que o envio foi ignorado por configuração do usuário (opt-in desativado por padrão)
        await prisma.billingLog.create({
        data: {
          tenantId: tenant.id,
          cpfCnpj,
          clientName: contact.name,
          fileName: files.map(f => f.originalname).join(', '),
          status: 'FAILED',
          errorMessage: 'Envio de cobrança via WhatsApp não habilitado para este contato (opt-in desativado).'
        }
      });
      return res.json({ success: true, message: 'Envio de cobrança via WhatsApp não habilitado para este contato.' });
    }

    const evolutionUrl = tenant.settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
    const evolutionKey = tenant.settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;
    let instanceName = tenant.instances.find(item => String(item.status).toLowerCase() === 'connected')?.instanceName || tenant.instances[0]?.instanceName;

    if (!evolutionUrl || !evolutionKey || !instanceName) {
      throw new Error('Integração com WhatsApp não configurada ou sem instâncias conectadas.');
    }

    const phone = evolutionService.normalizePhoneNumber(contact.whatsapp || contact.phone || '');
    if (!phone) {
      throw new Error('Telefone do cliente inválido ou não cadastrado.');
    }

    // Busca ou abre um ticket para o cliente
    let ticket = await prisma.ticket.findFirst({
      where: {
        contactId: contact.id,
        status: { in: ['pending', 'open', 'bot'] }
      }
    });

    if (!ticket) {
      ticket = await prisma.ticket.create({
        data: {
          tenantId: tenant.id,
          instanceId: tenant.instances.find(i => i.instanceName === instanceName)?.id || tenant.instances[0]?.id,
          contactId: contact.id,
          status: 'open'
        }
      });
      if (io) io.to(tenant.id).emit('ticket_updated', { ticketId: ticket.id, ticket });
    }

    // 1. Envia a mensagem de texto com o template primeiro - o cliente le a
    // explicacao ("Segue anexo...") antes de receber os PDFs, nao depois.
    const template = tenant.settings?.billingMessageTemplate || 'Olá! Seguem em anexo sua fatura, boleto e demonstrativo deste mês. Se tiver qualquer dúvida, estamos à disposição.';

    console.log(`[billing] Enviando texto de cobrança para ${require('../utils/privacy').maskPhone(phone)}...`);
    const textResult = await evolutionService.sendText(evolutionUrl, evolutionKey, instanceName, phone, template);
    const textExternalId = textResult?.key?.id || textResult?.message?.key?.id;

    // Salva a mensagem de texto no histórico
    await prisma.message.create({
      data: {
        ticketId: ticket.id,
        body: template,
        fromMe: true,
        externalId: textExternalId
      }
    });

    // 2. Envia as mídias (PDFs) sequencialmente
    for (const file of files) {
      const base64 = (await fs.promises.readFile(file.path)).toString('base64');
      const mime = file.mimetype;
      const mediaUrl = `/uploads/media/${file.filename}`;

      console.log(`[billing] Enviando documento para ${require('../utils/privacy').maskPhone(phone)}...`);
      const result = await evolutionService.sendMedia(evolutionUrl, evolutionKey, instanceName, phone, {
        mediatype: 'document',
        media: base64,
        mimetype: mime,
        filename: file.originalname,
        filePath: file.path
      });

      const externalId = result?.key?.id || result?.message?.key?.id;

      // Cria a mensagem correspondente no banco
      await prisma.message.create({
        data: {
          ticketId: ticket.id,
          body: '',
          fromMe: true,
          mediaUrl,
          mediaType: 'document',
          fileName: file.originalname,
          externalId,
          mediaStatus: 'ok'
        }
      });
    }

    // Atualiza data do ticket
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { lastMessageAt: new Date() }
    });

    // Log de sucesso no DB
    await prisma.billingLog.create({
      data: {
        tenantId: tenant.id,
        cpfCnpj,
        clientName: contact.name,
        fileName: files.map(f => f.originalname).join(', '),
        status: 'SUCCESS'
      }
    });

    if (io) {
      io.to(tenant.id).emit('new_message', { ticketId: ticket.id });
    }

    res.json({ success: true });
  } catch (err) {
    const failureDetail = describeAutoSendFailure(err);
    console.error('[sendBilling] erro:', failureDetail, '| raw:', err.message);
    // Tenta registrar o erro no banco se tivermos o tenant
    if (tenantSlug) {
      try {
        const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
        if (tenant) {
          await prisma.billingLog.create({
            data: {
              tenantId: tenant.id,
              cpfCnpj,
              fileName: files.map(f => f.originalname).join(', '),
              status: 'FAILED',
              errorMessage: failureDetail
            }
          });
        }
      } catch (logErr) {
        console.error('[sendBilling] Erro ao salvar log de erro no DB:', logErr.message);
      }
    }
    res.status(500).json({ error: err.message });
  }
}

// Traduz o erro cru de um envio automatico numa frase util pro relatorio.
// O caso mais comum e a Evolution devolver 400 com
// { response: { message: [ { number, exists: false } ] } } quando a instancia
// esta reconectando e a checagem "existe no WhatsApp?" volta vazia no meio do
// envio -- o numero costuma ser valido, so o socket estava instavel.
function describeAutoSendFailure(err) {
  const payload = err?.response?.data;
  const rejected = Array.isArray(payload?.response?.message) ? payload.response.message : null;
  const numberCheck = rejected?.find((item) => item && typeof item === 'object' && 'exists' in item);
  if (numberCheck && numberCheck.exists === false) {
    return `WhatsApp recusou o numero ${numberCheck.number || 's/ numero'} no momento do envio `
      + '(instancia Evolution pode ter caido/reconectado; o numero costuma ser valido).';
  }
  return evolutionService.getEvolutionErrorDetail(err);
}

async function autoSendBilling(req, res) {
  // Chamado pelo agente (nao por um usuario logado) quando o indice de
  // Documentos financeiros encontra, sem ambiguidade, um pacote completo para
  // um titulo em aberto. Substitui a antiga varredura de pasta: o cliente e
  // identificado com precisao pelo proprio agente (CNPJ + numero + datas +
  // valor), aqui so falta checar o opt-in e entregar pelo WhatsApp.
  const { tenantSlug, receivableExternalId, sendPolicy, documents } = req.body || {};
  // Preenchidos assim que o cliente e resolvido, para o log de FALHA no catch
  // conseguir dizer QUEM falhou (antes gravava cpfCnpj vazio -> o relatorio de
  // cobertura nao conseguia ligar a falha ao cliente).
  let failureCpfCnpj = '';
  let failureClientName = null;

  try {
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug é obrigatório.' });
    if (!receivableExternalId) return res.status(400).json({ error: 'receivableExternalId é obrigatório.' });
    if (!Array.isArray(documents) || !documents.length) {
      return res.status(400).json({ error: 'Nenhum documento informado.' });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: { settings: true, instances: true },
    });
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    assertToken(req, tenant);

    const receivableRecord = await prisma.externalSyncRecord.findFirst({
      where: { tenantId: tenant.id, source: 'firebird', entity: 'receivables', externalId: String(receivableExternalId) },
      select: { payload: true },
    });
    if (!receivableRecord) {
      return res.status(404).json({ error: 'Título financeiro não encontrado para este envio automático.' });
    }
    const clientExternalId = String(receivableRecord.payload?.clientExternalId ?? receivableRecord.payload?.cdcliente ?? '');
    if (!clientExternalId) {
      return res.status(404).json({ error: 'Título sem cliente vinculado no iLux.' });
    }

    const crmCustomer = await prisma.crmCustomer.findFirst({
      where: { tenantId: tenant.id, externalId: clientExternalId },
    });
    if (!crmCustomer) {
      return res.status(404).json({ error: 'Cliente do CRM não encontrado para este título.' });
    }
    const customerName = crmCustomer.fantasyName || crmCustomer.name;
    failureCpfCnpj = crmCustomer.cpfCnpj || '';
    failureClientName = customerName;

    // Proteção contra envio duplicado caso o ledger do agente seja apagado (evita spam no mesmo dia)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const alreadySentToday = await prisma.billingLog.findFirst({
      where: {
        tenantId: tenant.id,
        cpfCnpj: crmCustomer.cpfCnpj,
        status: 'SUCCESS',
        sentAt: { gte: startOfDay }
      }
    });

    if (alreadySentToday) {
      // Retorna sucesso silenciado para o agente registrar no ledger e não tentar mais, mas não processa envio
      return res.json({ success: true, message: 'Já enviado hoje com sucesso.' });
    }

    // O agente re-tenta títulos sem opt-in/telefone em todo ciclo (10 min).
    // Não re-gravamos o mesmo SKIPPED se já houver um recente para este cliente
    // — senão a tabela BillingLog cresce milhares de linhas de ruído por dia.
    const skipRelogDays = Math.max(1, Number.parseInt(process.env.BILLING_SKIP_RELOG_DAYS, 10) || 7);
    const skipRelogSince = new Date(Date.now() - skipRelogDays * 24 * 60 * 60 * 1000);
    const recentSkip = await prisma.billingLog.findFirst({
      where: { tenantId: tenant.id, cpfCnpj: crmCustomer.cpfCnpj, status: 'SKIPPED', sentAt: { gte: skipRelogSince } },
      select: { id: true },
    });

    // Valida contato e opt-in antes de persistir/cachar os PDFs. Assim, uma
    // repeticao para um contato sem permissao nao passa pelo cache e nao gera
    // erro 500 antes de devolver skipped.
    const requestedFileNames = documents.map((document) => document.fileName).join(', ');
    const precheckContact = await findContactForBilling(tenant.id, crmCustomer, crmCustomer.cpfCnpj);
    const precheckIsSendToAll = String(sendPolicy).toLowerCase() === 'todos';
    if (!precheckContact) {
      if (!recentSkip) {
        await prisma.billingLog.create({
          data: { tenantId: tenant.id, cpfCnpj: crmCustomer.cpfCnpj, clientName: customerName, fileName: requestedFileNames, status: 'SKIPPED', errorMessage: 'Nenhum contato de WhatsApp valido cadastrado para este cliente.' },
        });
      }
      return res.json({ success: true, skipped: true, message: 'Documentos preparados, mas nao ha contato de WhatsApp valido para enviar automaticamente.' });
    }
    if (!precheckIsSendToAll && !precheckContact.enableWhatsAppBilling) {
      if (!recentSkip) {
        await prisma.billingLog.create({
          data: { tenantId: tenant.id, cpfCnpj: crmCustomer.cpfCnpj, clientName: customerName, fileName: requestedFileNames, status: 'SKIPPED', errorMessage: 'Opt-in de cobranca desativado para este contato.' },
        });
      }
      return res.json({ success: true, skipped: true, message: 'Envio automatico nao habilitado para este contato.' });
    }

    // Guarda cada documento do mesmo jeito que um clique manual no CRM guardaria
    // -- assim, se alguem abrir esse titulo no CRM depois, ja aparece pronto em
    // vez de pedir pro agente de novo. Os campos do "receivable" abaixo sao um
    // stub: o agente ja confirmou que cada tipo existe, casando o PDF real
    // contra este titulo antes de chamar este endpoint.
    const cachedDocuments = [];
    for (const document of documents) {
      const documentType = String(document.documentType || '').toLowerCase();
      const stubReceivable = {
        externalId: String(receivableExternalId),
        invoiceNumber: receivableExternalId,
        invoiceExternalId: documentType === 'invoice' ? 'auto' : null,
        statementExternalId: documentType === 'statement' ? 'auto' : null,
        hasBoleto: documentType === 'boleto',
      };
      const request = await billingDocuments.queueDocumentRequest({
        tenantId: tenant.id,
        receivable: stubReceivable,
        customerName,
        documentType,
      });
      await billingDocuments.completeDocumentRequest({
        request,
        success: true,
        result: {
          documentType,
          pdfBase64: document.pdfBase64,
          fileName: document.fileName,
          mimeType: document.mimeType || 'application/pdf',
        },
      });
      const stored = await prisma.externalSyncRecord.findUnique({ where: { id: request.id }, select: { payload: true } });
      cachedDocuments.push({
        documentType,
        fileName: stored.payload.fileName,
        mediaUrl: stored.payload.mediaUrl,
        mimeType: stored.payload.mimeType || 'application/pdf',
      });
    }

    const fileNames = cachedDocuments.map((document) => document.fileName).join(', ');
    const contact = await findContactForBilling(tenant.id, crmCustomer, crmCustomer.cpfCnpj);
    const isSendToAll = String(sendPolicy).toLowerCase() === 'todos';

    if (!contact) {
      await prisma.billingLog.create({
        data: { tenantId: tenant.id, cpfCnpj: crmCustomer.cpfCnpj, clientName: customerName, fileName: fileNames, status: 'SKIPPED', errorMessage: 'Nenhum contato de WhatsApp com número válido cadastrado para este cliente.' },
      });
      return res.json({ success: true, skipped: true, message: 'Documentos preparados, mas não há contato de WhatsApp com número válido para enviar automaticamente.' });
    }
    if (!isSendToAll && !contact.enableWhatsAppBilling) {
      await prisma.billingLog.create({
        data: { tenantId: tenant.id, cpfCnpj: crmCustomer.cpfCnpj, clientName: customerName, fileName: fileNames, status: 'SKIPPED', errorMessage: 'Opt-in de cobrança desativado para este contato.' },
      });
      return res.json({ success: true, skipped: true, message: 'Envio automático não habilitado para este contato.' });
    }

    const evolutionUrl = tenant.settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
    const evolutionKey = tenant.settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;
    const instanceName = tenant.instances.find((item) => String(item.status).toLowerCase() === 'connected')?.instanceName || tenant.instances[0]?.instanceName;
    if (!evolutionUrl || !evolutionKey || !instanceName) {
      throw new Error('Integração com WhatsApp não configurada ou sem instâncias conectadas.');
    }
    const phone = getBillingContactPhone(contact);
    if (!phone) {
      await prisma.billingLog.create({
        data: { tenantId: tenant.id, cpfCnpj: crmCustomer.cpfCnpj, clientName: customerName, fileName: fileNames, status: 'SKIPPED', errorMessage: 'Telefone do contato inválido ou não cadastrado para WhatsApp.' },
      });
      return res.json({ success: true, skipped: true, message: 'Documentos preparados, mas o telefone do contato não é válido para WhatsApp.' });
    }

    // Busca ou abre uma conversa para o cliente -- precisa funcionar mesmo com
    // quem nunca trocou mensagem no WhatsApp antes, como o fluxo antigo fazia.
    let ticket = await prisma.ticket.findFirst({
      where: { contactId: contact.id, status: { in: ['pending', 'open', 'bot'] } },
    });
    if (!ticket) {
      ticket = await prisma.ticket.create({
        data: {
          tenantId: tenant.id,
          instanceId: tenant.instances.find((item) => item.instanceName === instanceName)?.id || tenant.instances[0]?.id,
          contactId: contact.id,
          status: 'open',
        },
      });
      if (io) io.to(tenant.id).emit('ticket_updated', { ticketId: ticket.id, ticket });
    }

    // A mensagem de apresentação ("Segue anexo...") precisa chegar ANTES dos
    // documentos, nao depois - e assim que o cliente le a explicacao antes
    // de ver os PDFs, nao o contrario.
    const template = tenant.settings?.billingMessageTemplate || 'Olá! Seguem em anexo sua fatura, boleto e demonstrativo deste mês. Se tiver qualquer dúvida, estamos à disposição.';
    const textResult = await evolutionService.sendText(evolutionUrl, evolutionKey, instanceName, phone, template);
    const textExternalId = textResult?.key?.id || textResult?.message?.key?.id;
    await prisma.message.create({ data: { ticketId: ticket.id, body: template, fromMe: true, externalId: textExternalId } });

    for (const document of cachedDocuments) {
      const filePath = path.join(mediaPath, path.basename(document.mediaUrl));
      const base64 = (await fs.promises.readFile(filePath)).toString('base64');
      const result = await evolutionService.sendMedia(evolutionUrl, evolutionKey, instanceName, phone, {
        mediatype: 'document',
        media: base64,
        mimetype: document.mimeType,
        filename: document.fileName,
        filePath,
      });
      const externalId = result?.key?.id || result?.message?.key?.id;
      const message = await prisma.message.create({
        data: { ticketId: ticket.id, body: '', fromMe: true, mediaUrl: document.mediaUrl, mediaType: 'document', fileName: document.fileName, externalId, mediaStatus: 'ok' },
      });
      if (io) io.to(tenant.id).emit('new_message', { ticketId: ticket.id, message, fromMe: true });
    }

    const updatedTicket = await prisma.ticket.update({ where: { id: ticket.id }, data: { lastMessageAt: new Date() } });

    await prisma.billingLog.create({
      data: { tenantId: tenant.id, cpfCnpj: crmCustomer.cpfCnpj, clientName: customerName, fileName: fileNames, status: 'SUCCESS' },
    });
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        tenantId: tenant.id,
        userId: null,
        type: 'billing_documents_resent',
        payload: JSON.stringify({
          receivableExternalId: String(receivableExternalId),
          documentTypes: cachedDocuments.map((document) => document.documentType),
          phone,
          automatic: true,
        }),
      },
    });

    if (io) io.to(tenant.id).emit('ticket_updated', { ticketId: ticket.id, ticket: updatedTicket });

    return res.json({ success: true, message: `Enviado automaticamente para ${customerName} (${phone}).` });
  } catch (err) {
    const failureDetail = describeAutoSendFailure(err);
    console.error('[autoSendBilling] erro:', failureDetail, '| raw:', err.message);
    try {
      if (tenantSlug) {
        const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
        if (tenant) {
          await prisma.billingLog.create({
            data: {
              tenantId: tenant.id,
              cpfCnpj: failureCpfCnpj,
              clientName: failureClientName,
              fileName: (documents || []).map((document) => document.fileName).join(', '),
              status: 'FAILED',
              errorMessage: failureDetail,
            },
          });
        }
      }
    } catch (logErr) {
      console.error('[autoSendBilling] erro ao salvar log:', logErr.message);
    }
    return res.status(500).json({ error: err.message });
  }
}

async function logTestBilling(req, res) {
  // Chamado pelo agente quando o envio automatico esta em modo teste: nada e
  // enviado pelo WhatsApp, so espelhamos a simulacao na tela de Logs do CRM
  // (status "TEST") para o gestor acompanhar sem precisar acessar o log
  // local do agente.
  const { tenantSlug, cpfCnpj, customerName, fileNames } = req.body || {};

  try {
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug é obrigatório.' });
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug }, include: { settings: true } });
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    assertToken(req, tenant);

    await prisma.billingLog.create({
      data: {
        tenantId: tenant.id,
        cpfCnpj: cpfCnpj || '',
        clientName: customerName || null,
        fileName: Array.isArray(fileNames) ? fileNames.join(', ') : String(fileNames || ''),
        status: 'TEST',
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[logTestBilling] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function triggerBillingProcess(req, res) {
  const { tenantId } = req.user;

  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId }
    });

    if (!settings) {
      return res.status(404).json({ error: 'Configurações do tenant não encontradas.' });
    }

    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { firebirdQueueBillingProcess: true }
    });

    res.json({ ok: true, message: 'Processamento de cobranças enfileirado para o client local.' });
  } catch (err) {
    console.error('[triggerBillingProcess] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getBillingLogs(req, res) {
  const { tenantId } = req.user;

  try {
    const logs = await prisma.billingLog.findMany({
      where: { tenantId },
      orderBy: { sentAt: 'desc' },
      take: 100
    });
    res.json(logs);
  } catch (err) {
    console.error('[getBillingLogs] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

function normalizeBillingIdentity(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildBillingCoverageReport(contacts, logs) {
  const successful = new Set();
  const latestByIdentity = new Map();
  const customerRows = new Map();

  for (const log of logs) {
    const identity = normalizeBillingIdentity(log.cpfCnpj);
    if (!identity) continue;
    if (log.status === 'SUCCESS') successful.add(identity);
    const previous = latestByIdentity.get(identity);
    if (!previous || new Date(log.sentAt || 0) > new Date(previous.sentAt || 0)) {
      latestByIdentity.set(identity, log);
    }
  }

  for (const contact of contacts) {
    const realCpfCnpj = contact.cpfCnpj || contact.crmCustomer?.cpfCnpj || '';
    const identity = normalizeBillingIdentity(realCpfCnpj) || `contact:${contact.id}`;
    const existing = customerRows.get(identity);
    if (existing && (existing.phone || !contact.whatsapp && !contact.phone)) continue;
    customerRows.set(identity, {
      id: contact.id,
      name: contact.fantasyName || contact.name || contact.crmCustomer?.fantasyName || contact.crmCustomer?.name || 'Sem nome',
      phone: contact.whatsapp || contact.phone || '',
      cpfCnpj: realCpfCnpj || 'Não informado',
      identity,
    });
  }

  const coverageAnalysis = [...customerRows.values()].map((customer) => {
    const logIdentity = customer.identity.replace(/^contact:/, '');
    const log = latestByIdentity.get(logIdentity);
    let status = 'NOT_SENT';
    if (successful.has(logIdentity)) status = 'RECEIVED';
    else if (!customer.phone) status = 'NO_PHONE';
    else if (log?.status === 'FAILED') status = 'FAILED';
    else if (log?.status === 'SKIPPED') status = 'SKIPPED';
    return {
      ...customer,
      status,
      lastSentAt: log?.sentAt || null,
      lastError: log?.errorMessage || null,
    };
  });

  const count = (status) => coverageAnalysis.filter((item) => item.status === status).length;
  const received = count('RECEIVED');
  return {
    coverageAnalysis,
    coverageSummary: {
      expected: coverageAnalysis.length,
      received,
      notReceived: coverageAnalysis.length - received,
      notSent: count('NOT_SENT'),
      noPhone: count('NO_PHONE'),
      failed: count('FAILED'),
      skipped: count('SKIPPED'),
      rate: coverageAnalysis.length ? Math.round((received / coverageAnalysis.length) * 100) : 0,
    },
  };
}

function resolveBillingDateRange(query = {}) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const customStart = String(query.startDate || '');
  const customEnd = String(query.endDate || '');

  if (dateOnly.test(customStart) && dateOnly.test(customEnd)) {
    const startDate = new Date(`${customStart}T00:00:00.000Z`);
    const endDate = new Date(`${customEnd}T23:59:59.999Z`);
    if (Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime()) && startDate <= endDate) {
      return { startDate, endDate, custom: true };
    }
  }

  // "Hoje" = da meia-noite ate agora, nao "ultimas 24h" (o antigo period=1
  // pegava o dia inteiro de ontem quando aberto de madrugada).
  if (String(query.period).toLowerCase() === 'today') {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    return { startDate, endDate: new Date(), custom: false, period: 'today' };
  }

  const parsedPeriod = Number.parseInt(query.period, 10);
  const period = Number.isFinite(parsedPeriod) && parsedPeriod > 0 ? Math.min(parsedPeriod, 365) : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - period);
  startDate.setHours(0, 0, 0, 0);
  return { startDate, endDate: null, custom: false, period };
}

async function getBillingDashboardStats(req, res) {
  const { tenantId } = req.user;

  try {
    const range = resolveBillingDateRange(req.query);
    const rangeWhere = {
      tenantId,
      sentAt: { gte: range.startDate, ...(range.endDate ? { lte: range.endDate } : {}) },
    };

    // Os indicadores saem de agregação no banco — nunca mais carregamos as
    // dezenas de milhares de linhas de log só para contá-las. A tabela mostra
    // apenas as mais recentes.
    const LOG_TABLE_LIMIT = 300;
    const [byStatus, skippedOptIn, recentLogs, operationalTotal] = await Promise.all([
      prisma.billingLog.groupBy({ by: ['status'], where: rangeWhere, _count: { _all: true } }),
      prisma.billingLog.count({ where: { ...rangeWhere, status: 'SKIPPED', errorMessage: { contains: 'Opt-in' } } }),
      prisma.billingLog.findMany({
        where: rangeWhere,
        orderBy: { sentAt: 'desc' },
        take: LOG_TABLE_LIMIT,
        select: { id: true, cpfCnpj: true, clientName: true, status: true, errorMessage: true, sentAt: true },
      }),
      prisma.billingLog.count({ where: { ...rangeWhere, status: { not: 'TEST' } } }),
    ]);

    const countOf = (status) => byStatus.find((g) => g.status === status)?._count?._all || 0;
    const success = countOf('SUCCESS');
    const failed = countOf('FAILED');
    const skippedTotal = countOf('SKIPPED');
    const test = countOf('TEST');
    const eligibleAttempts = success + failed; // teve opt-in + telefone; o resto nem chegou a tentar

    const stats = {
      total: operationalTotal,
      success,
      failed,
      skippedOptIn,
      skippedNoContact: skippedTotal - skippedOptIn,
      test,
      eligibleAttempts,
      // Entrega = enviados / tentativas reais (não sobre o total de linhas de log).
      deliveryRate: eligibleAttempts > 0 ? Math.round((success / eligibleAttempts) * 100) : null,
      failureRate: eligibleAttempts > 0 ? Math.round((failed / eligibleAttempts) * 100) : null,
      totalOptIn: 0,
      logsShown: recentLogs.length,
      logsTruncated: operationalTotal + test > recentLogs.length,
    };

    const operationalLogs = recentLogs.filter((log) => log.status !== 'TEST');

    const optInContacts = await prisma.contact.findMany({
      where: {
        tenantId,
        enableWhatsAppBilling: true
      },
      select: {
        id: true,
        name: true,
        fantasyName: true,
        phone: true,
        cpfCnpj: true,
        whatsapp: true,
        crmCustomer: {
          select: {
            cpfCnpj: true,
            name: true,
            fantasyName: true
          }
        }
      }
    });

    // Cobertura precisa do último log de cada cliente com opt-in — e esse log
    // pode ser mais antigo que os 300 mostrados na tabela. Buscamos só os
    // registros desses ~poucos CNPJs no período (conjunto pequeno).
    const optInCnpjForms = [...new Set(
      optInContacts.flatMap((contact) => [contact.cpfCnpj, contact.crmCustomer?.cpfCnpj])
        .filter((value) => value && String(value).trim()),
    )];
    const coverageLogs = optInCnpjForms.length
      ? await prisma.billingLog.findMany({
        where: { ...rangeWhere, status: { not: 'TEST' }, cpfCnpj: { in: optInCnpjForms } },
        orderBy: { sentAt: 'desc' },
        select: { cpfCnpj: true, status: true, errorMessage: true, sentAt: true },
      })
      : [];

    const coverage = buildBillingCoverageReport(optInContacts, coverageLogs);
    stats.totalOptIn = coverage.coverageSummary.expected;
    res.json({
      stats,
      logs: recentLogs,
      ...coverage,
      period: {
        custom: range.custom,
        startDate: range.startDate.toISOString(),
        endDate: range.endDate?.toISOString() || null,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[getBillingDashboardStats] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function saveBillingSettings(req, res) {
  const { tenantId } = req.user;
  const { billingMessageTemplate } = req.body;

  try {
    await prisma.tenantSettings.update({
      where: { tenantId },
      data: { billingMessageTemplate }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[saveBillingSettings] erro:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  setIo,
  sendBilling,
  autoSendBilling,
  logTestBilling,
  triggerBillingProcess,
  getBillingLogs,
  saveBillingSettings,
  getBillingDashboardStats,
  _private: {
    buildBillingCoverageReport,
    normalizeBillingIdentity,
    normalizeBillingPhone,
    getBillingContactPhone,
    selectBillingContact,
    resolveBillingDateRange,
    describeAutoSendFailure,
  }
};
