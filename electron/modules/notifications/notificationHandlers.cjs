const { runNotificationSweep, listRecentNotificationLogs, getNotificationHealth } = require('./notificationService.cjs');
const { getNotificationSettings } = require('../shared/settings.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const logsSchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
}).optional();

function registerNotificationHandlers(ipcMain, dbManager) {
  ipcMain.handle('notifications:status', () => {
    return {
      settings: getNotificationSettings(dbManager),
      health: getNotificationHealth(dbManager),
      recent: listRecentNotificationLogs(dbManager, 20)
    };
  });

  registerValidatedHandler(ipcMain, 'notifications:logs', logsSchema, (_event, payload) => {
    const limit = payload && typeof payload.limit === 'number' ? Math.max(1, Math.min(500, Math.floor(payload.limit))) : 100;
    return listRecentNotificationLogs(dbManager, limit);
  });

  ipcMain.handle('notifications:run-now', async () => {
    requireUnlocked(dbManager);
    return runNotificationSweep(dbManager);
  });
}

module.exports = {
  registerNotificationHandlers
};
