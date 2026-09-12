const prisma = require('../lib/prisma');
async function schedule(req, res) {
  const { tenantId } = req.user;
  const { contactId, instanceId, body, sendAt } = req.body;
  const date = new Date(sendAt);
  if (typeof contactId !== 'string' || typeof instanceId !== 'string' || typeof body !== 'string' || !body.trim() || body.length > 4096 || !Number.isFinite(date.getTime()) || date <= new Date()) return res.status(400).json({ error: 'Informe contato, conexão, mensagem de até 4096 caracteres e uma data futura.' });
  try {
    const [contact, instance] = await Promise.all([
      prisma.contact.findFirst({ where: { id: contactId, tenantId } }),
      prisma.waInstance.findFirst({ where: { id: instanceId, tenantId } }),
    ]);
    if (!contact || !instance || instance.instanceName.startsWith('DELETED_') || !['evolution_qr', 'evolution_official'].includes(instance.provider)) return res.status(404).json({ error: 'Contato ou conexão indisponível.' });
    return res.status(201).json(await prisma.scheduledMessage.create({ data: { tenantId, contactId, instanceId, body: body.trim(), sendAt: date } }));
  } catch (err) { return res.status(500).json({ error: 'Erro ao agendar mensagem' }); }
}
async function list(req, res) {
  try {
    return res.json(await prisma.scheduledMessage.findMany({
      where: { tenantId: req.user.tenantId, ...(typeof req.query.contactId === 'string' ? { contactId: req.query.contactId } : {}) },
      include: { contact: { select: { id: true, name: true, phone: true } } }, orderBy: { sendAt: 'desc' }, take: 200,
    }));
  } catch (err) { return res.status(500).json({ error: 'Erro ao listar agendamentos' }); }
}
async function remove(req, res) {
  try {
    const result = await prisma.scheduledMessage.updateMany({
      where: { id: req.params.id, tenantId: req.user.tenantId, status: { in: ['queued', 'failed', 'blocked'] } },
      data: { status: 'cancelled', processed: true, nextAttemptAt: null },
    });
    if (!result.count) return res.status(409).json({ error: 'Agendamento indisponível ou já em envio.' });
    return res.sendStatus(204);
  } catch (err) { return res.status(500).json({ error: 'Erro ao cancelar agendamento' }); }
}
async function retry(req, res) {
  try {
    const scheduled = await prisma.scheduledMessage.findFirst({ where: { id: req.params.id, tenantId: req.user.tenantId } });
    if (!scheduled) return res.status(404).json({ error: 'Agendamento não encontrado.' });
    if (scheduled.deliveryUncertain && req.body?.confirmUncertain !== true) return res.status(409).json({ error: 'Confirme no WhatsApp que a mensagem não foi entregue antes de reenviar.', requiresConfirmation: true });
    const result = await prisma.scheduledMessage.updateMany({
      where: { id: scheduled.id, tenantId: req.user.tenantId, status: { in: ['failed', 'blocked'] }, attempts: scheduled.attempts },
      data: { status: 'queued', processed: false, attempts: 0, sendAt: new Date(), nextAttemptAt: null, deliveryUncertain: false, lastError: null, claimToken: null, claimedAt: null },
    });
    if (!result.count) return res.status(409).json({ error: 'Este agendamento não pode ser reenviado.' });
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ error: 'Erro ao reenviar agendamento' }); }
}
module.exports = { schedule, list, remove, retry };
