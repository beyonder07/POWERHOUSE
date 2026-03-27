const DEFAULT_MAX_SKEW_MINUTES = 5;
const TIME_SOURCES = [
  'https://www.google.com/generate_204',
  'https://www.microsoft.com'
];

async function getServerTimeMs(url) {
  const response = await fetch(url, {
    method: 'HEAD',
    cache: 'no-store'
  });

  const dateHeader = response.headers.get('date');
  if (!dateHeader) {
    throw new Error('Missing Date header');
  }

  const timeMs = Date.parse(dateHeader);
  if (!Number.isFinite(timeMs)) {
    throw new Error('Invalid Date header');
  }

  return timeMs;
}

let cachedClockSkewMs = 0;
let isClockHealthy = true;

async function checkClockHealth(options = {}) {
  const maxSkewMinutes = Math.max(1, Number(options.maxSkewMinutes || DEFAULT_MAX_SKEW_MINUTES));
  const maxSkewMs = maxSkewMinutes * 60 * 1000;
  const localTimeMs = Date.now();

  let serverTimeMs = null;
  let usedSource = null;
  let lastError = null;

  for (const source of TIME_SOURCES) {
    try {
      serverTimeMs = await getServerTimeMs(source);
      usedSource = source;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!Number.isFinite(serverTimeMs)) {
    return {
      ok: true,
      skipped: true,
      reason: 'time-source-unreachable',
      source: usedSource,
      skewMs: null,
      maxSkewMs,
      localTimeIso: new Date(localTimeMs).toISOString(),
      serverTimeIso: null,
      error: lastError instanceof Error ? lastError.message : 'Failed to fetch server time'
    };
  }

  const skewMs = localTimeMs - serverTimeMs;
  cachedClockSkewMs = skewMs;
  isClockHealthy = Math.abs(skewMs) <= maxSkewMs;

  return {
    ok: isClockHealthy,
    skipped: false,
    source: usedSource,
    skewMs,
    maxSkewMs,
    localTimeIso: new Date(localTimeMs).toISOString(),
    serverTimeIso: new Date(serverTimeMs).toISOString(),
    error: null
  };
}

function startClockMonitor() {
  void checkClockHealth();
  setInterval(() => {
    void checkClockHealth();
  }, 15 * 60 * 1000); // Check every 15 minutes
}

function requireTimeGuard() {
  if (!isClockHealthy) {
    throw new Error(`System clock is severely out of sync (drift: ${Math.round(cachedClockSkewMs / 1000)}s). Fix OS time before performing financial or attendance actions.`);
  }
}

module.exports = {
  checkClockHealth,
  startClockMonitor,
  requireTimeGuard,
  DEFAULT_MAX_SKEW_MINUTES
};
