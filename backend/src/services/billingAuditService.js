// Auditoria de divergencia dos documentos de cobranca (caminho da pasta).
// Nao muda nada no envio -- so aponta casos que merecem revisao humana:
//  - value_mismatch: o valor do titulo NAO aparece no texto do PDF casado
//    (o matcher do agente exige cliente + numero, mas o valor e opcional);
//  - duplicate_file: o mesmo arquivo (sha256) foi casado em >1 titulo distinto;
//  - statement_inconsistent: o demonstrativo sincronizado nao fecha
//    (VALDEMONSTRATIVOF + VALDEMONSTRATIVOE != VALDEMONSTRATIVO).
// Reativo: le o mesmo registro de pedido que cada clique/reenvio ja grava.

const prisma = require('../lib/prisma');
const billingDocuments = require('./billingDocumentService');

const RECONCILE_TOLERANCE = 0.05;
const MAX_SCAN = 1000;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function auditBillingDocuments(tenantId) {
  const items = [];

  // --- pedidos de documento concluidos (fonte: pasta) -----------------------
  let requests = [];
  try {
    requests = await prisma.externalSyncRecord.findMany({
      where: {
        tenantId,
        source: 'crm',
        entity: billingDocuments.REQUEST_ENTITY,
        payload: { path: ['status'], equals: 'success' },
      },
      orderBy: { receivedAt: 'desc' },
      take: MAX_SCAN,
      select: { payload: true },
    });
  } catch (error) {
    console.error('[billing-audit] falha ao ler pedidos:', error.message);
  }

  const bySha = new Map();
  for (const record of requests) {
    const p = record.payload || {};
    if (p.source && p.source !== 'ilux-export-folder') continue; // PlugBoleto / re-render nao entram
    const receivableExternalId = p.receivableExternalId ? String(p.receivableExternalId) : null;
    if (!receivableExternalId) continue;

    if (p.amountOk === false) {
      items.push({
        kind: 'value_mismatch',
        severity: 'high',
        documentType: p.documentType || null,
        receivableExternalId,
        invoiceNumber: p.invoiceNumber || null,
        fileName: p.fileName || null,
        detail: `O valor do título${num(p.receivableValue) != null ? ` (R$ ${num(p.receivableValue).toFixed(2)})` : ''} não aparece no PDF localizado na pasta.`,
        completedAt: p.completedAt || null,
      });
    }

    if (p.sha256) {
      if (!bySha.has(p.sha256)) bySha.set(p.sha256, new Set());
      bySha.get(p.sha256).add(`${p.documentType || '?'}:${receivableExternalId}`);
    }
  }

  for (const [sha, keys] of bySha) {
    const receivables = new Set([...keys].map((k) => k.split(':')[1]));
    if (receivables.size > 1) {
      items.push({
        kind: 'duplicate_file',
        severity: 'high',
        sha256: sha,
        receivableExternalIds: [...receivables],
        detail: `O mesmo arquivo foi casado em ${receivables.size} títulos diferentes (${[...receivables].join(', ')}).`,
      });
    }
  }

  // --- demonstrativos sincronizados que nao fecham ------------------------
  let statements = [];
  try {
    statements = await prisma.crmBillingStatement.findMany({
      where: { tenantId },
      orderBy: { syncedAt: 'desc' },
      take: MAX_SCAN,
      select: {
        externalId: true, period: true, receivableExternalId: true,
        totalValue: true, fixedValue: true, excessValue: true,
      },
    });
  } catch (error) {
    // Tabela pode nao existir num tenant sem a sincronizacao de demonstrativo.
    if (!/does not exist/i.test(error.message)) console.error('[billing-audit] falha ao ler demonstrativos:', error.message);
  }
  for (const s of statements) {
    const total = num(s.totalValue) || 0;
    const parts = (num(s.fixedValue) || 0) + (num(s.excessValue) || 0);
    if (Math.abs(parts - total) > RECONCILE_TOLERANCE) {
      items.push({
        kind: 'statement_inconsistent',
        severity: 'medium',
        statementExternalId: s.externalId,
        period: s.period || null,
        receivableExternalId: s.receivableExternalId || null,
        detail: `Demonstrativo não fecha no ILUX WEB: fixo ${parts.toFixed(2)} ≠ total ${total.toFixed(2)}.`,
      });
    }
  }

  const summary = items.reduce((acc, it) => {
    acc[it.kind] = (acc[it.kind] || 0) + 1;
    return acc;
  }, { value_mismatch: 0, duplicate_file: 0, statement_inconsistent: 0 });
  summary.total = items.length;

  return { summary, items };
}

module.exports = { auditBillingDocuments };
