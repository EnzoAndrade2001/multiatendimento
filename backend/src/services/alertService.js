const prisma = require('../lib/prisma');
const evolution = require('./evolutionService');

/**
 * Envia um alerta via WhatsApp para o administrador do Tenant
 * @param {string} tenantId - ID da empresa
 * @param {string} message - Conteúdo do alerta
 */
async function sendSystemAlert(tenantId, message) {
  try {
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings?.notificationPhone || !settings?.evolutionUrl || !settings?.evolutionKey) {
      console.log(`[alertService] Alerta ignorado para tenant=${tenantId}: Configurações incompletas.`);
      return;
    }

    // Busca qualquer instância conectada para disparar o alerta
    const instance = await prisma.waInstance.findFirst({
      where: { tenantId, status: 'connected' }
    });

    if (!instance) {
      console.log(`[alertService] Alerta não enviado para tenant=${tenantId}: Nenhuma instância conectada.`);
      return;
    }

    const formattedPhone = settings.notificationPhone.replace(/\D/g, '');
    
    await evolution.sendText(
      settings.evolutionUrl,
      settings.evolutionKey,
      instance.instanceName,
      formattedPhone,
      `⚠️ *ALERTA DO SISTEMA - MULTIATENDIMENTO PRO*\n\n${message}`
    );
    
      console.log(`[alertService] Alerta enviado para ${require('../utils/privacy').maskPhone(formattedPhone)}`);
  } catch (err) {
    console.error('[alertService] erro fatal ao enviar alerta:', err.message);
  }
}

module.exports = { sendSystemAlert };
