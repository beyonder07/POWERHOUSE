const fs = require('node:fs');
const path = require('node:path');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { toSafeFileTimeStamp } = require('../shared/dateUtils.cjs');
const { getBackupRetentionCount, getBackupOffsitePath } = require('../shared/settings.cjs');
const { writeJobLog } = require('../shared/jobLog.cjs');

function validateBackupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: 'Backup file does not exist' };
  }

  let db;
  try {
    db = new Database(filePath, { readonly: true, fileMustExist: true });
    const row = db.prepare('PRAGMA integrity_check').get();
    const firstKey = row ? Object.keys(row)[0] : null;
    const result = firstKey ? String(row[firstKey] || '') : '';

    return {
      ok: result.toLowerCase() === 'ok',
      reason: result || 'Unknown integrity result'
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'Backup validation failed'
    };
  } finally {
    if (db && db.open) {
      db.close();
    }
  }
}

function listBackups(dbManager) {
  const dir = dbManager.getBackupsDir();
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sqlite'))
    .map((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      return {
        file,
        filePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        modifiedAtMs: stat.mtimeMs
      };
    })
    .sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);

  return files.map(({ modifiedAtMs, ...rest }) => rest);
}

function applyBackupRetentionPolicy(dbManager, keepLast = null) {
  const keep = keepLast ?? getBackupRetentionCount(dbManager);
  const backups = listBackups(dbManager);

  if (backups.length <= keep) {
    return { removedCount: 0, removedFiles: [] };
  }

  const removeTargets = backups.slice(keep);
  for (const backup of removeTargets) {
    if (fs.existsSync(backup.filePath)) {
      fs.rmSync(backup.filePath, { force: true });
    }
  }

  return {
    removedCount: removeTargets.length,
    removedFiles: removeTargets.map((item) => item.filePath)
  };
}

async function createBackup(dbManager, reason = 'manual') {
  const startedAt = new Date().toISOString();
  const db = dbManager.getDb();
  const filename = `gym-backup-${toSafeFileTimeStamp()}-${reason}.sqlite`;
  const filePath = path.join(dbManager.getBackupsDir(), filename);

  await db.backup(filePath);
  const validation = validateBackupFile(filePath);
  if (!validation.ok) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    throw new Error(`Backup integrity validation failed: ${validation.reason}`);
  }

  let offsite = null;
  const offsitePath = getBackupOffsitePath(dbManager);
  if (offsitePath) {
    const offsiteDir = path.resolve(offsitePath);
    fs.mkdirSync(offsiteDir, { recursive: true });
    const offsiteFilePath = path.join(offsiteDir, filename);
    fs.copyFileSync(filePath, offsiteFilePath);
    offsite = {
      filePath: offsiteFilePath
    };
  }
  const retention = applyBackupRetentionPolicy(dbManager);
  const finishedAt = new Date().toISOString();
  writeJobLog(dbManager, {
    jobName: reason === 'auto' ? 'backup.daily' : 'backup.manual',
    status: 'success',
    startedAt,
    finishedAt,
    details: {
      filePath,
      offsitePath: offsite ? offsite.filePath : null,
      retentionRemovedCount: retention.removedCount
    }
  });

  return {
    fileName: filename,
    filePath,
    offsite,
    retention
  };
}

function scheduleDailyAutoBackup(dbManager, logger = console) {
  return cron.schedule('0 2 * * *', async () => {
    const startedAt = new Date().toISOString();
    try {
      const backup = await createBackup(dbManager, 'auto');
      logger.info('[backup] Daily auto-backup created:', backup.fileName);
      if (backup.retention && backup.retention.removedCount > 0) {
        logger.info(`[backup] Retention removed ${backup.retention.removedCount} old backups.`);
      }
    } catch (error) {
      logger.error('[backup] Auto-backup failed:', error);
      writeJobLog(dbManager, {
        jobName: 'backup.daily',
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Auto backup failed'
      });
    }
  });
}

module.exports = {
  createBackup,
  validateBackupFile,
  listBackups,
  applyBackupRetentionPolicy,
  scheduleDailyAutoBackup
};
