const prisma = require('../lib/prisma');
const evolution = require('./evolutionService');
const { syncMissedMessages } = require('./syncMissedMessagesService');
const inboundProbe = require('./inboundProbeService');
const { sendSystemAlert } = require('./alertService');

const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 1000;

// "Instancia muda": conectada, mas sem NENHUM webhook da Evolution ha muito
// tempo. O monitor so olhava o estado da conexao (open/close) e ficava cego
// para esse caso -- foi exatamente o que aconteceu no incidente de 08/09.
const SILENCE_ALERT_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.WEBHOOK_SILENCE_ALERT_MS || 25 * 60 * 1000),
);
// Reconciliacao periodica: puxa as mensagens recentes da Evolution e preenche
// o que faltou (rede de seguranca contra webhook perdido, seja qual for a causa).
const RECONCILE_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.WEBHOOK_RECONCILE_INTERVAL_MS || 10 * 60 * 1000),
);
const HEALTH_EVENT_RETENTION_DAYS = 30;
// Enquanto uma conexao segue sem receber, relembra o administrador.
const NOT_RECEIVING_REMINDER_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.NOT_RECEIVING_REMINDER_MS || 2 * 60 * 60 * 1000),
);
const lastNotReceivingAlertAt = new Map();
const incidentStartedAt = new Map();

let io = null;
let timer = null;
let running = false;
const lastReconcileAt = new Map();
let lastPruneAt = 0;

function setIo(socketIo) {
  io = socketIo;
}

function parseConnectionState(payload) {
  const raw = payload?.instance?.state
    || payload?.state
    || payload?.instance?.connectionStatus
    || payload?.connectionStatus
    || payload?.instance?.connection
    || payload?.connection;
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  if (['open', 'connected', 'online'].includes(value)) return 'open';
  if (['connecting', 'pairing', 'qrcode', 'qr'].includes(value)) return 'connecting';
  if (['close', 'closed', 'disconnected', 'offline'].includes(value)) return 'close';
  return 'unknown';
}

function healthForState(state) {
  if (state === 'open') return { status: 'connected', healthStatus: 'healthy' };
  if (state === 'connecting') return { status: 'connecting', healthStatus: 'unstable' };
  if (state === 'close') return { status: 'disconnected', healthStatus: 'offline' };
  return { status: 'degraded', healthStatus: 'degraded' };
}

function emitHealth(instance, state, healthStatus, checkedAt, error = null) {
  if (!io) return;
  io.to(instance.tenantId).emit('connection_update', {
    instance: instance.instanceName,
    event: 'connection.health',
    data: {
      state: state || 'unknown',
      healthStatus,
      checkedAt: checkedAt.toISOString(),
      error: error || undefined,
      source: 'health-monitor',
    },
  });
}

// Historico append-only: uma linha por TRANSICAO real. Dedupe contra o ULTIMO
// evento da instancia (nao contra a linha WaInstance, que pode oscilar se um
// connection.update chega entre duas checagens).
async function recordHealthEvent(instance, { status, healthStatus, connectionState, error, lastWebhookAt, source = 'health-monitor' }) {
  try {
    const previous = await prisma.waInstanceHealthEvent.findFirst({
      where: { instanceName: instance.instanceName },
      orderBy: { createdAt: 'desc' },
      select: { status: true, healthStatus: true },
    });
    if (previous && previous.status === status && previous.healthStatus === healthStatus) return;
    const ageSec = lastWebhookAt ? Math.round((Date.now() - new Date(lastWebhookAt).getTime()) / 1000) : null;
    await prisma.waInstanceHealthEvent.create({
      data: {
        tenantId: instance.tenantId,
        instanceId: instance.id,
        instanceName: instance.instanceName,
        status,
        healthStatus,
        connectionState: connectionState || null,
        lastWebhookAt: lastWebhookAt || null,
        webhookAgeSec: ageSec,
        error: error ? String(error).slice(0, 1000) : null,
        source,
      },
    });
  } catch (err) {
    console.warn('[instance-health] falha ao gravar historico:', err.message);
  }
}

