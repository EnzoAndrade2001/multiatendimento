'use strict';

const pending = new WeakMap();
const delays = [15000, 30000, 60000, 120000, 240000, 300000];

function reset(channel) {
  const state = pending.get(channel);
  if (state?.timer) clearTimeout(state.timer);
  pending.delete(channel);
}

async function handle(channel, schedule = setTimeout) {
  let state = pending.get(channel);
  if (!state) { state = { attempts: 0, timer: null }; pending.set(channel, state); }
  if (state.timer || channel.isDeleting || channel.endSession) return;
  const exhausted = state.attempts >= delays.length;
  await channel.prismaRepository.instance.update({
    where: { id: channel.instanceId },
    data: { connectionStatus: 'close', disconnectionReasonCode: 408, disconnectionAt: new Date() },
  });
  channel.sendDataWebhook('connection.update', {
    instance: channel.instance.name, state: 'close', statusReason: 408,
    recovery: exhausted ? 'exhausted' : 'retrying', credentialsPreserved: true,
  });
  if (exhausted) {
    channel.logger.warn('408 recovery exhausted: credentials preserved; operator review required');
    return;
  }
  const delay = delays[state.attempts++];
  channel.logger.warn(`408 recovery: attempt ${state.attempts}/${delays.length} in ${delay}ms; credentials preserved`);
  state.timer = schedule(async () => {
    state.timer = null;
    if (channel.isDeleting || channel.endSession || pending.get(channel) !== state) return;
    try { await channel.connectToWhatsapp(channel.phoneNumber); }
    catch (error) {
      channel.logger.warn('408 reconnect failed; scheduling bounded retry');
      await handle(channel, schedule).catch(() => channel.logger.warn('408 recovery persistence failed'));
    }
  }, delay);
}

module.exports = { handle, reset };
