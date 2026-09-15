const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const evolution = require('../services/evolutionService');
const { processSingleMessage } = require('../controllers/webhookController');

async function main() {
  const args = process.argv.slice(2);
  const hoursArg = args.find(arg => arg.startsWith('--hours='));
  const instanceArg = args.find(arg => arg.startsWith('--instance='));

  const hours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 5;
  const instanceNameFilter = instanceArg ? instanceArg.split('=')[1] : null;

  console.log(`Iniciando sincronizacao de mensagens das ultimas ${hours} horas...`);

  const instances = await prisma.waInstance.findMany({
    where: instanceNameFilter ? { instanceName: instanceNameFilter } : {}
  });

  if (instances.length === 0) {
    console.log('Nenhuma instancia encontrada no banco de dados.');
    return;
  }

  for (const inst of instances) {
    console.log(`\nProcessando instancia: ${inst.instanceName}...`);
    
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: inst.tenantId }
    });

    const { evolutionUrl, evolutionKey } = evolution.resolveEvolutionConfig(settings, inst);

    if (!evolutionUrl || !evolutionKey) {
      console.log(`[Erro] URL ou Chave da Evolution nao configuradas para o tenant: ${inst.tenantId}`);
      continue;
    }

    try {
      const targetUrl = `${evolutionUrl}/chat/findChats/${inst.instanceName}`;
      console.log(`Buscando conversas em: ${targetUrl} (Chave: ${evolutionKey ? evolutionKey.slice(0, 5) + '...' : 'nula'})...`);
      const chats = await evolution.findChats(evolutionUrl, evolutionKey, inst.instanceName);
      
      if (!Array.isArray(chats) || chats.length === 0) {
        console.log('Nenhuma conversa encontrada na Evolution.');
        continue;
      }

      console.log(`Encontradas ${chats.length} conversas. Sincronizando mensagens...`);
      const maxAgeMs = hours * 60 * 60 * 1000;
      let importedCount = 0;

      for (const chat of chats) {
        const jid = chat.id || chat.jid;
        if (!jid) continue;

        try {
          const messages = await evolution.findMessages(evolutionUrl, evolutionKey, inst.instanceName, jid, 50);
          
          if (!Array.isArray(messages)) continue;

          for (const msg of messages) {
            const msgTimeSec = msg.messageTimestamp || msg.key?.messageTimestamp || null;
            const msgTimeMs = msgTimeSec ? (parseInt(msgTimeSec) * 1000) : Date.now();
            const ageMs = Date.now() - msgTimeMs;

            if (ageMs > maxAgeMs) {
              continue;
            }

            const externalId = msg.key?.id;
            if (!externalId) continue;

            const existing = await prisma.message.findFirst({
              where: { externalId }
            });

            if (!existing) {
              await processSingleMessage(msg, inst.instanceName, inst, { id: inst.tenantId, settings }, true);
              importedCount++;
            }
          }
        } catch (err) {
          console.error(`Erro ao sincronizar mensagens da conversa ${jid}:`, err.message);
        }
      }

      console.log(`Processamento concluido para ${inst.instanceName}. Importadas ${importedCount} mensagens.`);
    } catch (err) {
      console.error(`Erro ao processar a instancia ${inst.instanceName}:`, err.message);
      if (err.response?.data) {
        console.error('Detalhes do erro da Evolution:', JSON.stringify(err.response.data, null, 2));
      } else {
        console.error(err.stack || err);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