// Instancia "ativa" = teve alguma mensagem nas ultimas 48h. Cache de 10 min por
// instancia (o alarme de silencio so consulta isto quando cruza o limiar).
const recentTrafficCache = new Map();
async function hasRecentTraffic(instanceId) {
  const cached = recentTrafficCache.get(instanceId);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.value;
  let value = false;
  try {
    const msg = await prisma.message.findFirst({
      where: { ticket: { instanceId }, createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) } },
      select: { id: true },
    });
    value = Boolean(msg);
  } catch (err) {
    console.warn('[instance-health] falha ao checar tráfego recente:', err.message);
    value = true; // na duvida, alarma (melhor um falso positivo que silenciar um incidente)
  }
  recentTrafficCache.set(instanceId, { at: Date.now(), value });
  return value;
}

// Numero realmente logado na sessao (ownerJid da Evolution). Cache de 5 min por
// instancia -- so consultamos para instancias 'open' e a resposta muda raro.
const connectedNumberCache = new Map();
async function fetchConnectedNumber(instance, url, key) {
  const cached = connectedNumberCache.get(instance.instanceName);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
  let value = null;
  try {
    const info = await evolution.fetchInstanceInfo(url, key, instance.instanceName);
    const owner = info?.ownerJid || info?.owner || info?.number;
    if (owner) value = String(owner).split('@')[0].replace(/\D/g, '') || null;
  } catch (err) {
    console.warn('[instance-health] falha ao consultar numero conectado:', err.message);
  }
  connectedNumberCache.set(instance.instanceName, { at: Date.now(), value });
  return value;
}

