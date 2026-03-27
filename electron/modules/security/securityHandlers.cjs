const { hashPin, verifyPinHash, isValidPin } = require('../shared/pinSecurity.cjs');
const {
  getSetting,
  setSetting,
  getAllSettingsSummary,
  setLateFeeSettings,
  setBackupRetentionCount,
  setBackupOffsitePath,
  setLockTimeoutMinutes,
  setNotificationSettings,
  setSyncSettings
} = require('../shared/settings.cjs');
const {
  lockSession,
  unlockSession,
  getSessionStatus,
  touchActivity,
  isPinConfigured,
  requireUnlocked
} = require('./sessionGuard.cjs');
const { writeAuditLog } = require('../shared/auditLog.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const setupPinSchema = z.object({
  pin: z.string().min(4).max(8)
});

const verifyPinSchema = z.object({
  pin: z.string().min(1)
});

const changePinSchema = z.object({
  currentPin: z.string().min(1),
  newPin: z.string().min(4).max(8)
});

const settingsUpdateSchema = z.object({
  lateFee: z.object({
    enabled: z.boolean().optional(),
    graceDays: z.number().optional(),
    perDay: z.number().optional(),
    maxFee: z.number().optional()
  }).optional(),
  backupKeepLast: z.number().optional(),
  backupOffsitePath: z.string().optional(),
  lockTimeoutMinutes: z.number().optional(),
  notifications: z.object({
    enabled: z.boolean().optional(),
    expiryDaysBefore: z.number().optional(),
    channel: z.enum(['whatsapp', 'sms']).optional(),
    dispatchMode: z.enum(['desktop', 'cloud']).optional()
  }).optional(),
  sync: z.object({
    enabled: z.boolean().optional(),
    cloudUrl: z.string().optional(),
    apiToken: z.string().optional(),
    hmacSecret: z.string().optional(),
    clearApiToken: z.boolean().optional(),
    clearHmacSecret: z.boolean().optional(),
    intervalMinutes: z.number().optional(),
    maskPhone: z.boolean().optional(),
    circuitBreaker: z.object({
      threshold: z.number().optional(),
      cooldownMinutes: z.number().optional()
    }).optional()
  }).optional(),
  syncRetry: z.object({
    maxAttempts: z.number().optional(),
    baseDelaySeconds: z.number().optional()
  }).optional()
});

function registerSecurityHandlers(ipcMain, dbManager) {
  ipcMain.handle('security:status', () => {
    return getSessionStatus(dbManager);
  });

  registerValidatedHandler(ipcMain, 'security:setup-pin', setupPinSchema, (_event, payload) => {
    if (!isValidPin(payload.pin)) {
      throw new Error('PIN must be 4 to 8 digits');
    }

    if (isPinConfigured(dbManager)) {
      throw new Error('PIN already configured. Use change PIN instead.');
    }

    setSetting(dbManager, 'app_pin_hash', hashPin(payload.pin));
    unlockSession();

    writeAuditLog(dbManager, {
      action: 'security.pin.created',
      entity: 'security'
    });

    return getSessionStatus(dbManager);
  });

  registerValidatedHandler(ipcMain, 'security:verify-pin', verifyPinSchema, (_event, payload) => {
    const pinHash = getSetting(dbManager, 'app_pin_hash', '');
    if (!pinHash) {
      return { ok: true, ...getSessionStatus(dbManager) };
    }

    const ok = verifyPinHash(payload.pin, pinHash);
    if (!ok) {
      return { ok: false, message: 'Invalid PIN' };
    }

    unlockSession();
    touchActivity();

    return { ok: true, ...getSessionStatus(dbManager) };
  });

  registerValidatedHandler(ipcMain, 'security:change-pin', changePinSchema, (_event, payload) => {
    if (!isValidPin(payload.newPin)) {
      throw new Error('Provide current PIN and new 4-8 digit PIN');
    }

    const pinHash = getSetting(dbManager, 'app_pin_hash', '');
    if (!pinHash) {
      throw new Error('PIN not configured');
    }

    if (!verifyPinHash(payload.currentPin, pinHash)) {
      throw new Error('Current PIN is incorrect');
    }

    setSetting(dbManager, 'app_pin_hash', hashPin(payload.newPin));
    unlockSession();

    writeAuditLog(dbManager, {
      action: 'security.pin.changed',
      entity: 'security'
    });

    return { ok: true };
  });

  ipcMain.handle('security:lock', () => {
    lockSession();
    return getSessionStatus(dbManager);
  });

  ipcMain.handle('settings:get', () => {
    return {
      ...getAllSettingsSummary(dbManager),
      security: getSessionStatus(dbManager)
    };
  });

  registerValidatedHandler(ipcMain, 'settings:update', settingsUpdateSchema, (_event, payload) => {
    requireUnlocked(dbManager);

    let lateFee = null;
    let backupKeepLast = null;
    let backupOffsitePath = null;
    let lockTimeoutMinutes = null;
    let notifications = null;
    let sync = null;
    let syncRetry = null;

    if (payload.lateFee) {
      lateFee = setLateFeeSettings(dbManager, payload.lateFee);
    }

    if (payload.backupKeepLast !== undefined) {
      backupKeepLast = setBackupRetentionCount(dbManager, payload.backupKeepLast);
    }
    if (payload.backupOffsitePath !== undefined) {
      backupOffsitePath = setBackupOffsitePath(dbManager, payload.backupOffsitePath);
    }

    if (payload.lockTimeoutMinutes !== undefined) {
      lockTimeoutMinutes = setLockTimeoutMinutes(dbManager, payload.lockTimeoutMinutes);
    }

    if (payload.notifications) {
      notifications = setNotificationSettings(dbManager, payload.notifications);
    }

    if (payload.sync) {
      sync = setSyncSettings(dbManager, payload.sync);
    }

    if (payload.syncRetry) {
      if (payload.syncRetry.maxAttempts !== undefined) {
        setSetting(dbManager, 'sync_retry_max_attempts', String(Math.max(1, Math.floor(Number(payload.syncRetry.maxAttempts || 1)))));
      }
      if (payload.syncRetry.baseDelaySeconds !== undefined) {
        setSetting(dbManager, 'sync_retry_base_delay_seconds', String(Math.max(5, Math.floor(Number(payload.syncRetry.baseDelaySeconds || 5)))));
      }
      syncRetry = payload.syncRetry;
    }

    writeAuditLog(dbManager, {
      action: 'settings.updated',
      entity: 'settings',
      details: {
        lateFee,
        backupKeepLast,
        backupOffsitePath,
        lockTimeoutMinutes,
        notifications,
        sync,
        syncRetry
      }
    });

    return {
      ...getAllSettingsSummary(dbManager),
      security: getSessionStatus(dbManager)
    };
  });
}

module.exports = { registerSecurityHandlers };
