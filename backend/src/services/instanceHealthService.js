const prisma = require('../lib/prisma');
const evolution = require('./evolutionService');

const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 1000;

let io = null;
let timer = null;
let running = false;

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

async function checkInstance(instance) {
  const checkedAt = new Date();
  // O ambiente local de demonstração não deve tentar falar com a Evolution
  // nem transformar instâncias fictícias em "desconectadas". Em produção essa
  // variável nunca é habilitada e o monitor segue validando cada conexão.
  if (String(process.env.LOCAL_DEMO || '').toLowerCase() === 'true') {
    return instance;
  }
  const settings = instance.tenant?.settings;
  const evolutionUrl = settings?.evolutionUrl || process.env.DEFAULT_EVOLUTION_URL;
  const evolutionKey = settings?.evolutionKey || process.env.DEFAULT_EVOLUTION_KEY;

  if (!evolutionUrl || !evolutionKey) {
    const health = { status: 'degraded', healthStatus: 'misconfigured' };
    const updated = await prisma.waInstance.update({
      where: { id: instance.id },
      data: {
        ...health,
        lastConnectionState: 'unknown',
        lastHealthCheckAt: checkedAt,
        lastHealthError: 'Evolution API não configurada para esta empresa.',
      },
    });
    emitHealth(updated, 'unknown', health.healthStatus, checkedAt, updated.lastHealthError);
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
    const health = healthForState(state);
    const changed = instance.lastConnectionState !== state || instance.status !== health.status;
    const updated = await prisma.waInstance.update({
      where: { id: instance.id },
      data: {
        ...health,
        lastConnectionState: state || 'unknown',
        ...(changed ? { lastConnectionAt: checkedAt } : {}),
        lastHealthCheckAt: checkedAt,
        lastHealthError: state ? null : 'Evolution respondeu sem informar o estado da conexão.',
      },
    });
    if (changed) emitHealth(updated, state, health.healthStatus, checkedAt);
    return updated;
  } catch (error) {
    const updated = await prisma.waInstance.update({
      where: { id: instance.id },
      data: {
        status: 'degraded',
        healthStatus: 'degraded',
        lastConnectionState: 'unknown',
        lastHealthCheckAt: checkedAt,
        lastHealthError: String(error?.response?.data?.message || error?.message || 'Evolution sem resposta').slice(0, 500),
      },
    });
    if (instance.status !== 'degraded' || instance.healthStatus !== 'degraded') {
      emitHealth(updated, 'unknown', 'degraded', checkedAt, updated.lastHealthError);
    }
    console.warn(`[instance-health] ${instance.instanceName} indisponível: ${updated.lastHealthError}`);
    return updated;
  }
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
        await checkInstance(instance);
      } catch (error) {
        console.warn(`[instance-health] falha ao registrar ${instance.instanceName}: ${error.message}`);
      }
    }
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
  console.log(`[instance-health] monitoramento iniciado (intervalo=${interval}ms)`);
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
  __testing: { parseConnectionState, healthForState },
};
