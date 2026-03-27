function isCooldownActive(pausedUntil, nowMs = Date.now()) {
  if (!pausedUntil) {
    return false;
  }

  const pausedUntilMs = new Date(pausedUntil).getTime();
  if (!Number.isFinite(pausedUntilMs)) {
    return false;
  }

  return pausedUntilMs > nowMs;
}

function nextCircuitBreakerState(current, summary, nowMs = Date.now()) {
  const threshold = Math.max(1, Number(current.threshold || 1));
  const cooldownMinutes = Math.max(1, Number(current.cooldownMinutes || 30));
  const failureStreak = Math.max(0, Number(current.failureStreak || 0));
  const pausedUntil = current.pausedUntil || null;

  if (!summary || Number(summary.attempted || 0) <= 0) {
    return { failureStreak, pausedUntil, tripped: false };
  }

  if (Number(summary.succeeded || 0) > 0) {
    return { failureStreak: 0, pausedUntil: null, tripped: false };
  }

  if (Number(summary.failed || 0) > 0) {
    const nextFailureStreak = failureStreak + 1;
    if (nextFailureStreak >= threshold) {
      const nextPausedUntil = new Date(nowMs + cooldownMinutes * 60 * 1000).toISOString();
      return {
        failureStreak: 0,
        pausedUntil: nextPausedUntil,
        tripped: true
      };
    }

    return {
      failureStreak: nextFailureStreak,
      pausedUntil,
      tripped: false
    };
  }

  return { failureStreak, pausedUntil, tripped: false };
}

module.exports = {
  isCooldownActive,
  nextCircuitBreakerState
};
