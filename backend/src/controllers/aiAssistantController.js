const prisma = require('../lib/prisma');
const aiService = require('../services/aiService');
const aiAssistantService = require('../services/aiAssistantService');
const { hasPermission } = require('../auth/permissions');

const MAX_QUESTION_LENGTH = 500;

async function query(req, res) {
  const tenantId = req.user.tenantId;
  const pergunta = String(req.body?.pergunta || '').trim().slice(0, MAX_QUESTION_LENGTH);
  let crmCustomerId = req.body?.crmCustomerId ? String(req.body.crmCustomerId) : null;
  const ticketId = req.body?.ticketId ? String(req.body.ticketId) : null;
  if (!pergunta) return res.status(400).json({ error: 'Informe uma pergunta.' });

  if (!crmCustomerId && ticketId) {
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, tenantId },
      select: { contact: { select: { crmCustomerId: true } } },
    });
    crmCustomerId = ticket?.contact?.crmCustomerId || null;
  }

  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  if (!settings || !aiService.hasConfiguredProvider(settings)) {
    return res.status(409).json({ error: 'Nenhum provedor de IA configurado para esta empresa.' });
  }

  try {
    const result = await aiAssistantService.answerQuestion({
      tenantId,
      settings,
      pergunta,
      crmCustomerId,
      canViewFinancial: hasPermission(req.user, 'crm.financial.view'),
    });
    return res.json(result);
  } catch (error) {
    console.error('[ai-assistant] falha ao responder pergunta:', error.message);
    return res.status(500).json({ error: 'Não foi possível responder agora. Tente novamente.' });
  }
}

module.exports = { query };
