const fs = require('node:fs');
const path = require('node:path');
const { createBackup, listBackups, validateBackupFile } = require('./backupService.cjs');
const { writeAuditLog } = require('../shared/auditLog.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const restoreBackupSchema = z.object({
  filePath: z.string().min(1)
});

function validateBackupPath(dbManager, backupPath) {
  const normalizedBackupsDir = path.resolve(dbManager.getBackupsDir());
  const normalizedBackupPath = path.resolve(backupPath);
  const relative = path.relative(normalizedBackupsDir, normalizedBackupPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid backup file path');
  }

  if (!fs.existsSync(normalizedBackupPath)) {
    throw new Error('Backup file does not exist');
  }

  return normalizedBackupPath;
}

function registerBackupHandlers(ipcMain, dbManager, appRef) {
  ipcMain.handle('backup:create', async () => {
    requireUnlocked(dbManager);

    const backup = await createBackup(dbManager, 'manual');

    writeAuditLog(dbManager, {
      action: 'backup.created',
      entity: 'backup',
      details: {
        filePath: backup.filePath,
        retentionRemovedCount: backup.retention.removedCount
      }
    });

    return backup;
  });

  ipcMain.handle('backup:list', () => {
    return listBackups(dbManager);
  });

  registerValidatedHandler(ipcMain, 'backup:restore', restoreBackupSchema, (_event, payload) => {
    requireUnlocked(dbManager);

    const selectedBackupPath = validateBackupPath(dbManager, payload.filePath);
    const validation = validateBackupFile(selectedBackupPath);
    if (!validation.ok) {
      throw new Error(`Selected backup failed integrity validation: ${validation.reason}`);
    }

    // Record intent before we close/reload the database.
    writeAuditLog(dbManager, {
      action: 'backup.restore.requested',
      entity: 'backup',
      details: {
        filePath: selectedBackupPath
      }
    });

    const dbPath = dbManager.getDbPath();
    dbManager.close();

    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;

    if (fs.existsSync(walPath)) {
      fs.rmSync(walPath, { force: true });
    }

    if (fs.existsSync(shmPath)) {
      fs.rmSync(shmPath, { force: true });
    }

    fs.copyFileSync(selectedBackupPath, dbPath);

    setTimeout(() => {
      appRef.relaunch();
      appRef.exit(0);
    }, 350);

    return {
      ok: true,
      message: 'Backup restored. App will restart.'
    };
  });
}

module.exports = {
  registerBackupHandlers
};
