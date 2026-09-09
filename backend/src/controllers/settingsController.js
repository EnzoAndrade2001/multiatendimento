const prisma = require('../lib/prisma');
const { normalizePhoneNumber } = require('../services/evolutionService');
const botPromptService = require('../services/botPromptService');
const { filterSettingsOutput } = require('../auth/settingsAccess');
const { getLatestCompanyProfile, getPendingCompanyRequest, getLatestCompanyRequest, requestCompanySync } = require('../services/companyProfileService');
const aiService = require('../services/aiService');
const { encryptSecret } = require('../services/printGuardCrypto');

async function getSettings(req, res) {
  const [settings, firebirdCompany, pendingCompanyRequest, latestCompanyRequest] = await Promise.all([
    prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } }),
    getLatestCompanyProfile(req.user.tenantId),
    getPendingCompanyRequest(req.user.tenantId),
    getLatestCompanyRequest(req.user.tenantId),
  ]);

  const requestStatus = latestCompanyRequest?.payload?.status;
  const requestFailed = requestStatus === 'failed' && (
    !firebirdCompany || !latestCompanyRequest?.receivedAt || new Date(firebirdCompany.receivedAt) < new Date(latestCompanyRequest.receivedAt)
  );
  const companySync = {
    firebirdCompany,
    firebirdCompanySyncStatus: pendingCompanyRequest
      ? 'pending'
      : requestFailed
        ? 'failed'
        : (firebirdCompany ? 'ok' : 'not_synced'),
    firebirdCompanySyncRequestedAt: latestCompanyRequest?.payload?.requestedAt || null,
    firebirdCompanySyncRequestId: pendingCompanyRequest?.id || null,
    firebirdCompanySyncError: latestCompanyRequest?.payload?.error || null,
  };

  if (!settings) return res.json(filterSettingsOutput(req.user, {
    evolutionUrl: process.env.DEFAULT_EVOLUTION_URL || '',
    evolutionKey: process.env.DEFAULT_EVOLUTION_KEY || '',
    ...companySync,
  }));

  // Injeta os padrões do servidor se o tenant não tiver configurado
  res.json(filterSettingsOutput(req.user, {
    ...settings,
    evolutionUrl: settings.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL || '',
    evolutionKey: settings.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY || '',
    systemPrompt: settings.botSystemPrompt,
    transferKeyword: settings.botTransferWord,
    outOfOfficeMessage: settings.outOfOfficeMessage,
    // O token do PlugBoleto nunca sai; a UI só precisa saber se está configurado.
    plugBoletoTokenSet: Boolean(settings.plugBoletoTokenCipher),
    ...companySync,
  }));
}

async function syncCompanyFromFirebird(req, res) {
  const result = await requestCompanySync(req.user.tenantId, req.user.userId);
  res.status(result.alreadyQueued ? 200 : 202).json({ ok: true, ...result });
}

async function testAiProvider(req, res) {
  try {
    const current = await prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } });
    const requested = req.body || {};
    const secretValue = (field) => {
      const value = requested[field];
      return value && value !== '********' ? value : current?.[field];
    };
    const result = await aiService.testProvider({
      ...current,
      aiProvider: requested.aiProvider || current?.aiProvider || 'gemini',
      aiModel: requested.aiModel !== undefined ? requested.aiModel : current?.aiModel,
      aiAuxProvider: requested.aiAuxProvider !== undefined ? requested.aiAuxProvider : current?.aiAuxProvider,
      geminiKey: secretValue('geminiKey'),
      openaiKey: secretValue('openaiKey'),
      anthropicKey: secretValue('anthropicKey'),
    });

    // Guarda o catálogo descoberto para a tela reabrir com os modelos já
    // listados, sem precisar validar de novo.
    if (result.provider && Array.isArray(result.models) && result.models.length && current) {
      const catalog = { ...(current.aiModelCatalog && typeof current.aiModelCatalog === 'object' ? current.aiModelCatalog : {}) };
      catalog[result.provider] = { models: result.models, at: new Date().toISOString() };
      await prisma.tenantSettings.update({ where: { tenantId: req.user.tenantId }, data: { aiModelCatalog: catalog } });
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.error?.message || err.response?.data?.error || err.message });
  }
}

