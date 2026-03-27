const crypto = require('node:crypto');

const DEFAULT_MAX_SKEW_SECONDS = 300;

function computeSyncSignature(secret, timestamp, idempotencyKey, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${idempotencyKey}.${rawBody}`)
    .digest('hex');
}

function safeHexEqual(leftHex, rightHex) {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(leftHex, 'hex'),
      Buffer.from(rightHex, 'hex')
    );
  } catch (_error) {
    return false;
  }
}

function verifySyncSecurity(payload) {
  const secret = String(payload.secret || '');
  const timestampHeader = String(payload.timestampHeader || '').trim();
  const signatureHeader = String(payload.signatureHeader || '').trim();
  const idempotencyKey = String(payload.idempotencyKey || '').trim();
  const rawBody = typeof payload.rawBody === 'string' ? payload.rawBody : '';
  const nowEpochSeconds = Number.isFinite(payload.nowEpochSeconds)
    ? Number(payload.nowEpochSeconds)
    : Math.floor(Date.now() / 1000);
  const maxSkewSeconds = Number.isFinite(payload.maxSkewSeconds)
    ? Math.max(1, Math.floor(payload.maxSkewSeconds))
    : DEFAULT_MAX_SKEW_SECONDS;

  if (!secret) {
    return { ok: false, error: 'missing-secret' };
  }
  if (!timestampHeader || !signatureHeader || !idempotencyKey) {
    return { ok: false, error: 'missing-headers' };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, error: 'invalid-timestamp' };
  }
  if (Math.abs(nowEpochSeconds - timestamp) > maxSkewSeconds) {
    return { ok: false, error: 'timestamp-skew' };
  }

  const expected = computeSyncSignature(secret, timestampHeader, idempotencyKey, rawBody);
  if (!safeHexEqual(signatureHeader, expected)) {
    return { ok: false, error: 'invalid-signature' };
  }

  return { ok: true, error: null };
}

module.exports = {
  computeSyncSignature,
  verifySyncSecurity,
  DEFAULT_MAX_SKEW_SECONDS
};
