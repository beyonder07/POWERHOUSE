const SECRET_PREFIX = 'enc:v1:';

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getSafeStorage() {
  try {
    const { safeStorage } = require('electron');
    return safeStorage;
  } catch (_error) {
    return null;
  }
}

function canEncryptSecrets() {
  const safeStorage = getSafeStorage();
  return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
}

function encryptSecret(plainText) {
  const value = String(plainText || '');
  if (!value) {
    return '';
  }
  if (value.startsWith(SECRET_PREFIX)) {
    return value;
  }

  if (!canEncryptSecrets()) {
    throw new Error('OS secure storage is unavailable. Cannot persist secrets safely.');
  }
  const safeStorage = getSafeStorage();

  const encrypted = safeStorage.encryptString(value).toString('base64');
  return `${SECRET_PREFIX}${encrypted}`;
}

function decryptSecret(storedValue) {
  const value = String(storedValue || '');
  if (!value) {
    return '';
  }
  if (!value.startsWith(SECRET_PREFIX)) {
    return value;
  }

  const safeStorage = getSafeStorage();
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    return '';
  }

  try {
    const encrypted = value.slice(SECRET_PREFIX.length);
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch (_error) {
    return '';
  }
}

function getSetting(dbManager, key, fallback = null) {
  const db = dbManager.getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row || row.value === null || row.value === undefined) {
    return fallback;
  }

  return row.value;
}

