const prisma = require('../lib/prisma');
const { sendServiceOrderManagerCopy } = require('../services/serviceOrderManagerCopyService');

async function sendManagerCopy(req, res) {
  const tenantId = req.user.tenantId;
  let order = null;
  try {
    order = await prisma.serviceOrder.findFirst({
      where: {
        tenantId,
        OR: [
          { id: req.params.id },
          { externalId: String(req.params.id) },
        ],
      },
      select: { id: true, externalId: true },
    });

    if (!order) return res.status(404).json({ error: 'O.S. não encontrada no Multiatendimento.' });
    if (!order.externalId) return res.status(409).json({ error: 'A O.S. ainda não foi confirmada pelo ILUX WEB.' });

    const result = await sendServiceOrderManagerCopy(tenantId, order.id, { force: true });
    if (result.skipped === 'incomplete-settings') {
      return res.status(400).json({ error: 'Configure o WhatsApp do gestor e a instância de saída em Atendimento.' });
    }
    return res.json({
      ok: true,
      externalId: order.externalId,
      phone: result.phone,
      filename: result.filename,
      chatRegistered: result.chatRegistered,
      warning: result.warning,
    });
  } catch (error) {
    console.error(`[sendManagerCopy] Falha no reenvio manual da O.S. ${order?.externalId || req.params.id}:`, error.message);
    return res.status(502).json({ error: `Não foi possível enviar ao gestor: ${error.message}` });
  }
}

module.exports = { sendManagerCopy };
