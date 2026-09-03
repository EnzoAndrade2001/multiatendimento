const prisma = require('../lib/prisma');
const evolution = require('../services/evolutionService');
const metaCloudApi = require('../services/metaCloudApiService');
const { parseConnectionState, healthForState } = require('../services/instanceHealthService');
const { syncMissedMessages } = require('../services/syncMissedMessagesService');

async function getSettings(tenantId) {
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  const evolutionUrl = s?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
  const evolutionKey = s?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;
  if (!evolutionUrl || !evolutionKey) throw new Error('Evolution API não configurada. Contate o administrador.');
  return { ...s, evolutionUrl, evolutionKey };
}

async function list(req, res) {
  try {
    const instances = await prisma.waInstance.findMany({ 
      where: { 
        tenantId: req.user.tenantId,
        instanceName: { not: { startsWith: 'DELETED_' } }
      } 
    });

    // O perfil local de demonstração usa estados gravados no fixture e não
    // deve chamar a Evolution real só para montar a tela de conexões.
    if (String(process.env.LOCAL_DEMO || '').toLowerCase() === 'true') {
      return res.json(instances.map((instance) => ({
        ...instance,
        state: instance.lastConnectionState || (instance.status === 'connected' ? 'open' : 'close'),
      })));
    }
    
    let settings;
    try {
      settings = await getSettings(req.user.tenantId);
    } catch {
      // Se não estiver configurado, retorna a lista do banco mas sem o status real
      return res.json(instances.map(i => ({ ...i, state: 'close' })));
    }

    const { evolutionUrl, evolutionKey } = settings;

    const result = await Promise.all(instances.map(async (inst) => {
      try {
        const checkedAt = new Date();
        const data = await evolution.getConnectionState(evolutionUrl, evolutionKey, inst.instanceName, { timeout: 15000 });
        const state = parseConnectionState(data) || 'unknown';
        const health = healthForState(state);
        
        let phoneStr = inst.phone;
        if (state === 'open' && !phoneStr && inst.provider !== 'evolution_official') {
          try {
            const info = await evolution.fetchInstanceInfo(evolutionUrl, evolutionKey, inst.instanceName);
            const owner = info?.ownerJid || info?.owner || info?.instance?.owner || info?.number;
            if (owner && typeof owner === 'string') {
              phoneStr = owner.split('@')[0];
            }
          } catch (e) {
            console.error('[instanceController] Erro ao buscar info da instancia:', e.message);
          }
        }
        
        const updated = await prisma.waInstance.update({
          where: { id: inst.id },
          data: { 
            ...health,
            lastConnectionState: state,
            ...(inst.lastConnectionState !== state || inst.status !== health.status ? { lastConnectionAt: checkedAt } : {}),
            lastHealthCheckAt: checkedAt,
            lastHealthError: state === 'unknown' ? 'Evolution respondeu sem informar o estado da conexão.' : null,
            phone: phoneStr
          }
        });
        return { ...updated, state, healthStatus: health.healthStatus };
      } catch (error) {
        const checkedAt = new Date();
        const message = String(error?.response?.data?.message || error?.message || 'Evolution sem resposta').slice(0, 500);
        try {
          const updated = await prisma.waInstance.update({
            where: { id: inst.id },
            data: {
              status: 'degraded',
              healthStatus: 'degraded',
              lastConnectionState: 'unknown',
              lastHealthCheckAt: checkedAt,
              lastHealthError: message,
            },
          });
          return { ...updated, state: 'unknown', healthStatus: 'degraded' };
        } catch {
          return { ...inst, status: 'degraded', state: 'unknown', healthStatus: 'degraded', lastHealthCheckAt: checkedAt, lastHealthError: message };
        }
      }
    }));

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function create(req, res) {
  try {
    const { name } = req.body;
    const provider = req.body.provider === 'evolution_official' ? 'evolution_official' : 'evolution_qr';
    const officialPhone = provider === 'evolution_official'
      ? evolution.normalizePhoneNumber(req.body.officialPhone || '')
      : null;
    const officialPhoneId = provider === 'evolution_official' ? String(req.body.officialPhoneId || '').trim() : null;
    const officialBusinessId = provider === 'evolution_official' ? String(req.body.officialBusinessId || '').trim() : null;
    const officialAccessToken = provider === 'evolution_official' ? String(req.body.officialAccessToken || '').trim() : null;

    if (provider === 'evolution_official' && (officialPhone.length < 12 || !officialPhoneId || !officialAccessToken)) {
      return res.status(400).json({
        error: 'Na API oficial, informe o WhatsApp, o ID do telefone da Meta e o token permanente.',
      });
    }
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    // Verifica limite do plano
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
    const count = await prisma.waInstance.count({ where: { tenantId: req.user.tenantId } });
    
    if (count >= tenant.maxConnections) {
      return res.status(403).json({ 
        error: `Limite de conexões atingido (${tenant.maxConnections}). Faça um upgrade para adicionar mais números.` 
      });
    }

    const { evolutionUrl, evolutionKey } = await getSettings(req.user.tenantId);
    
    const instanceName = `${req.user.tenantId}_${name.toLowerCase().replace(/\s+/g, '_')}`;

    // Cria na Evolution
    console.log(`[instanceController] Criando instância "${instanceName}" na Evolution...`);
    try {
      await evolution.createInstance(evolutionUrl, evolutionKey, instanceName, {
        provider,
        phoneNumberId: officialPhoneId,
        businessId: officialBusinessId,
        accessToken: officialAccessToken,
      });
    } catch (err) {
      if (evolution.isInstanceAlreadyInUse(err)) {
        console.log(`[instanceController] Instância "${instanceName}" já existe na Evolution. Prosseguindo com o vínculo no banco de dados.`);
      } else {
        const errorMsg = evolution.getEvolutionErrorDetail(err);
        console.error(`[instanceController] Erro ao criar na Evolution: ${errorMsg}`);
        return res.status(400).json({ error: `Erro na Evolution API: ${errorMsg}` });
      }
    }

    // Salva no banco
    const inst = await prisma.waInstance.create({
      data: {
        tenantId: req.user.tenantId,
        instanceName,
        status: 'disconnected',
        provider,
        phone: officialPhone,
        officialPhoneId,
        officialBusinessId: officialBusinessId || null,
      }
    });

    const warnings = [];

    // API oficial: inscreve o app na WABA da Meta e aponta o webhook da Meta
    // direto para o /webhook/meta da Evolution. Sem isso a Meta nao entrega as
    // mensagens recebidas. A falha aqui nao invalida a conexao ja criada.
    if (provider === 'evolution_official' && officialBusinessId && officialAccessToken) {
      try {
        const callbackUrl = `${String(evolutionUrl).replace(/\/+$/, '')}/webhook/meta`;
        const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'evolution';
        await metaCloudApi.subscribeAppToWaba({
          wabaId: officialBusinessId,
          accessToken: officialAccessToken,
          callbackUrl,
          verifyToken,
        });
        console.log(`[instanceController] App inscrito na WABA ${officialBusinessId} (callback ${callbackUrl}).`);
      } catch (err) {
        const detail = metaCloudApi.graphErrorDetail(err);
        console.warn(`[instanceController] Falha ao inscrever app na WABA ${officialBusinessId}: ${detail}`);
        warnings.push(`Conexão criada, mas não consegui inscrever o app na conta do WhatsApp automaticamente (${detail}). Confirme que o token tem as permissões whatsapp_business_management e whatsapp_business_messaging; sem essa inscrição a Meta não entrega as mensagens recebidas.`);
      }
    }

    // Setup Webhook automático
    const backendUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3002}`;
    const webhookUrl = `${backendUrl}/api/webhook`;
    await evolution.setWebhook(evolutionUrl, evolutionKey, instanceName, webhookUrl);

    res.json(warnings.length ? { ...inst, warnings } : inst);
  } catch (err) {
    console.error(`[instanceController] Erro geral ao criar instância:`, err);
    res.status(400).json({ error: err.message });
  }
}

async function getQrCode(req, res) {
  try {
    const { id } = req.params;
    const inst = await prisma.waInstance.findFirst({ where: { id, tenantId: req.user.tenantId } });
    if (inst?.provider === 'evolution_official') {
      return res.status(409).json({ error: 'Conexões oficiais não utilizam QR Code.' });
    }
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    const { evolutionUrl, evolutionKey } = await getSettings(req.user.tenantId);
    const data = await evolution.getQrCode(evolutionUrl, evolutionKey, inst.instanceName);
    
    res.json({ 
      qrcode: data?.base64 || data?.qrcode?.base64 || null, 
      pairingCode: data?.pairingCode || null 
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function repair(req, res) {
  try {
    const { id } = req.params;
    const inst = await prisma.waInstance.findFirst({ where: { id, tenantId: req.user.tenantId } });
    if (inst?.provider === 'evolution_official') {
      return res.status(409).json({ error: 'A conexão oficial usa credenciais da Meta e não possui sessão QR para recriar.' });
    }
    if (!inst) return res.status(404).json({ error: 'Instancia nao encontrada' });

    const { evolutionUrl, evolutionKey } = await getSettings(req.user.tenantId);
    const diagnostics = [];

    try {
      const stateData = await evolution.getConnectionState(evolutionUrl, evolutionKey, inst.instanceName);
      const state = stateData?.instance?.state || stateData?.state;
      if (state === 'open') {
        return res.status(400).json({ error: 'Esta conexao ja esta ativa. Desconecte pelo WhatsApp antes de recriar a sessao.' });
      }
    } catch (err) {
      diagnostics.push(`connectionState: ${err.response?.data?.message || err.message}`);
      // Se o estado remoto tambem travou, seguimos com a recriacao.
    }

    try {
      await evolution.deleteInstance(evolutionUrl, evolutionKey, inst.instanceName);
    } catch (err) {
      diagnostics.push(`deleteInstance: ${err.response?.data?.message || err.message}`);
      console.warn('[instanceController] Falha ao remover instancia remota antes do reparo:', err.response?.data || err.message);
    }

    try {
      await evolution.createInstance(evolutionUrl, evolutionKey, inst.instanceName);
    } catch (err) {
      if (!evolution.isInstanceAlreadyInUse(err)) {
        diagnostics.push(`createInstance: ${err.response?.data?.message || err.message}`);
        console.warn('[instanceController] Falha ao recriar instancia remota:', err.response?.data || err.message);
      }
    }

    const backendUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3002}`;
    const webhookUrl = `${backendUrl}/api/webhook`;
    try {
      await evolution.setWebhook(evolutionUrl, evolutionKey, inst.instanceName, webhookUrl);
    } catch (err) {
      diagnostics.push(`setWebhook: ${err.response?.data?.message || err.message}`);
      console.warn('[instanceController] Falha ao configurar webhook no reparo:', err.response?.data || err.message);
    }

    const updated = await prisma.waInstance.update({
      where: { id },
      data: { status: 'disconnected', healthStatus: 'offline', lastConnectionState: 'close', lastHealthError: null, qrCode: null },
    });

    let qrData = null;
    try {
      qrData = await evolution.getQrCode(evolutionUrl, evolutionKey, inst.instanceName);
    } catch (err) {
      diagnostics.push(`getQrCode: ${err.response?.data?.message || err.message}`);
      console.warn('[instanceController] Reparo concluiu, mas QR Code ainda nao veio:', err.response?.data || err.message);
    }

    res.json({
      instance: updated,
      qrcode: qrData?.base64 || qrData?.qrcode?.base64 || null,
      pairingCode: qrData?.pairingCode || null,
      diagnostics,
    });
  } catch (err) {
    console.error('[instanceController] Erro ao reparar instancia:', err.response?.data || err.message);
    res.status(err.statusCode || err.response?.status || 400).json({ error: err.response?.data?.message || err.message });
  }
}

async function recoverMessages(req, res) {
  try {
    const inst = await prisma.waInstance.findFirst({
      where: { id: req.params.id, tenantId: req.user.tenantId, instanceName: { not: { startsWith: 'DELETED_' } } },
    });
    if (!inst) return res.status(404).json({ error: 'Instancia nao encontrada' });

    const hours = Number(req.body?.hours || req.query?.hours || 24);
    const result = await syncMissedMessages(inst.instanceName, { hours, force: true });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function remove(req, res) {
  try {
    const { id } = req.params;
    const inst = await prisma.waInstance.findFirst({ where: { id, tenantId: req.user.tenantId } });
    if (!inst) return res.status(404).json({ error: 'Instância não encontrada' });

    const { evolutionUrl, evolutionKey } = await getSettings(req.user.tenantId);
    
    // Tenta deletar na Evolution (ignora erro se já não existir lá)
    try { await evolution.deleteInstance(evolutionUrl, evolutionKey, inst.instanceName); } catch {}

    // Em vez de hard delete, faz soft delete renomeando e mudando o status
    // Isso evita quebrar o histórico de tickets e contatos (FK constraints)
    try {
      await prisma.waInstance.delete({ where: { id } });
    } catch (dbErr) {
      // Se falhar por constraint, faz o soft delete
      await prisma.waInstance.update({
        where: { id },
        data: { 
           instanceName: `DELETED_${Date.now()}_${inst.instanceName}`,
           status: 'disconnected'
        }
      });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { list, create, getQrCode, repair, recoverMessages, remove };
