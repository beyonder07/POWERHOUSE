function normalizeText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function isValidPhone(value) {
  return /^\+?[0-9]{10,15}$/.test(value);
}

function isValidPositiveAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

module.exports = {
  normalizeText,
  normalizePhone,
  isValidPhone,
  isValidPositiveAmount
};
