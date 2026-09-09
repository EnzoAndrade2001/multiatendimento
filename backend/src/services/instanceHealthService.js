const prisma = require('../lib/prisma');
const evolution = require('./evolutionService');
const { syncMissedMessages } = require('./syncMissedMessagesService');

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

async function checkInstance(instance) {
  const checkedAt = new Date();
  if (String(process.env.LOCAL_DEMO || '').toLowerCase() === 'true') {
    return instance;
  }
  const settings = instance.tenant?.settings;
  const evolutionUrl = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
  const evolutionKey = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;

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
    for (const instance of instances) {
      try {
        const updated = await checkInstance(instance);
        maybeReconcile(updated || instance);
      } catch (error) {
        console.warn(`[instance-health] falha ao registrar ${instance.instanceName}: ${error.message}`);
      }
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
  __testing: { parseConnectionState, healthForState, SILENCE_ALERT_MS },
};
