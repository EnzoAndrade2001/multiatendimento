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
    const targetPhone = settings?.serviceOrderManagerPhone || settings?.notificationPhone;
    if (!targetPhone) {
      console.log(`[alertService] Alerta ignorado para tenant=${tenantId}: Configurações incompletas.`);
      return false;
    }

    // O Sentinela usa o mesmo destinatário e a mesma instância configurados
    // para cópias de O.S. O cadastro antigo de alertas permanece como fallback.
    const configuredInstance = settings.serviceOrderManagerInstanceId
      ? await prisma.waInstance.findFirst({
          where: { id: settings.serviceOrderManagerInstanceId, tenantId, status: 'connected' },
        })
      : null;
    const instance = configuredInstance || await prisma.waInstance.findFirst({
      where: { tenantId, status: 'connected' },
    });

    if (!instance) {
      console.log(`[alertService] Alerta não enviado para tenant=${tenantId}: Nenhuma instância conectada.`);
      return false;
    }

    const { evolutionUrl, evolutionKey } = evolution.resolveEvolutionConfig(settings, instance);
    if (!evolutionUrl || !evolutionKey) {
      console.log(`[alertService] Alerta ignorado para tenant=${tenantId}: Configurações incompletas.`);
      return false;
    }

    const formattedPhone = targetPhone.replace(/\D/g, '');

    await evolution.sendText(
      evolutionUrl,
      evolutionKey,
      instance.instanceName,
      formattedPhone,
      `⚠️ *ALERTA DO SISTEMA - MULTIATENDIMENTO PRO*\n\n${message}`
    );

      console.log(`[alertService] Alerta enviado para ${require('../utils/privacy').maskPhone(formattedPhone)}`);
    return true;
  } catch (err) {
    console.error('[alertService] erro fatal ao enviar alerta:', err.message);
    return false;
  }
}

module.exports = { sendSystemAlert };
