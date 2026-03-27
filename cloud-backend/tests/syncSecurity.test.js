const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSyncSignature, verifySyncSecurity } = require('../src/lib/syncSecurity');

test('verifySyncSecurity accepts valid signature payload', () => {
  const secret = 'super-secret-key';
  const timestamp = '1710000000';
  const idempotencyKey = '2026-03-27-abc123';
  const rawBody = JSON.stringify({ hello: 'world' });
  const signature = computeSyncSignature(secret, timestamp, idempotencyKey, rawBody);

  const result = verifySyncSecurity({
    secret,
    timestampHeader: timestamp,
    signatureHeader: signature,
    idempotencyKey,
    rawBody,
    nowEpochSeconds: 1710000000
  });

  assert.equal(result.ok, true);
  assert.equal(result.error, null);
});

test('verifySyncSecurity rejects skewed timestamp', () => {
  const secret = 'super-secret-key';
  const timestamp = '1710000000';
  const idempotencyKey = '2026-03-27-abc123';
  const rawBody = JSON.stringify({ hello: 'world' });
  const signature = computeSyncSignature(secret, timestamp, idempotencyKey, rawBody);

  const result = verifySyncSecurity({
    secret,
    timestampHeader: timestamp,
    signatureHeader: signature,
    idempotencyKey,
    rawBody,
    nowEpochSeconds: 1710000900,
    maxSkewSeconds: 120
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'timestamp-skew');
});

test('verifySyncSecurity rejects tampered signature', () => {
  const result = verifySyncSecurity({
    secret: 'super-secret-key',
    timestampHeader: '1710000000',
    signatureHeader: 'abcdef1234',
    idempotencyKey: '2026-03-27-abc123',
    rawBody: JSON.stringify({ hello: 'world' }),
    nowEpochSeconds: 1710000000
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid-signature');
});
