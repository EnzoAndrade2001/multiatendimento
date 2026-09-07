// Comparacao de versao do agente Firebird. As versoes publicadas no
// release.json seguem "MAJOR.MINOR.PATCH" (ex.: "1.1.3"); toleramos um
// prefixo "v" e sufixos de pre-release ("-rc1", "+build") ignorando-os.

function parseVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '');
  if (!text) return null;
  const core = text.split(/[-+]/)[0];
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts;
}

// -1 se a < b, 0 se iguais, 1 se a > b, null se algum lado nao for comparavel.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}

// true somente quando da para comparar E a publicada e mais nova que a atual.
// Versao atual ausente/ilegivel => false (nao afirmamos "desatualizado" no escuro).
function isOutdated(currentVersion, latestVersion) {
  return compareVersions(latestVersion, currentVersion) === 1;
}

module.exports = { parseVersion, compareVersions, isOutdated };
