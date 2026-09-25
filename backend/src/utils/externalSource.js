function normalizeExternalSource(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isLcdOfficialEquipmentSource(value) {
  const source = normalizeExternalSource(value);
  return source === 'lcddigitalweb'
    || source === 'lcd_digital_web'
    || source === 'ilux_web'
    || source === 'iluxweb';
}

function isLcdOfficialServiceOrderSource(value) {
  const source = normalizeExternalSource(value);
  return source === 'lcddigitalweb'
    || source === 'lcd_digital_web'
    || source === 'ilux_web'
    || source === 'iluxweb';
}

module.exports = {
  normalizeExternalSource,
  isLcdOfficialEquipmentSource,
  isLcdOfficialServiceOrderSource,
};