async function pruneHealthEvents() {
  if (Date.now() - lastPruneAt < 6 * 60 * 60 * 1000) return;
  lastPruneAt = Date.now();
  try {
    const cutoff = new Date(Date.now() - HEALTH_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await prisma.waInstanceHealthEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch (err) {
    console.warn('[instance-health] falha ao limpar historico:', err.message);
  }
}

function displayInstanceName(instance) {
  const name = String(instance?.instanceName || '');
  const prefix = `${instance?.tenantId || ''}_`;
  return (instance?.tenantId && name.startsWith(prefix) ? name.slice(prefix.length) : name).toUpperCase();
}

function formatBrDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * "Conectada mas NAO recebe": a sessao esta open e envia, mas as mensagens de
 * verificacao enviadas por outra conexao da empresa nao chegaram. Mantem
 * status 'connected' (o envio continua funcionando e outras rotinas dependem
 * disso) e sinaliza via healthStatus.
 */
function applyReceiveHealth(instance, state, health, healthError = null) {
  if (state !== 'open') return { health, healthError };
  if ((instance?.probeFailures || 0) < inboundProbe.FAILURES_TO_ALERT) return { health, healthError };
  const since = formatBrDateTime(instance.lastInboundAt);
  return {
    health: { status: 'connected', healthStatus: 'not_receiving' },
    healthError: `Conectada e enviando, mas NÃO está recebendo mensagens de clientes${since ? ` (última recebida em ${since})` : ''}. `
      + 'As verificações automáticas enviadas para este número não chegaram. Recrie a sessão e leia o QR Code de novo.',
  };
}

function notReceivingAlertText(instance) {
  const since = formatBrDateTime(instance.lastInboundAt);
  return `🚨 A conexão *${displayInstanceName(instance)}* (+${instance.phone || '?'}) está CONECTADA, mas NÃO está recebendo mensagens de clientes`
    + `${since ? ` desde *${since}*` : ''}.\n\n`
    + 'Os clientes estão escrevendo, as mensagens chegam só no celular e não aparecem no CRM.\n\n'
    + '*O que fazer:*\n'
    + '1. No celular desse número: WhatsApp > Aparelhos conectados > remova sessões antigas.\n'
    + '2. No CRM: Conexões > "Recriar sessão" e leia o QR Code.';
}

// Cada verificacao que nao chega -> reinicia a sessao (sem logout). O WhatsApp
// segura as mensagens e as entrega na reconexao; depois buscamos o que ficou
// para tras. Varios reinicios no mesmo dia -> recomenda recriar via QR.
const AUTO_RESTART_MIN_GAP_MS = 10 * 60 * 1000;
const RESTARTS_BEFORE_QR_ADVICE = 3;
const lastAutoRestartAt = new Map();
const restartsByDay = new Map();
const qrAdviceSentDay = new Map();

function brDayKey(ms = Date.now()) {
  return new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function restartAndRecover(instance, reason) {
  const now = Date.now();
  if (now - (lastAutoRestartAt.get(instance.id) || 0) < AUTO_RESTART_MIN_GAP_MS) return false;
  const { evolutionUrl, evolutionKey } = evolution.resolveEvolutionConfig(instance.tenant?.settings, instance);
  if (!evolutionUrl || !evolutionKey) return false;
  lastAutoRestartAt.set(instance.id, now);
  try {
    await evolution.restartInstance(evolutionUrl, evolutionKey, instance.instanceName);
  } catch (err) {
    console.warn(`[instance-health] ${instance.instanceName}: falha ao reiniciar sessão: ${err.message}`);
    return false;
  }
  console.warn(`[instance-health] ${instance.instanceName}: sessão reiniciada automaticamente (${reason}).`);

  const day = brDayKey(now);
  const counter = restartsByDay.get(instance.id);
  const count = counter && counter.day === day ? counter.count + 1 : 1;
  restartsByDay.set(instance.id, { day, count });
  if (count >= RESTARTS_BEFORE_QR_ADVICE && qrAdviceSentDay.get(instance.id) !== day) {
    qrAdviceSentDay.set(instance.id, day);
    sendSystemAlert(instance.tenantId,
      `⚠️ A conexão *${displayInstanceName(instance)}* (+${instance.phone || '?'}) parou de receber ${count}x hoje e foi reiniciada automaticamente em cada vez. `
      + 'Para resolver de vez: no celular, WhatsApp > Aparelhos conectados > remova as sessões antigas; depois no CRM, Conexões > "Recriar sessão" e leia o QR Code.',
    ).catch(() => {});
  }

  // Depois que a sessao reabrir, busca o que o WhatsApp nao entregou.
  setTimeout(() => {
    syncMissedMessages(instance.instanceName, { hours: 12, limitPerChat: 30, maxChats: 100, surfaceLate: true })
      .then((r) => console.log(`[instance-health] ${instance.instanceName}: recuperação pós-reinício -> ${r?.synced ?? 0} mensagens.`))
      .catch((err) => console.warn(`[instance-health] recuperação pós-reinício de ${instance.instanceName} falhou: ${err.message}`));
  }, 90 * 1000).unref?.();
  return true;
}

inboundProbe.onProbeFailed((instance) => restartAndRecover(instance, 'verificação de recebimento não chegou'));

async function onNotReceiving(instance) {
  lastNotReceivingAlertAt.set(instance.id, Date.now());
  incidentStartedAt.set(instance.id, Date.now());
  console.error(`[instance-health] ${instance.instanceName} NÃO está recebendo mensagens (verificações falharam).`);
  sendSystemAlert(instance.tenantId, notReceivingAlertText(instance)).catch(() => {});
  // O reinicio automatico ja acontece a cada verificacao que falha
  // (restartAndRecover via inboundProbe.onProbeFailed).
}

function onReceivingRecovered(instance) {
  lastNotReceivingAlertAt.delete(instance.id);
  incidentStartedAt.delete(instance.id);
  console.log(`[instance-health] ${instance.instanceName} voltou a receber mensagens.`);
  sendSystemAlert(
    instance.tenantId,
    `✅ A conexão *${displayInstanceName(instance)}* (+${instance.phone || '?'}) voltou a receber mensagens. O sistema vai buscar as conversas das últimas 24h que ficaram para trás.`,
  ).catch(() => {});
  syncMissedMessages(instance.instanceName, { hours: 24, limitPerChat: 50, maxChats: 150, surfaceLate: true })
    .catch((err) => console.warn(`[instance-health] recuperação pós-falha de ${instance.instanceName} falhou: ${err.message}`));
}

// O incidente segue as falhas de verificacao (probeFailures), NAO o
// healthStatus: este oscila a cada reconexao (connection.update grava
// unstable/healthy) e dispararia alerta + reinicio em loop.
function handleReceiveTransition(before, after) {
  if (!after) return;
  const merged = { ...before, ...after };
  const failing = (after.probeFailures || 0) >= inboundProbe.FAILURES_TO_ALERT;
  const inIncident = lastNotReceivingAlertAt.has(after.id);
  if (failing && !inIncident) {
    onNotReceiving(merged).catch(() => {});
  } else if (failing && inIncident) {
    const last = lastNotReceivingAlertAt.get(after.id) || 0;
    if (Date.now() - last >= NOT_RECEIVING_REMINDER_MS) {
      lastNotReceivingAlertAt.set(after.id, Date.now());
      sendSystemAlert(after.tenantId, `(Lembrete) ${notReceivingAlertText(merged)}`).catch(() => {});
    }
  } else if (!failing && inIncident) {
    // So declara recuperada quando uma verificacao CHEGOU depois do inicio do
    // incidente (recriar a sessao zera as falhas, mas ainda nao prova nada).
    const startedAt = incidentStartedAt.get(after.id) || 0;
    const okAt = after.probeOkAt ? new Date(after.probeOkAt).getTime() : 0;
    if (okAt > startedAt) onReceivingRecovered(merged);
  }
}

async function checkInstance(instance) {
  const checkedAt = new Date();
  if (String(process.env.LOCAL_DEMO || '').toLowerCase() === 'true') {
    return instance;
  }
  const settings = instance.tenant?.settings;
  const { evolutionUrl, evolutionKey } = evolution.resolveEvolutionConfig(settings, instance);

  if (!evolutionUrl || !evolutionKey) {
    const health = { status: 'degraded', healthStatus: 'misconfigured' };
    const changed = instance.status !== health.status || instance.healthStatus !== health.healthStatus;
    const updated = await prisma.waInstance.update({
      where: { id: instance.id },
      data: {
        ...health,
        lastConnectionState: 'unknown',
        lastHealthCheckAt: checkedAt,
        lastHealthError: 'Evolution API não configurada para esta empresa.',
      },
    });
    if (changed) {
      emitHealth(updated, 'unknown', health.healthStatus, checkedAt, updated.lastHealthError);
      await recordHealthEvent(updated, { ...health, connectionState: 'unknown', error: updated.lastHealthError });
    }
    return updated;
  }

  try {
    const payload = await evolution.getConnectionState(
      evolutionUrl,
      evolutionKey,
      instance.instanceName,
      { timeout: DEFAULT_REQUEST_TIMEOUT_MS },
    );
    const state = parseConnectionState(payload);
    let health = healthForState(state);
    let healthError = state ? null : 'Evolution respondeu sem informar o estado da conexão.';

    // D: conectada mas SEM webhook ha muito tempo -> "instancia muda". So alarma
    // instancia ATIVA (com mensagem nas ultimas 48h) -- uma instancia parada/de
    // teste ficaria "silent" pra sempre sem ser incidente.
    if (state === 'open' && instance.lastWebhookAt) {
      const silenceMs = Date.now() - new Date(instance.lastWebhookAt).getTime();
      if (silenceMs > SILENCE_ALERT_MS && await hasRecentTraffic(instance.id)) {
        health = { status: 'degraded', healthStatus: 'silent' };
        healthError = `Instância conectada, mas sem receber eventos da Evolution há ${Math.round(silenceMs / 60000)} min. Mensagens podem estar sendo perdidas.`;
      }
    }

    ({ health, healthError } = applyReceiveHealth(instance, state, health, healthError));

    // Divergencia de numero: 'open', mas logada num numero diferente do
    // cadastrado -- alguem leu o QR com o aparelho errado. Foi assim que a
    // LCD-FINANCEIRO ficou dias sem receber sem nenhum alarme. O webhook
    // connection.update ja pega quando traz o owner; aqui e a rede de
    // seguranca para quando o evento nao traz.
    if (state === 'open' && instance.phone && health.healthStatus === 'healthy') {
      const connectedNumber = await fetchConnectedNumber(instance, evolutionUrl, evolutionKey);
      if (connectedNumber && !evolution.samePhoneNumber(connectedNumber, instance.phone)) {
        health = { status: 'degraded', healthStatus: 'wrong_number' };
        healthError = `Sessão conectada no número +${connectedNumber}, mas esta conexão está cadastrada para +${instance.phone}. Releia o QR com o aparelho certo.`;
        // re-verifica no proximo ciclo (nao segura o cache) para sair rapido
        // do alarme assim que alguem religar no numero certo.
        connectedNumberCache.delete(instance.instanceName);
      }
    }

    const changed = instance.lastConnectionState !== state
      || instance.status !== health.status
      || instance.healthStatus !== health.healthStatus;
    const updated = await prisma.waInstance.update({
      where: { id: instance.id },
      data: {
        ...health,
        lastConnectionState: state || 'unknown',
        ...(changed && (state === 'open') !== (instance.lastConnectionState === 'open') ? { lastConnectionAt: checkedAt } : {}),
        lastHealthCheckAt: checkedAt,
        lastHealthError: healthError,
      },
    });
    if (changed) {
      emitHealth(updated, state, health.healthStatus, checkedAt, healthError);
      await recordHealthEvent(updated, {
        status: health.status,
        healthStatus: health.healthStatus,
        connectionState: state || 'unknown',
        error: healthError,
        lastWebhookAt: updated.lastWebhookAt,
      });
    }
    handleReceiveTransition(instance, updated);
    return updated;
  } catch (error) {
    const errText = String(error?.response?.data?.message || error?.message || 'Evolution sem resposta').slice(0, 500);
    const changed = instance.status !== 'degraded' || instance.healthStatus !== 'degraded';
    const updated = await prisma.waInstance.update({
      where: { id: instance.id },
      data: {
        status: 'degraded',
        healthStatus: 'degraded',
        lastConnectionState: 'unknown',
        lastHealthCheckAt: checkedAt,
        lastHealthError: errText,
      },
    });
    if (changed) {
      emitHealth(updated, 'unknown', 'degraded', checkedAt, errText);
      await recordHealthEvent(updated, { status: 'degraded', healthStatus: 'degraded', connectionState: 'unknown', error: errText });
    }
    console.warn(`[instance-health] ${instance.instanceName} indisponível: ${errText}`);
    return updated;
  }
}

// C: reconciliacao periodica -- puxa mensagens recentes da Evolution e preenche
// o que faltou. Nao bloqueia o loop de health.
function maybeReconcile(instance) {
  if (instance.status !== 'connected' && instance.healthStatus !== 'silent') return;
  const last = lastReconcileAt.get(instance.instanceName) || 0;
  if (Date.now() - last < RECONCILE_INTERVAL_MS) return;
  lastReconcileAt.set(instance.instanceName, Date.now());
  syncMissedMessages(instance.instanceName, { hours: 3, limitPerChat: 30, maxChats: 40 })
    .catch((err) => console.warn(`[instance-health] reconciliação de ${instance.instanceName} falhou: ${err.message}`));
}

async function checkAllInstances() {
  if (running) return;
  running = true;
  try {
    const instances = await prisma.waInstance.findMany({
      where: { instanceName: { not: { startsWith: 'DELETED_' } } },
      include: { tenant: { include: { settings: true } } },
    });
    const current = [];
    for (const instance of instances) {
      try {
        const updated = await checkInstance(instance);
        maybeReconcile(updated || instance);
        current.push({ ...instance, ...(updated || {}) });
      } catch (error) {
        current.push(instance);
        console.warn(`[instance-health] falha ao registrar ${instance.instanceName}: ${error.message}`);
      }
    }
    try {
      await inboundProbe.runProbeCycle(current);
    } catch (error) {
      console.warn(`[inbound-probe] ciclo falhou: ${error.message}`);
    }
    await pruneHealthEvents();
  } catch (error) {
    console.warn(`[instance-health] falha ao consultar instâncias: ${error.message}`);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  const interval = Math.max(
    15 * 1000,
    Number(process.env.INSTANCE_HEALTH_INTERVAL_MS || DEFAULT_INTERVAL_MS),
  );
  checkAllInstances().catch(() => {});
  timer = setInterval(() => checkAllInstances().catch(() => {}), interval);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[instance-health] monitoramento iniciado (intervalo=${interval}ms, alarme de silêncio=${Math.round(SILENCE_ALERT_MS / 60000)}min, reconciliação=${Math.round(RECONCILE_INTERVAL_MS / 60000)}min)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  setIo,
  start,
  stop,
  checkAllInstances,
  checkInstance,
  parseConnectionState,
  healthForState,
  applyReceiveHealth,
  __testing: { parseConnectionState, healthForState, applyReceiveHealth, displayInstanceName, notReceivingAlertText, SILENCE_ALERT_MS },
};
