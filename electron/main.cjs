const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createDbManager } = require('./db/database.cjs');
const { registerMemberHandlers } = require('./modules/members/memberHandlers.cjs');
const { registerPaymentHandlers } = require('./modules/payments/paymentHandlers.cjs');
const { registerAttendanceHandlers } = require('./modules/attendance/attendanceHandlers.cjs');
const { registerTrainerHandlers } = require('./modules/trainers/trainerHandlers.cjs');
const { registerBackupHandlers } = require('./modules/backups/backupHandlers.cjs');
const { scheduleDailyAutoBackup } = require('./modules/backups/backupService.cjs');
const { registerDashboardHandlers } = require('./modules/dashboard/dashboardHandlers.cjs');
const { registerInvoiceHandlers } = require('./modules/invoices/invoiceHandlers.cjs');
const { registerSystemHandlers } = require('./modules/system/systemHandlers.cjs');
const { registerDuesHandlers } = require('./modules/dues/duesHandlers.cjs');
const { startClockMonitor } = require('./modules/system/clockHealth.cjs');
const { registerSecurityHandlers } = require('./modules/security/securityHandlers.cjs');
const { evaluateTimeout } = require('./modules/security/sessionGuard.cjs');
const { startNtpGuard } = require('./modules/security/timeGuard.cjs');
const { registerNotificationHandlers } = require('./modules/notifications/notificationHandlers.cjs');
const { scheduleNotifications } = require('./modules/notifications/notificationScheduler.cjs');
const { runNotificationSweep } = require('./modules/notifications/notificationService.cjs');
const { registerSyncHandlers, scheduleSyncRunner } = require('./modules/sync/syncHandlers.cjs');
const { getSetting, setSetting } = require('./modules/shared/settings.cjs');
const { todayDate } = require('./modules/shared/dateUtils.cjs');

let mainWindow;
let dbManager;
let backupScheduler;
let securityHeartbeat;
let notificationScheduler;
let syncScheduler;
let walCheckpointTimer;
let lastWalCheckpointAt = 0;

function maybeCheckpointWal(dbManagerRef, logger = console) {
  try {
    const walPath = dbManagerRef.getWalPath();
    const stats = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
    const walBytes = stats ? stats.size : 0;
    const thresholdBytes = 32 * 1024 * 1024; // 32 MB default threshold

    const staleSinceLastCheckpointMs = Date.now() - lastWalCheckpointAt;
    const shouldRunBySize = walBytes >= thresholdBytes;
    const shouldRunByAge = staleSinceLastCheckpointMs >= 6 * 60 * 60 * 1000;

    if (!shouldRunBySize && !shouldRunByAge) {
      return;
    }

    const result = dbManagerRef.checkpointWal();
    if (result) {
      lastWalCheckpointAt = Date.now();
      logger.info(`[db] wal checkpoint completed (size=${walBytes} bytes)`);
    }
  } catch (error) {
    logger.error('[db] wal checkpoint probe failed:', error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0d1218',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'out', 'index.html'));
  }
}

app.whenReady().then(() => {
  dbManager = createDbManager(app.getPath('userData'));

  registerMemberHandlers(ipcMain, dbManager);
  registerPaymentHandlers(ipcMain, dbManager);
  registerAttendanceHandlers(ipcMain, dbManager);
  registerTrainerHandlers(ipcMain, dbManager);
  registerBackupHandlers(ipcMain, dbManager, app);
  registerDashboardHandlers(ipcMain, dbManager);
  registerInvoiceHandlers(ipcMain, dbManager);
  registerSystemHandlers(ipcMain, dbManager);
  registerDuesHandlers(ipcMain, dbManager);
  registerSecurityHandlers(ipcMain, dbManager);
  registerNotificationHandlers(ipcMain, dbManager);
  registerSyncHandlers(ipcMain, dbManager);

  backupScheduler = scheduleDailyAutoBackup(dbManager, console);
  notificationScheduler = scheduleNotifications(dbManager, console);
  syncScheduler = scheduleSyncRunner(dbManager, console);
  securityHeartbeat = setInterval(() => evaluateTimeout(dbManager), 30000);
  walCheckpointTimer = setInterval(() => {
    maybeCheckpointWal(dbManager, console);
  }, 5 * 60 * 1000);
  maybeCheckpointWal(dbManager, console);
  createWindow();

  // Security: Check OS Clock Drift
  startNtpGuard(mainWindow);
  startClockMonitor();

  // Reliability: Catch-up Missed Crons
  setTimeout(async () => {
    try {
      const { todayDate } = require('./modules/shared/dateUtils.cjs');
      const today = todayDate();
      
      const lastBackup = getSetting(dbManager, 'backup_last_run_at') || '';
      if (!lastBackup.startsWith(today)) {
        console.info('[catch-up] Running missed daily backup...');
        const { createBackup } = require('./modules/backups/backupService.cjs');
        await createBackup(dbManager, 'auto_catchup');
        setSetting(dbManager, 'backup_last_run_at', new Date().toISOString());
      }

      const lastSweep = getSetting(dbManager, 'notification_last_sweep_at') || '';
      if (!lastSweep.startsWith(today)) {
        console.info('[catch-up] Running missed notification sweep...');
        await runNotificationSweep(dbManager);
        setSetting(dbManager, 'notification_last_sweep_at', new Date().toISOString());
      }
    } catch(err) {
      console.error('[catch-up] Failed to run missed crons:', err);
    }
  }, 10000); // Check 10 seconds after boot

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (backupScheduler) {
    backupScheduler.stop();
  }

  if (securityHeartbeat) {
    clearInterval(securityHeartbeat);
  }

  if (notificationScheduler) {
    notificationScheduler.stop();
  }

  if (syncScheduler) {
    syncScheduler.stop();
  }

  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer);
  }

  if (dbManager) {
    dbManager.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
