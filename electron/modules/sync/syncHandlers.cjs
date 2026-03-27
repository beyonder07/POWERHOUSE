const {
  runSyncPush,
  getSyncStatus,
  getSyncLogs,
  getOutboxItems,
  retryFailedOutbox,
  retryOutboxItem,
  buildSyncPayload
} = require('./syncService.cjs');
const { getSyncSettings } = require('../shared/settings.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const listLimitSchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
}).optional();

const retryItemSchema = z.object({
  id: z.number().int().positive()
});

function scheduleSyncRunner(dbManager, logger = console) {
  let lastRunAt = 0;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) {
      return;
    }
    inFlight = true;

    const settings = getSyncSettings(dbManager);
    if (!settings.enabled) {
      inFlight = false;
      return;
    }

    const intervalMs = settings.intervalMinutes * 60 * 1000;
    const now = Date.now();

    try {
      // Always drain queued retries every minute.
      const retryDrain = await runSyncPush(dbManager, { enqueueFresh: false });
      if (!retryDrain.skipped) {
        logger.info('[sync] retry-drain result:', retryDrain);
      }

      if (!lastRunAt || now - lastRunAt >= intervalMs) {
        const scheduledRun = await runSyncPush(dbManager, { enqueueFresh: true });
        logger.info('[sync] scheduled run result:', scheduledRun);
        lastRunAt = now;
      }
    } catch (error) {
      logger.error('[sync] scheduled run failed:', error);
    } finally {
      inFlight = false;
    }
  };

  // Run immediately on startup to catch up missed scheduled pushes and retry due outbox items.
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, 60 * 1000);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

function registerSyncHandlers(ipcMain, dbManager) {
  ipcMain.handle('sync:status', () => {
    return getSyncStatus(dbManager);
  });

  registerValidatedHandler(ipcMain, 'sync:logs', listLimitSchema, (_event, payload) => {
    const limit = payload && typeof payload.limit === 'number' ? Math.max(1, Math.min(500, Math.floor(payload.limit))) : 100;
    return getSyncLogs(dbManager, limit);
  });

  registerValidatedHandler(ipcMain, 'sync:outbox', listLimitSchema, (_event, payload) => {
    const limit = payload && typeof payload.limit === 'number' ? Math.max(1, Math.min(500, Math.floor(payload.limit))) : 100;
    return getOutboxItems(dbManager, limit);
  });

  registerValidatedHandler(ipcMain, 'sync:retry-failed', listLimitSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    const limit = payload && typeof payload.limit === 'number' ? Math.max(1, Math.min(500, Math.floor(payload.limit))) : 50;
    return retryFailedOutbox(dbManager, limit);
  });

  registerValidatedHandler(ipcMain, 'sync:retry-item', retryItemSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    return retryOutboxItem(dbManager, payload.id);
  });

  ipcMain.handle('sync:preview', async () => {
    const settings = getSyncSettings(dbManager);
    return buildSyncPayload(dbManager, settings);
  });

  ipcMain.handle('sync:run-now', async () => {
    requireUnlocked(dbManager);
    return runSyncPush(dbManager, { enqueueFresh: true, ignoreCooldown: true });
  });
}

module.exports = {
  registerSyncHandlers,
  scheduleSyncRunner
};
