const crypto = require('node:crypto');

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPinHash(pin, serialized) {
  if (!serialized || typeof serialized !== 'string' || !serialized.includes(':')) {
    return false;
  }

  const [salt, expected] = serialized.split(':');
  if (!salt || !expected) {
    return false;
  }

  const actual = crypto.scryptSync(pin, salt, 64).toString('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

module.exports = {
  hashPin,
  verifyPinHash,
  isValidPin
};