function setSetting(dbManager, key, value) {
  const db = dbManager.getDb();
  db.prepare(`
    INSERT INTO settings(key, value, updated_at)
    VALUES(@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run({ key, value: String(value) });
}

function readSecretSetting(dbManager, key) {
  const stored = getSetting(dbManager, key, '');
  const secret = decryptSecret(stored);

  // Migrate legacy plaintext to encrypted-at-rest where platform crypto is available.
  if (stored && !stored.startsWith(SECRET_PREFIX) && canEncryptSecrets()) {
    try {
      const encrypted = encryptSecret(secret);
      if (encrypted !== stored) {
        setSetting(dbManager, key, encrypted);
      }
    } catch (_error) {
      // Keep legacy plaintext value readable if migration cannot complete right now.
    }
  }

  return secret;
}

function getLateFeeSettings(dbManager) {
  return {
    enabled: getSetting(dbManager, 'late_fee_enabled', '1') === '1',
    graceDays: Math.max(0, Math.floor(toNumber(getSetting(dbManager, 'late_fee_grace_days', '3'), 3))),
    perDay: Math.max(0, toNumber(getSetting(dbManager, 'late_fee_per_day', '20'), 20)),
    maxFee: Math.max(0, toNumber(getSetting(dbManager, 'late_fee_max', '1000'), 1000))
  };
}

function setLateFeeSettings(dbManager, payload) {
  const current = getLateFeeSettings(dbManager);

  const enabled = payload.enabled === undefined ? (current.enabled ? '1' : '0') : (payload.enabled ? '1' : '0');
  const graceDays = payload.graceDays === undefined
    ? current.graceDays
    : Math.max(0, Math.floor(Number(payload.graceDays || 0)));
  const perDay = payload.perDay === undefined
    ? current.perDay
    : Math.max(0, Number(payload.perDay || 0));
  const maxFee = payload.maxFee === undefined
    ? current.maxFee
    : Math.max(0, Number(payload.maxFee || 0));

  setSetting(dbManager, 'late_fee_enabled', enabled);
  setSetting(dbManager, 'late_fee_grace_days', String(graceDays));
  setSetting(dbManager, 'late_fee_per_day', String(perDay));
  setSetting(dbManager, 'late_fee_max', String(maxFee));

  return {
    enabled: enabled === '1',
    graceDays,
    perDay,
    maxFee
  };
}

function getBackupRetentionCount(dbManager) {
  const value = toNumber(getSetting(dbManager, 'backup_keep_last', '14'), 14);
  return Math.max(1, Math.floor(value));
}

function getBackupOffsitePath(dbManager) {
  return String(getSetting(dbManager, 'backup_offsite_path', '') || '');
}

function setBackupRetentionCount(dbManager, keepLast) {
  const safe = Math.max(1, Math.floor(Number(keepLast || 1)));
  setSetting(dbManager, 'backup_keep_last', String(safe));
  return safe;
}

function setBackupOffsitePath(dbManager, offsitePath) {
  const safePath = String(offsitePath || '').trim();
  setSetting(dbManager, 'backup_offsite_path', safePath);
  return safePath;
}

function getLockTimeoutMinutes(dbManager) {
  const raw = toNumber(getSetting(dbManager, 'lock_timeout_minutes', '15'), 15);
  return Math.max(1, Math.floor(raw));
}

function setLockTimeoutMinutes(dbManager, minutes) {
  const safe = Math.max(1, Math.floor(Number(minutes || 1)));
  setSetting(dbManager, 'lock_timeout_minutes', String(safe));
  return safe;
}

function getNotificationSettings(dbManager) {
  const dispatchModeRaw = String(getSetting(dbManager, 'notification_dispatch_mode', 'desktop') || 'desktop').toLowerCase();
  const dispatchMode = dispatchModeRaw === 'cloud' ? 'cloud' : 'desktop';

  return {
    enabled: getSetting(dbManager, 'notification_enabled', '1') === '1',
    expiryDaysBefore: Math.max(1, Math.floor(toNumber(getSetting(dbManager, 'notification_expiry_days_before', '3'), 3))),
    channel: getSetting(dbManager, 'notification_channel', 'whatsapp') === 'sms' ? 'sms' : 'whatsapp',
    dispatchMode
  };
}

function setNotificationSettings(dbManager, payload) {
  const current = getNotificationSettings(dbManager);
  const enabled = payload.enabled === undefined ? (current.enabled ? '1' : '0') : (payload.enabled ? '1' : '0');
  const expiryDaysBefore = payload.expiryDaysBefore === undefined
    ? current.expiryDaysBefore
    : Math.max(1, Math.floor(Number(payload.expiryDaysBefore || 1)));
  const requestedChannel = payload.channel || current.channel;
  const channel = requestedChannel === 'sms' ? 'sms' : 'whatsapp';
  const requestedMode = payload.dispatchMode || current.dispatchMode;
  const dispatchMode = requestedMode === 'cloud' ? 'cloud' : 'desktop';

  setSetting(dbManager, 'notification_enabled', enabled);
  setSetting(dbManager, 'notification_expiry_days_before', String(expiryDaysBefore));
  setSetting(dbManager, 'notification_channel', channel);
  setSetting(dbManager, 'notification_dispatch_mode', dispatchMode);

  return {
    enabled: enabled === '1',
    expiryDaysBefore,
    channel,
    dispatchMode
  };
}

function getSyncSettings(dbManager) {
  const lastSuccessAtRaw = getSetting(dbManager, 'sync_last_success_at', null);
  const apiToken = readSecretSetting(dbManager, 'sync_api_token');
  const hmacSecret = readSecretSetting(dbManager, 'sync_hmac_secret');

  const circuitBreaker = {
    threshold: Math.max(1, Math.floor(toNumber(getSetting(dbManager, 'sync_circuit_breaker_threshold', '5'), 5))),
    cooldownMinutes: Math.max(1, Math.floor(toNumber(getSetting(dbManager, 'sync_circuit_breaker_cooldown_minutes', '30'), 30))),
    failureStreak: Math.max(0, Math.floor(toNumber(getSetting(dbManager, 'sync_circuit_breaker_failure_streak', '0'), 0))),
    pausedUntil: getSetting(dbManager, 'sync_circuit_breaker_paused_until', '') || null
  };

  return {
    enabled: getSetting(dbManager, 'sync_enabled', '0') === '1',
    cloudUrl: getSetting(dbManager, 'sync_cloud_url', ''),
    apiToken,
    hmacSecret,
    intervalMinutes: Math.max(5, Math.floor(toNumber(getSetting(dbManager, 'sync_interval_minutes', '60'), 60))),
    maskPhone: getSetting(dbManager, 'sync_mask_phone', '1') === '1',
    lastSuccessAt: lastSuccessAtRaw || null,
    incrementalCursor: getSetting(dbManager, 'sync_incremental_cursor', '') || null,
    circuitBreaker
  };
}

function setSyncSettings(dbManager, payload) {
  const current = getSyncSettings(dbManager);
  const enabled = payload.enabled === undefined ? (current.enabled ? '1' : '0') : (payload.enabled ? '1' : '0');
  const cloudUrl = payload.cloudUrl === undefined ? current.cloudUrl : String(payload.cloudUrl || '').trim();
  const providedApiToken = payload.apiToken === undefined ? undefined : String(payload.apiToken || '').trim();
  const providedHmacSecret = payload.hmacSecret === undefined ? undefined : String(payload.hmacSecret || '').trim();
  const apiToken = payload.clearApiToken
    ? ''
    : (providedApiToken && providedApiToken.length > 0 ? providedApiToken : current.apiToken);
  const hmacSecret = payload.clearHmacSecret
    ? ''
    : (providedHmacSecret && providedHmacSecret.length > 0 ? providedHmacSecret : current.hmacSecret);
  const intervalMinutes = payload.intervalMinutes === undefined
    ? current.intervalMinutes
    : Math.max(5, Math.floor(Number(payload.intervalMinutes || 60)));
  const maskPhone = payload.maskPhone === undefined ? (current.maskPhone ? '1' : '0') : (payload.maskPhone ? '1' : '0');
  const threshold = payload.circuitBreaker && payload.circuitBreaker.threshold !== undefined
    ? Math.max(1, Math.floor(Number(payload.circuitBreaker.threshold || 1)))
    : current.circuitBreaker.threshold;
  const cooldownMinutes = payload.circuitBreaker && payload.circuitBreaker.cooldownMinutes !== undefined
    ? Math.max(1, Math.floor(Number(payload.circuitBreaker.cooldownMinutes || 1)))
    : current.circuitBreaker.cooldownMinutes;

  setSetting(dbManager, 'sync_enabled', enabled);
  setSetting(dbManager, 'sync_cloud_url', cloudUrl);
  setSetting(dbManager, 'sync_api_token', encryptSecret(apiToken));
  setSetting(dbManager, 'sync_hmac_secret', encryptSecret(hmacSecret));
  setSetting(dbManager, 'sync_interval_minutes', String(intervalMinutes));
  setSetting(dbManager, 'sync_mask_phone', maskPhone);
  setSetting(dbManager, 'sync_circuit_breaker_threshold', String(threshold));
  setSetting(dbManager, 'sync_circuit_breaker_cooldown_minutes', String(cooldownMinutes));

  return getSyncSettingsForUi(dbManager);
}

function getSyncRetrySettings(dbManager) {
  return {
    maxAttempts: Math.max(1, Math.floor(toNumber(getSetting(dbManager, 'sync_retry_max_attempts', '5'), 5))),
    baseDelaySeconds: Math.max(5, Math.floor(toNumber(getSetting(dbManager, 'sync_retry_base_delay_seconds', '30'), 30)))
  };
}

function getAllSettingsSummary(dbManager) {
  const lateFee = getLateFeeSettings(dbManager);
  const backupKeepLast = getBackupRetentionCount(dbManager);
  const backupOffsitePath = getBackupOffsitePath(dbManager);
  const lockTimeoutMinutes = getLockTimeoutMinutes(dbManager);
  const notifications = getNotificationSettings(dbManager);
  const sync = getSyncSettingsForUi(dbManager);
  const syncRetry = getSyncRetrySettings(dbManager);

  return {
    lateFee,
    backupKeepLast,
    backupOffsitePath,
    lockTimeoutMinutes,
    notifications,
    sync,
    syncRetry
  };
}

function getSyncSettingsForUi(dbManager) {
  const sync = getSyncSettings(dbManager);
  return {
    ...sync,
    apiToken: '',
    hmacSecret: '',
    hasApiToken: Boolean(sync.apiToken),
    hasHmacSecret: Boolean(sync.hmacSecret)
  };
}

function setSyncCircuitBreakerState(dbManager, payload) {
  if (payload.failureStreak !== undefined) {
    const safeFailureStreak = Math.max(0, Math.floor(Number(payload.failureStreak || 0)));
    setSetting(dbManager, 'sync_circuit_breaker_failure_streak', String(safeFailureStreak));
  }
  if (payload.pausedUntil !== undefined) {
    const pausedUntilValue = payload.pausedUntil ? String(payload.pausedUntil) : '';
    setSetting(dbManager, 'sync_circuit_breaker_paused_until', pausedUntilValue);
  }
}

module.exports = {
  getSetting,
  setSetting,
  getLateFeeSettings,
  setLateFeeSettings,
  getBackupRetentionCount,
  setBackupRetentionCount,
  getBackupOffsitePath,
  setBackupOffsitePath,
  getLockTimeoutMinutes,
  setLockTimeoutMinutes,
  getNotificationSettings,
  setNotificationSettings,
  getSyncSettings,
  getSyncSettingsForUi,
  setSyncSettings,
  setSyncCircuitBreakerState,
  getSyncRetrySettings,
  getAllSettingsSummary
};
