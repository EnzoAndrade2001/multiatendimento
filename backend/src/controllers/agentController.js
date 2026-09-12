const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { isOutdated } = require('../utils/agentVersion');

// Um agente e considerado offline se o ultimo ping passou disto (2x o
// SYNC_INTERVAL padrao de 5 min). Mesma regra que a tela ja usava sobre
// firebirdLastSyncAt; agora aplicada por instalacao.
const AGENT_STALE_AFTER_MS = 10 * 60 * 1000;

const DEFAULT_AGENT_DOWNLOAD_URL = 'https://github.com/connectbrazilads/multiatendimento/raw/main/firebird-client/FirebirdCRMClient.exe';
const DEFAULT_AGENT_RELEASE_DIR = '/data/agent-releases';
const RELEASE_MANIFEST_FILE = 'release.json';

function getReleaseDir() {
  return path.resolve(process.env.FIREBIRD_AGENT_RELEASE_DIR || DEFAULT_AGENT_RELEASE_DIR);
}

function readReleaseManifest() {
  try {
    const manifestPath = path.join(getReleaseDir(), RELEASE_MANIFEST_FILE);
    const stat = fs.statSync(manifestPath);
    if (!stat.isFile() || stat.size > 32 * 1024) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest && typeof manifest === 'object' ? manifest : null;
  } catch {
    return null;
  }
}

function findRelease(version) {
  const manifest = readReleaseManifest();
  if (!manifest) return null;
  const candidates = [manifest, ...(Array.isArray(manifest.releases) ? manifest.releases : [])];
  return candidates.find((item) => String(item?.version || '') === String(version || '')) || null;
}

function getReleasePath(release) {
  if (!release) return null;
  const releaseDir = getReleaseDir();
  const filePath = path.resolve(releaseDir, path.basename(release.fileName || ''));
  if (!filePath.startsWith(`${releaseDir}${path.sep}`)) return null;
  return filePath;
}

function getAgentFileName(manifest = null) {
  return path.basename(manifest?.fileName || process.env.FIREBIRD_AGENT_FILE_NAME || 'FirebirdCRMClient.exe');
}

function getLocalAgentPath(manifest = null) {
  const releaseDir = getReleaseDir();
  const filePath = path.resolve(releaseDir, getAgentFileName(manifest));
  if (!filePath.startsWith(`${releaseDir}${path.sep}`)) return null;
  return { releaseDir, filePath };
}

function getAgentInfo(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const downloadUrl = String(process.env.FIREBIRD_AGENT_DOWNLOAD_URL || DEFAULT_AGENT_DOWNLOAD_URL).trim();
  const manifest = readReleaseManifest();
  const local = getLocalAgentPath(manifest);
  const downloadAvailable = Boolean(local && fs.existsSync(local.filePath));

  res.json({
    version: manifest?.version || process.env.FIREBIRD_AGENT_VERSION || '1.0.0',
    fileName: getAgentFileName(manifest),
    downloadUrl: '/api/settings/agent-download',
    externalDownloadUrl: downloadUrl,
    downloadAvailable,
    storage: 'volume',
    storagePath: process.env.FIREBIRD_AGENT_RELEASE_DIR || DEFAULT_AGENT_RELEASE_DIR,
    sha256: manifest?.sha256 || process.env.FIREBIRD_AGENT_SHA256 || null,
    releasedAt: manifest?.releasedAt || process.env.FIREBIRD_AGENT_RELEASED_AT || null,
    supportUrl: manifest?.supportUrl || process.env.FIREBIRD_AGENT_SUPPORT_URL || null,
  });
}

function downloadAgent(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const manifest = readReleaseManifest();
  const local = getLocalAgentPath(manifest);
  if (!local || !fs.existsSync(local.filePath)) {
    return res.status(404).json({
      error: 'Pacote do agente ainda nao publicado no volume persistente.',
      path: process.env.FIREBIRD_AGENT_RELEASE_DIR || DEFAULT_AGENT_RELEASE_DIR,
    });
  }

  return res.download(local.filePath, getAgentFileName(manifest), (error) => {
    if (error && !res.headersSent) {
      res.status(500).json({ error: 'Nao foi possivel preparar o download do agente.' });
    }
  });
}

function downloadAgentRelease(req, res) {
  const release = findRelease(req.params.version);
  const filePath = getReleasePath(release);
  if (!release || !filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Versao do agente nao encontrada.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Agent-Version', String(release.version));
  if (release.sha256) res.setHeader('X-Checksum-Sha256', String(release.sha256));
  return res.download(filePath, path.basename(release.fileName), (error) => {
    if (error && !res.headersSent) res.status(500).json({ error: 'Nao foi possivel baixar esta versao.' });
  });
}

// Inventario das instalacoes do agente Firebird DESTE tenant (uma linha por
// installId, alimentada pelos pings). Cruza a versao que cada uma roda com o
// release.json publicado para marcar "desatualizado" sem depender de o agente
// ler a resposta do ping.
async function getAgentStatus(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const manifest = readReleaseManifest();
  const latestVersion = manifest?.version || process.env.FIREBIRD_AGENT_VERSION || null;

  let agents = [];
  try {
    agents = await prisma.firebirdAgent.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { lastSeenAt: 'desc' },
    });
  } catch (error) {
    console.error('[agent-status] falha ao consultar instalacoes do agente:', error.message);
  }

  const now = Date.now();
  const items = agents.map((agent) => {
    const lastSeenMs = agent.lastSeenAt ? now - new Date(agent.lastSeenAt).getTime() : null;
    return {
      installId: agent.installId,
      // Instalacoes sem installId real recebem uma chave "legacy:..." no ping.
      identified: !String(agent.installId || '').startsWith('legacy:'),
      hostname: agent.hostname || null,
      version: agent.version || null,
      protocolVersion: agent.protocolVersion || null,
      runtime: agent.runtime || null,
      capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : null,
      firstSeenAt: agent.firstSeenAt,
      lastSeenAt: agent.lastSeenAt,
      online: lastSeenMs != null && lastSeenMs < AGENT_STALE_AFTER_MS,
      updateAvailable: latestVersion ? isOutdated(agent.version, latestVersion) : false,
    };
  });

  res.json({
    latestVersion,
    releasedAt: manifest?.releasedAt || null,
    staleAfterMs: AGENT_STALE_AFTER_MS,
    agentCount: items.length,
    onlineCount: items.filter((item) => item.online).length,
    outdatedCount: items.filter((item) => item.updateAvailable).length,
    agents: items,
  });
}

module.exports = { getAgentInfo, downloadAgent, downloadAgentRelease, getAgentStatus, readReleaseManifest, findRelease };
