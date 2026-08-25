const prisma = require('../lib/prisma');
const evolutionService = require('../services/evolutionService');

let io;
function setIo(socketIo) { io = socketIo; }

async function sendBulk(req, res) {
  const { tag, contactIds, message, delay = 5000 } = req.body;
  const { tenantId } = req.user;

  if (!message) return res.status(400).json({ error: 'Mensagem obrigatória' });

  let filtered = [];

  if (tag) {
    const allContacts = await prisma.contact.findMany({
      where: { tenantId },
      include: { instance: true }
    });

    filtered = allContacts.filter(c => {
      try {
        const tags = JSON.parse(c.tags || '[]');
        return tags.includes(tag);
      } catch { return false; }
    });
  } else if (contactIds && Array.isArray(contactIds)) {
    filtered = await prisma.contact.findMany({
      where: { id: { in: contactIds }, tenantId },
      include: { instance: true }
    });
  }

  if (filtered.length === 0) return res.status(404).json({ error: 'Nenhum contato encontrado para o disparo' });

  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });

  // Resposta imediata
  res.json({ total: filtered.length, status: 'started' });

  // Processamento em background com Socket.io para feedback visual
  (async () => {
    let sent = 0;
    let errors = 0;

    for (const contact of filtered) {
      try {
        const personalized = message.replace(/\[nome\]/gi, contact.name || 'Cliente');
        
        const result = await evolutionService.sendText(
          settings.evolutionUrl,
          settings.evolutionKey,
          contact.instance.instanceName,
          contact.phone,
          personalized
        );

        // Opcional: Criar ticket/mensagem no banco se não quiser que o disparo seja "invisível"
        const ticket = await prisma.ticket.findFirst({
          where: { contactId: contact.id, status: { in: ['pending', 'open', 'bot'] } }
        });

        if (ticket) {
           await prisma.message.create({
             data: {
               ticketId: ticket.id,
               body: personalized,
               fromMe: true,
               fromBot: true,
               externalId: result?.key?.id || result?.message?.key?.id
             }
           });
           if (io) io.to(tenantId).emit('new_message', { ticketId: ticket.id });
        }

        sent++;
      } catch (err) {
        console.error(`[BulkSend] Erro para ${require('../utils/privacy').maskPhone(contact.phone)}:`, err.message);
        errors++;
      }

      // Notifica progresso via socket
      if (io) {
        io.to(tenantId).emit('bulk_progress', { 
          sent, 
          errors, 
          total: filtered.length,
          status: sent + errors === filtered.length ? 'finished' : 'processing'
        });
      }

      // Delay de segurança anti-ban
      await new Promise(r => setTimeout(r, delay));
    }
  })();
}

module.exports = { sendBulk, setIo };
