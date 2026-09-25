function normalizeExternalSource(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

const LCD_OFFICIAL_SOURCES = Object.freeze([
  'LCDDIGITALWEB',
  'lcd_digital_web',
  'lcd-digital-web',
  'ilux_web',
  'ilux-web',
  'iluxweb',
]);

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
  LCD_OFFICIAL_SOURCES,
  normalizeExternalSource,
  isLcdOfficialEquipmentSource,
  isLcdOfficialServiceOrderSource,
};
