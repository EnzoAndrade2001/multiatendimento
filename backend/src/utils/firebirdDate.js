// O iLux/Firebird envia datas sem offset, representando o horario local da
// operacao. O servidor roda em UTC, portanto uma conversao direta com
// new Date("YYYY-MM-DDTHH:mm:ss") desloca o horario exibido no navegador.
const FIREBIRD_OFFSET = '-03:00';

function validDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function parseFirebirdDate(value, timeValue = null) {
  if (!value) return null;
  const existing = validDate(value);
  if (existing) return existing;

  const input = String(value).trim();
  if (!input) return null;

  const timeMatch = timeValue && String(timeValue).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const suppliedTime = timeMatch
    ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}:${timeMatch[3] || '00'}`
    : null;

  const brazilian = input.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (brazilian) {
    const [, dd, mm, yyyy, matchedHour, matchedMinute, matchedSecond] = brazilian;
    const [hh, mi, ss] = suppliedTime
      ? suppliedTime.split(':')
      : [matchedHour || '00', matchedMinute || '00', matchedSecond || '00'];
    const parsed = new Date(`${yyyy}-${mm}-${dd}T${hh.padStart(2, '0')}:${mi}:${ss}${FIREBIRD_OFFSET}`);
    return validDate(parsed);
  }

  const iso = input.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) {
    const [, day, matchedHour, matchedMinute, matchedSecond, fraction = '', offset] = iso;
    const [hh, mi, ss] = suppliedTime
      ? suppliedTime.split(':')
      : [matchedHour || '00', matchedMinute || '00', matchedSecond || '00'];
    const parsed = new Date(`${day}T${hh}:${mi}:${ss}${fraction || ''}${offset || FIREBIRD_OFFSET}`);
    return validDate(parsed);
  }

  const parsed = new Date(input);
  return validDate(parsed);
}

module.exports = { FIREBIRD_OFFSET, parseFirebirdDate };
