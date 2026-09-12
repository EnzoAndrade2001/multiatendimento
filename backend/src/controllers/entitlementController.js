const prisma = require('../lib/prisma');
const { FEATURE_KEY_RE, normalizeLimits, resolveTenantEntitlements } = require('../services/featureEntitlementService');

function deny(req, res) {
  if (req.user?.role !== 'superadmin' || req.user?.supportMode || (req.user?.supportLevel || 'manager') !== 'manager') { res.status(403).json({ error: 'Acesso exclusivo do gestor da equipe de suporte.' }); return true; }
  return false;
}
const cleanCode = (value) => String(value || '').trim().toLowerCase();

async function getMyEntitlements(req, res) {
  const result = await resolveTenantEntitlements(req.user.tenantId);
  if (!result) return res.status(404).json({ error: 'Empresa não encontrada.' });
  res.json(result);
}

async function listCatalog(req, res) {
  if (deny(req, res)) return;
  const [features, plans] = await Promise.all([
    prisma.feature.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    prisma.productPlan.findMany({ include: { features: { include: { feature: true } } }, orderBy: [{ position: 'asc' }, { name: 'asc' }] }),
  ]);
  res.json({ features, plans });
}

async function upsertFeature(req, res) {
  if (deny(req, res)) return;
  const key = cleanCode(req.body.key);
  if (!FEATURE_KEY_RE.test(key) || !String(req.body.name || '').trim()) return res.status(400).json({ error: 'Chave e nome válidos são obrigatórios.' });
  const feature = await prisma.feature.upsert({ where: { key }, create: { key, name: String(req.body.name).trim(), description: req.body.description || null, category: req.body.category || null, active: req.body.active !== false }, update: { name: String(req.body.name).trim(), description: req.body.description ?? undefined, category: req.body.category ?? undefined, active: req.body.active ?? undefined } });
  res.json(feature);
}

async function upsertPlan(req, res) {
  if (deny(req, res)) return;
  const code = cleanCode(req.body.code);
  if (!FEATURE_KEY_RE.test(code) || !String(req.body.name || '').trim()) return res.status(400).json({ error: 'Código e nome válidos são obrigatórios.' });
  let limits; try { limits = normalizeLimits(req.body.limits); } catch (e) { return res.status(400).json({ error: e.message }); }
  const monthlyPrice = Number(req.body.monthlyPrice ?? 0);
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) return res.status(400).json({ error: 'Valor mensal inválido.' });
  const plan = await prisma.productPlan.upsert({ where: { code }, create: { code, name: String(req.body.name).trim(), description: req.body.description || null, active: req.body.active !== false, position: Number(req.body.position) || 0, monthlyPrice, limits }, update: { name: String(req.body.name).trim(), description: req.body.description ?? undefined, active: req.body.active ?? undefined, position: req.body.position === undefined ? undefined : Number(req.body.position) || 0, monthlyPrice, limits } });
  res.json(plan);
}

async function setPlanFeatures(req, res) {
  if (deny(req, res)) return;
  const plan = await prisma.productPlan.findUnique({ where: { id: req.params.planId } });
  if (!plan) return res.status(404).json({ error: 'Plano não encontrado.' });
  const entries = Array.isArray(req.body.features) ? req.body.features : [];
  try {
    await prisma.$transaction(entries.map((entry) => prisma.planFeature.upsert({
      where: { planId_featureId: { planId: plan.id, featureId: String(entry.featureId) } },
      create: { planId: plan.id, featureId: String(entry.featureId), enabled: entry.enabled !== false, limits: normalizeLimits(entry.limits) },
      update: { enabled: entry.enabled !== false, limits: normalizeLimits(entry.limits) },
    })));
  } catch (error) { return res.status(400).json({ error: error.message }); }
  res.json(await prisma.productPlan.findUnique({ where: { id: plan.id }, include: { features: { include: { feature: true } } } }));
}

async function getTenantEntitlements(req, res) {
  if (deny(req, res)) return;
  const result = await resolveTenantEntitlements(req.params.id);
  if (!result) return res.status(404).json({ error: 'Empresa não encontrada.' });
  const overrides = await prisma.tenantFeatureOverride.findMany({
    where: { tenantId: req.params.id }, include: { feature: { select: { key: true } } }, orderBy: { createdAt: 'asc' },
  });
  res.json({ ...result, overrides: overrides.map((item) => ({
    id: item.id, featureId: item.featureId, featureKey: item.feature.key, key: item.feature.key,
    enabled: item.enabled, limits: item.limits || {}, reason: item.reason || null,
  })) });
}

async function setTenantOverrides(req, res) {
  if (deny(req, res)) return;
  const tenantId = req.params.id;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Empresa não encontrada.' });
  const entries = Array.isArray(req.body.overrides) ? req.body.overrides : [];
  try {
    await prisma.$transaction(entries.map((entry) => prisma.tenantFeatureOverride.upsert({
      where: { tenantId_featureId: { tenantId, featureId: String(entry.featureId) } },
      create: { tenantId, featureId: String(entry.featureId), enabled: entry.enabled == null ? null : Boolean(entry.enabled), limits: normalizeLimits(entry.limits), reason: entry.reason || null },
      update: { enabled: entry.enabled == null ? null : Boolean(entry.enabled), limits: normalizeLimits(entry.limits), reason: entry.reason || null },
    })));
  } catch (error) { return res.status(400).json({ error: error.message }); }
  return getTenantEntitlements(req, res);
}

module.exports = { getMyEntitlements, listCatalog, upsertFeature, upsertPlan, setPlanFeatures, getTenantEntitlements, setTenantOverrides };
