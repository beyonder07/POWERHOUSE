const test = require('node:test');
const assert = require('node:assert/strict');
const { isCooldownActive, nextCircuitBreakerState } = require('../circuitBreaker.cjs');

test('isCooldownActive returns true while pausedUntil is in future', () => {
  const now = new Date('2026-03-27T10:00:00.000Z').getTime();
  const pausedUntil = '2026-03-27T10:05:00.000Z';
  assert.equal(isCooldownActive(pausedUntil, now), true);
});

test('nextCircuitBreakerState trips when failure threshold is reached', () => {
  const now = new Date('2026-03-27T10:00:00.000Z').getTime();
  const current = {
    threshold: 3,
    cooldownMinutes: 15,
    failureStreak: 2,
    pausedUntil: null
  };
  const summary = {
    attempted: 2,
    succeeded: 0,
    failed: 2
  };

  const next = nextCircuitBreakerState(current, summary, now);
  assert.equal(next.tripped, true);
  assert.equal(next.failureStreak, 0);
  assert.equal(typeof next.pausedUntil, 'string');
  assert.equal(isCooldownActive(next.pausedUntil, now), true);
});

test('nextCircuitBreakerState resets streak on success', () => {
  const current = {
    threshold: 3,
    cooldownMinutes: 15,
    failureStreak: 2,
    pausedUntil: '2026-03-27T10:05:00.000Z'
  };
  const summary = {
    attempted: 1,
    succeeded: 1,
    failed: 0
  };

  const next = nextCircuitBreakerState(current, summary);
  assert.equal(next.failureStreak, 0);
  assert.equal(next.pausedUntil, null);
});
