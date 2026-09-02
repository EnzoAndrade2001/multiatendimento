const prisma = require('../lib/prisma');
const printGuard = require('./printGuardService');

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;

let timer = null;
let initialTimer = null;
let running = false;

function configuredInterval() {
  const value = Number(process.env.PRINTGUARD_AUTO_SYNC_INTERVAL_MS);
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.max(30 * 1000, Math.min(value, 60 * 60 * 1000));
}

function isEnabled() {
  return String(process.env.PRINTGUARD_AUTO_SYNC_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

async function syncAllConnections() {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;
  const summary = { tenants: 0, succeeded: 0, failed: 0, processed: 0, reconciled: 0 };
  try {
    const connections = await prisma.printGuardConnection.findMany({
      where: { status: { not: 'INACTIVE' } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    summary.tenants = connections.length;
    for (const connection of connections) {
      try {
        const result = await printGuard.syncEvents(connection.tenantId);
        summary.succeeded += 1;
        summary.processed += Number(result?.processed || 0);
        summary.reconciled += Number(result?.reconciled || 0);
        console.log(
          `[printguard-auto] tenant=${connection.tenantId} processados=${Number(result?.processed || 0)} `
          + `vinculos_corrigidos=${Number(result?.reconciled || 0)}`,
        );
      } catch (error) {
        summary.failed += 1;
        console.error(`[printguard-auto] falha no tenant ${connection.tenantId}:`, error.message);
      }
    }
    return summary;
  } catch (error) {
    console.error('[printguard-auto] falha ao listar conexoes:', error.message);
    return { ...summary, failed: Math.max(summary.failed, 1), error: error.message };
  } finally {
    running = false;
  }
}

function start() {
  if (timer || initialTimer || !isEnabled()) {
    if (!isEnabled()) console.log('[printguard-auto] sincronizacao automatica desativada por configuracao.');
    return;
  }

  const interval = configuredInterval();
  initialTimer = setTimeout(() => {
    initialTimer = null;
    syncAllConnections().catch((error) => console.error('[printguard-auto] erro na rodada inicial:', error.message));
  }, INITIAL_DELAY_MS);
  initialTimer.unref?.();
  timer = setInterval(() => {
    syncAllConnections().catch((error) => console.error('[printguard-auto] erro na rodada:', error.message));
  }, interval);
  timer.unref?.();
  console.log(`[printguard-auto] sincronizacao automatica iniciada (${Math.round(interval / 1000)}s).`);
}

function stop() {
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null;
  timer = null;
  running = false;
}

module.exports = { start, stop, syncAllConnections, configuredInterval, isEnabled };
