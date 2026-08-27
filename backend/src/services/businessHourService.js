const prisma = require('../lib/prisma');

const BUSINESS_HOURS_TIMEZONE = process.env.BUSINESS_HOURS_TZ || process.env.APP_TIMEZONE || 'America/Sao_Paulo';

function getLocalBusinessClock(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_HOURS_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekday = parts.find(part => part.type === 'weekday')?.value;
  const hour = parts.find(part => part.type === 'hour')?.value || '00';
  const minute = parts.find(part => part.type === 'minute')?.value || '00';

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    dayOfWeek: weekdayMap[weekday],
    currentTime: `${hour}:${minute}`,
    timezone: BUSINESS_HOURS_TIMEZONE,
  };
}

function getZonedParts(date, timezone = BUSINESS_HOURS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function timezoneOffsetMs(date, timezone = BUSINESS_HOURS_TIMEZONE) {
  const parts = getZonedParts(date, timezone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - date.getTime();
}

function zonedDateTimeToUtc(year, month, day, hour, minute, timezone = BUSINESS_HOURS_TIMEZONE) {
  const expectedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = new Date(expectedUtc);
  // Two passes also cover daylight-saving transitions in timezones that use them.
  for (let pass = 0; pass < 2; pass += 1) {
    result = new Date(expectedUtc - timezoneOffsetMs(result, timezone));
  }
  return result;
}

function parseClock(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function calculateBusinessMinutesBetween(startValue, endValue, hours = [], timezone = BUSINESS_HOURS_TIMEZONE) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0;

  const byDay = new Map(hours.map((row) => [Number(row.dayOfWeek), row]));
  const localStart = getZonedParts(start, timezone);
  const localEnd = getZonedParts(end, timezone);
  let cursor = new Date(Date.UTC(localStart.year, localStart.month - 1, localStart.day));
  const last = Date.UTC(localEnd.year, localEnd.month - 1, localEnd.day);
  let totalMs = 0;

  while (cursor.getTime() <= last) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    const schedule = byDay.get(cursor.getUTCDay());
    const open = schedule?.active ? parseClock(schedule.start) : null;
    const close = schedule?.active ? parseClock(schedule.end) : null;
    if (open && close) {
      const openAt = zonedDateTimeToUtc(year, month, day, open.hour, open.minute, timezone);
      const closeAt = zonedDateTimeToUtc(year, month, day, close.hour, close.minute, timezone);
      const overlapStart = Math.max(start.getTime(), openAt.getTime());
      const overlapEnd = Math.min(end.getTime(), closeAt.getTime());
      if (overlapEnd > overlapStart) totalMs += overlapEnd - overlapStart;
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }

  return Math.round(totalMs / 60000);
}

async function isWithinBusinessHours(tenantId) {
  const { dayOfWeek, currentTime, timezone } = getLocalBusinessClock();

  const hours = await prisma.businessHour.findUnique({
    where: {
      tenantId_dayOfWeek: { tenantId, dayOfWeek }
    }
  });

  // Sem configuração para o dia: mantém aberto por compatibilidade.
  if (!hours) return true;

  // Dia desativado significa fechado.
  if (!hours.active) return false;

  const isOpen = currentTime >= hours.start && currentTime <= hours.end;

  console.log(`[businessHours] tenant=${tenantId} tz=${timezone} day=${dayOfWeek} now=${currentTime} range=${hours.start}-${hours.end} open=${isOpen}`);

  return isOpen;
}

module.exports = {
  BUSINESS_HOURS_TIMEZONE,
  calculateBusinessMinutesBetween,
  getLocalBusinessClock,
  isWithinBusinessHours,
};