async function saveSettings(req, res) {
  const {
    botEnabled, aiProvider, aiModel, aiAuxProvider, geminiKey, openaiKey, anthropicKey, botName, systemPrompt, transferKeyword,
    evolutionUrl, evolutionKey, webhookUrl, outOfOfficeMessage,
    ratingEnabled, ratingMessage, notificationPhone,
    serviceOrderManagerCopyEnabled, serviceOrderManagerPhone, serviceOrderManagerInstanceId,
    companyName, companyCnpj, companyIE, companyAddress, companyBairro, companyCep, companyPhone,
    companyCity, companyState, osAccentColor,
    serpApiKey,
    firebirdClientToken,
    firebirdApiUrl,
    firebirdApiKey,
    firebirdAuthMode,
    firebirdHealthPath,
    firebirdContactsPath,
    firebirdSyncEnabled,
    firebirdLastSyncAt,
    firebirdLastSyncStatus,
    firebirdLastSyncError,
    plugBoletoEnabled, plugBoletoBaseUrl, plugBoletoPrintPath, plugBoletoCedenteCnpj, plugBoletoToken,
    kpiContractValue, kpiServiceValue, kpiSlaLimitHours, kpiReincidentThreshold,
    billingMessageTemplate, billingInstanceId
  } = req.body;

  // PlugBoleto: token entra em texto puro e sai cifrado; string vazia limpa;
  // undefined = não mexe. base/path só aceitam string; CNPJ guarda só dígitos.
  const parsedPlugBoletoToken = plugBoletoToken === undefined
    ? undefined
    : (String(plugBoletoToken).trim() === '' ? null : encryptSecret(String(plugBoletoToken).trim()));
  const parsedPlugBoletoCnpj = plugBoletoCedenteCnpj === undefined
    ? undefined
    : (String(plugBoletoCedenteCnpj).replace(/\D/g, '') || null);
  const parsedPlugBoletoEnabled = plugBoletoEnabled === undefined ? undefined : Boolean(plugBoletoEnabled);
  const parsedPlugBoletoBaseUrl = plugBoletoBaseUrl === undefined
    ? undefined
    : (String(plugBoletoBaseUrl).trim() || null);
  const parsedPlugBoletoPrintPath = plugBoletoPrintPath === undefined
    ? undefined
    : (String(plugBoletoPrintPath).trim() || null);

  const parsedBillingInstanceId = billingInstanceId === undefined
    ? undefined
    : (billingInstanceId || null);

  // Motor auxiliar só existe quando o provedor é Anthropic (Claude não tem
  // embeddings nem transcrição). Fora disso, zera para não deixar lixo.
  const resolvedAuxProvider = aiAuxProvider === undefined
    ? undefined
    : (aiService.normalizeProvider(aiProvider) === 'anthropic' ? (aiService.normalizeAuxProvider(aiAuxProvider) || null) : null);

  const parsedContractValue = kpiContractValue !== undefined && kpiContractValue !== '' ? parseFloat(kpiContractValue) : null;
  const parsedServiceValue = kpiServiceValue !== undefined && kpiServiceValue !== '' ? parseFloat(kpiServiceValue) : null;
  const parsedSlaLimitHours = kpiSlaLimitHours !== undefined && kpiSlaLimitHours !== '' ? parseInt(kpiSlaLimitHours) : null;
  const parsedReincidentThreshold = kpiReincidentThreshold !== undefined && kpiReincidentThreshold !== '' ? parseInt(kpiReincidentThreshold) : null;
  const managerCopyEnabled = serviceOrderManagerCopyEnabled === undefined
    ? undefined
    : Boolean(serviceOrderManagerCopyEnabled);
  const managerPhone = serviceOrderManagerPhone === undefined
    ? undefined
    : (serviceOrderManagerPhone ? normalizePhoneNumber(serviceOrderManagerPhone) : null);
  const managerInstanceId = serviceOrderManagerInstanceId === undefined
    ? undefined
    : (serviceOrderManagerInstanceId || null);

  // Cor de destaque da O.S.: aceita apenas #RRGGBB; vazio limpa (volta ao
  // vermelho padrao no gerador); valor invalido e ignorado.
  const parsedOsAccentColor = osAccentColor === undefined
    ? undefined
    : (String(osAccentColor).trim() === ''
      ? null
      : (/^#[0-9a-fA-F]{6}$/.test(String(osAccentColor).trim())
        ? String(osAccentColor).trim().toUpperCase()
        : undefined));

  if (managerCopyEnabled) {
    if (!managerPhone || managerPhone.length < 12) {
      return res.status(400).json({ error: 'Informe um WhatsApp valido para o gestor, com DDD.' });
    }
    if (!managerInstanceId) {
      return res.status(400).json({ error: 'Selecione a instancia usada para enviar a copia da O.S.' });
    }
    const selectedInstance = await prisma.waInstance.findFirst({
      where: { id: managerInstanceId, tenantId: req.user.tenantId },
      select: { id: true },
    });
    if (!selectedInstance) {
      return res.status(400).json({ error: 'A instancia selecionada nao pertence a esta empresa.' });
    }
  }

  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId: req.user.tenantId },
    update: { 
      botEnabled,
      aiProvider,
      aiModel: aiModel === undefined ? undefined : (aiModel || null),
      aiAuxProvider: resolvedAuxProvider,
      geminiKey,
      openaiKey,
      anthropicKey,
      botName,
      botSystemPrompt: systemPrompt,
      botTransferWord: transferKeyword,
      evolutionUrl,
      evolutionKey,
      webhookUrl,
      outOfOfficeMessage,
      ratingEnabled,
      ratingMessage,
      notificationPhone,
      serviceOrderManagerCopyEnabled: managerCopyEnabled,
      serviceOrderManagerPhone: managerPhone,
      serviceOrderManagerInstanceId: managerInstanceId,
      companyName,
      companyCnpj,
      companyIE,
      companyAddress,
      companyBairro,
      companyCep,
      companyPhone,
      companyCity,
      companyState,
      osAccentColor: parsedOsAccentColor,
      serpApiKey,
      firebirdClientToken,
      firebirdApiUrl,
      firebirdApiKey,
      firebirdAuthMode,
      firebirdHealthPath,
      firebirdContactsPath,
      firebirdSyncEnabled,
      firebirdLastSyncAt: firebirdLastSyncAt ? new Date(firebirdLastSyncAt) : undefined,
      firebirdLastSyncStatus,
      firebirdLastSyncError,
      plugBoletoEnabled: parsedPlugBoletoEnabled,
      plugBoletoBaseUrl: parsedPlugBoletoBaseUrl,
      plugBoletoPrintPath: parsedPlugBoletoPrintPath,
      plugBoletoCedenteCnpj: parsedPlugBoletoCnpj,
      plugBoletoTokenCipher: parsedPlugBoletoToken,
      kpiContractValue: parsedContractValue,
      kpiServiceValue: parsedServiceValue,
      kpiSlaLimitHours: parsedSlaLimitHours,
      kpiReincidentThreshold: parsedReincidentThreshold,
      billingMessageTemplate,
      billingInstanceId: parsedBillingInstanceId
    },
    create: {
      tenantId: req.user.tenantId,
      botEnabled,
      aiProvider: aiProvider || 'gemini',
      aiModel: aiModel || null,
      aiAuxProvider: resolvedAuxProvider ?? null,
      geminiKey,
      openaiKey,
      anthropicKey,
      botName,
      botSystemPrompt: systemPrompt,
      botTransferWord: transferKeyword,
      evolutionUrl,
      evolutionKey,
      webhookUrl,
      outOfOfficeMessage,
      ratingEnabled,
      ratingMessage,
      notificationPhone,
      serviceOrderManagerCopyEnabled: managerCopyEnabled,
      serviceOrderManagerPhone: managerPhone,
      serviceOrderManagerInstanceId: managerInstanceId,
      companyName,
      companyCnpj,
      companyIE,
      companyAddress,
      companyBairro,
      companyCep,
      companyPhone,
      companyCity,
      companyState,
      osAccentColor: parsedOsAccentColor,
      serpApiKey,
      firebirdClientToken,
      firebirdApiUrl,
      firebirdApiKey,
      firebirdAuthMode,
      firebirdHealthPath,
      firebirdContactsPath,
      firebirdSyncEnabled,
      firebirdLastSyncAt: firebirdLastSyncAt ? new Date(firebirdLastSyncAt) : undefined,
      firebirdLastSyncStatus,
      firebirdLastSyncError,
      plugBoletoEnabled: parsedPlugBoletoEnabled,
      plugBoletoBaseUrl: parsedPlugBoletoBaseUrl,
      plugBoletoPrintPath: parsedPlugBoletoPrintPath,
      plugBoletoCedenteCnpj: parsedPlugBoletoCnpj,
      plugBoletoTokenCipher: parsedPlugBoletoToken,
      kpiContractValue: parsedContractValue,
      kpiServiceValue: parsedServiceValue,
      kpiSlaLimitHours: parsedSlaLimitHours,
      kpiReincidentThreshold: parsedReincidentThreshold,
      billingMessageTemplate,
      billingInstanceId: parsedBillingInstanceId
    },
  });

  res.json(filterSettingsOutput(req.user, settings));
}

