const buckets = new Map();

function now() {
  return Date.now();
}

function cleanupBucket(key, windowMs) {
  const bucket = buckets.get(key);
  if (!bucket) {
    return null;
  }

  if (bucket.resetAt <= now()) {
    buckets.delete(key);
    return null;
  }

  return bucket;
}

function createRateLimiter({ windowMs, max, keyPrefix, keyFn }) {
  return (req, res, next) => {
    const subjectKey = typeof keyFn === 'function'
      ? keyFn(req)
      : req.ip || 'unknown';
    const fullKey = `${keyPrefix}:${subjectKey}`;
    const current = cleanupBucket(fullKey, windowMs);

    if (!current) {
      buckets.set(fullKey, {
        count: 1,
        resetAt: now() + windowMs
      });
      return next();
    }

    if (current.count >= max) {
      return res.status(429).json({
        error: 'Too many attempts. Please wait a moment and try again.'
      });
    }

    current.count += 1;
    return next();
  };
}

module.exports = { createRateLimiter };
