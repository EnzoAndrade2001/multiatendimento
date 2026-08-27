function normalizeTagName(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized && normalized.length <= 80 ? normalized : null;
}

function canonicalTagName(value) {
  const normalized = normalizeTagName(value);
  return normalized
    ? normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
    : null;
}

function normalizeTagColor(value, fallback = '#D4AF37') {
  const color = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map((part) => part + part).join('').toUpperCase()}`;
  return fallback;
}

function parseTagList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeTagList(value) {
  const seen = new Set();
  const result = [];
  for (const item of parseTagList(value)) {
    const name = normalizeTagName(item);
    const canonical = canonicalTagName(name);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(name);
  }
  return result;
}

module.exports = { normalizeTagName, canonicalTagName, normalizeTagColor, parseTagList, normalizeTagList };
