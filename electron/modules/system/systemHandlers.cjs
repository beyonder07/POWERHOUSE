const fs = require('node:fs');
const path = require('node:path');
const { shell } = require('electron');
const { checkClockHealth } = require('./clockHealth.cjs');
const { getSetting } = require('../shared/settings.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const openPathSchema = z.object({
  filePath: z.string().min(1)
});

function getSystemHealth(dbManager) {
  const db = dbManager.getDb();
  const failedSyncCount = db.prepare("SELECT COUNT(1) AS total FROM sync_logs WHERE status = 'failed'").get().total;
  const pendingOutbox = db.prepare("SELECT COUNT(1) AS total FROM sync_outbox WHERE status = 'pending'").get().total;
  const failedOutbox = db.prepare("SELECT COUNT(1) AS total FROM sync_outbox WHERE status = 'failed'").get().total;
  const notificationFailures = db.prepare("SELECT COUNT(1) AS total FROM notification_queue WHERE status = 'failed'").get().total;
  const notificationPending = db.prepare("SELECT COUNT(1) AS total FROM notification_queue WHERE status = 'pending'").get().total;
  const latestBackupJob = db.prepare(`
    SELECT status, details, error, created_at AS createdAt
    FROM job_logs
    WHERE job_name IN ('backup.daily', 'backup.manual')
    ORDER BY id DESC
    LIMIT 1
  `).get();

  return {
    lastSyncSuccessAt: getSetting(dbManager, 'sync_last_success_at', '') || null,
    failedSyncCount: Number(failedSyncCount || 0),
    outbox: {
      pending: Number(pendingOutbox || 0),
      failed: Number(failedOutbox || 0)
    },
    notifications: {
      pending: Number(notificationPending || 0),
      failed: Number(notificationFailures || 0)
    },
    lastBackup: latestBackupJob || null,
    encryption: dbManager.getEncryptionStatus ? dbManager.getEncryptionStatus() : { mode: 'unknown', ok: false }
  };
}

function registerSystemHandlers(ipcMain, dbManager) {
  registerValidatedHandler(ipcMain, 'system:open-path', openPathSchema, async (_event, payload) => {
    const target = path.resolve(payload.filePath);
    const baseDir = path.resolve(dbManager.getBaseDir());

    if (!target.startsWith(baseDir)) {
      throw new Error('Opening paths outside app data directory is not allowed');
    }

    if (!fs.existsSync(target)) {
      throw new Error('File not found');
    }

    const openError = await shell.openPath(target);
    return { ok: openError === '', error: openError || null };
  });

  ipcMain.handle('system:clock-health', async () => {
    return checkClockHealth({ maxSkewMinutes: 5 });
  });

  ipcMain.handle('system:health', () => {
    return getSystemHealth(dbManager);
  });
}

module.exports = { registerSystemHandlers };