// Mostra o prompt COMPLETO que a IA de fato recebe - não só o texto que o
// usuário escreve no painel (que é apenas um trecho do meio). Usa a mesma
// função (botPromptService.buildFinalPrompt) que o bot usa em produção, para
// nunca ficar dessincronizado do que realmente é enviado ao Gemini. Aceita
// um rascunho não salvo (systemPrompt no body) para o usuário poder conferir
// o efeito de uma edição antes de salvar.
async function getSystemPromptPreview(req, res) {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: req.user.tenantId } });
  const userPrompt = (req.body?.systemPrompt ?? settings?.botSystemPrompt) || 'Você é um Assistente de Atendimento cordial.';

  const prompt = botPromptService.buildFinalPrompt({
    userPrompt,
    contactName: 'Maria Exemplo',
    equipContext: '- Ricoh MP 2555 (Série: 4521, Setor: Financeiro)\n- Xerox 7845 (Série: 8890, Setor: Recepção)',
    currentNotes: 'Cliente prefere contato por telefone após às 17h. (exemplo ilustrativo)',
    knowledgeContext: '\n\nUSE O SEGUINTE CONHECIMENTO DA EMPRESA:\nDúvida: Qual o prazo de atendimento técnico?\nResposta: Em até 24h úteis para chamados abertos até as 16h. (exemplo ilustrativo)',
    transferWord: settings?.botTransferWord || 'humano',
  });

  res.json({
    prompt,
    note: 'Este é um exemplo com dados fictícios de cliente/equipamento/base de conhecimento, só para ilustrar o formato - na conversa real, esses trechos são substituídos pelos dados de cada cliente. O restante do texto (fora da sua área editável) é fixo no código e igual para todas as empresas; não é editável por aqui porque contém a tag de roteamento automático de chamados.',
  });
}

async function getBusinessHours(req, res) {
  const hours = await prisma.businessHour.findMany({
    where: { tenantId: req.user.tenantId },
    orderBy: { dayOfWeek: 'asc' }
  });
  res.json(hours);
}

async function saveBusinessHours(req, res) {
  const { hours } = req.body;
  
  await Promise.all(hours.map(h => 
    prisma.businessHour.upsert({
      where: { tenantId_dayOfWeek: { tenantId: req.user.tenantId, dayOfWeek: h.dayOfWeek } },
      update: { start: h.start, end: h.end, active: h.active },
      create: { tenantId: req.user.tenantId, dayOfWeek: h.dayOfWeek, start: h.start, end: h.end, active: h.active }
    })
  ));
  
  res.json({ ok: true });
}

async function uploadLogo(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  
  const url = `/uploads/${req.file.filename}`;
  
  await prisma.tenant.update({
    where: { id: req.user.tenantId },
    data: { logoUrl: url }
  });
  
  res.json({ url });
}

module.exports = { getSettings, saveSettings, testAiProvider, syncCompanyFromFirebird, getSystemPromptPreview, getBusinessHours, saveBusinessHours, uploadLogo };
