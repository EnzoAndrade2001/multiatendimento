const fs = require('fs');
const path = require('path');

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

module.exports = { getAgentInfo, downloadAgent, readReleaseManifest };
