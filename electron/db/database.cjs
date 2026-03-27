const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

function ensurePragmas(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
}

function ensureWindowsEfsEncryption(directoryPath) {
  if (process.platform !== 'win32') {
    return {
      mode: 'unsupported-platform',
      ok: false
    };
  }

  const encryptResult = spawnSync('cipher', ['/E', directoryPath], {
    windowsHide: true,
    shell: true,
    encoding: 'utf8'
  });

  if (encryptResult.status !== 0) {
    return {
      mode: 'windows-efs',
      ok: false,
      error: (encryptResult.stderr || encryptResult.stdout || 'EFS encryption failed').trim()
    };
  }

  const verifyResult = spawnSync('cipher', ['/C', directoryPath], {
    windowsHide: true,
    shell: true,
    encoding: 'utf8'
  });
  const combined = `${verifyResult.stdout || ''}\n${verifyResult.stderr || ''}`.toUpperCase();
  const encrypted = combined.includes('E ') || combined.includes('ENCRYPTED');

  return {
    mode: 'windows-efs',
    ok: encrypted,
    output: (verifyResult.stdout || '').trim()
  };
}

function addColumnIfMissing(db, table, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);
  if (!hasColumn) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefinition}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('non-constant default')) {
        throw error;
      }

      const fallbackDefinition = columnDefinition
        .replace(/\s+NOT NULL\s+DEFAULT\s+\(datetime\('now'\)\)/i, '')
        .replace(/\s+DEFAULT\s+\(datetime\('now'\)\)/i, '')
        .trim();

      db.exec(`ALTER TABLE ${table} ADD COLUMN ${fallbackDefinition}`);
      db.exec(`UPDATE ${table} SET ${columnName} = COALESCE(${columnName}, datetime('now'))`);
    }
  }
}

function ensureMembersPhoneUniqueConstraint(db) {
  const duplicate = db.prepare(`
    SELECT phone, COUNT(1) AS total
    FROM members
    GROUP BY phone
    HAVING COUNT(1) > 1
    LIMIT 1
  `).get();

  if (duplicate) {
    console.warn(`[db] duplicate member phones detected; unique constraint not applied for phone=${duplicate.phone}`);
    return false;
  }

  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_members_phone_unique ON members(phone)');
  return true;
}

function readIntegrityResult(db) {
  const row = db.prepare('PRAGMA integrity_check').get();
  if (!row) {
    return 'unknown';
  }
  const first = Object.keys(row)[0];
  return String(row[first] || '');
}

function checkSqliteIntegrity(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: true, reason: 'missing' };
  }

  let checkDb;
  try {
    checkDb = new Database(filePath, { readonly: true, fileMustExist: true });
    const result = readIntegrityResult(checkDb);
    return {
      ok: result.toLowerCase() === 'ok',
      result
    };
  } catch (error) {
    return {
      ok: false,
      result: error instanceof Error ? error.message : 'Integrity check failed'
    };
  } finally {
    if (checkDb && checkDb.open) {
      checkDb.close();
    }
  }
}

function getLatestValidBackup(backupsDir) {
  if (!fs.existsSync(backupsDir)) {
    return null;
  }

  const candidates = fs.readdirSync(backupsDir)
    .filter((file) => file.endsWith('.sqlite'))
    .map((file) => {
      const filePath = path.join(backupsDir, file);
      const stat = fs.statSync(filePath);
      return { filePath, modifiedAtMs: stat.mtimeMs };
    })
    .sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);

  for (const candidate of candidates) {
    const integrity = checkSqliteIntegrity(candidate.filePath);
    if (integrity.ok) {
      return candidate.filePath;
    }
  }

  return null;
}

function tryRecoverCorruptDatabase(dbPath, backupsDir) {
  const integrity = checkSqliteIntegrity(dbPath);
  if (integrity.ok) {
    return { recovered: false, reason: null };
  }

  const backupPath = getLatestValidBackup(backupsDir);
  if (!backupPath) {
    return {
      recovered: false,
      reason: `integrity failed (${integrity.result}); no valid backup found`
    };
  }

  const quarantinePath = `${dbPath}.corrupt-${Date.now()}`;
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  if (fs.existsSync(dbPath)) {
    fs.renameSync(dbPath, quarantinePath);
  }
  if (fs.existsSync(walPath)) {
    fs.rmSync(walPath, { force: true });
  }
  if (fs.existsSync(shmPath)) {
    fs.rmSync(shmPath, { force: true });
  }

  fs.copyFileSync(backupPath, dbPath);
  const restoredIntegrity = checkSqliteIntegrity(dbPath);
  if (!restoredIntegrity.ok) {
    return {
      recovered: false,
      reason: `restore from backup failed integrity (${restoredIntegrity.result})`
    };
  }

  return {
    recovered: true,
    backupPath,
    quarantinedPath: quarantinePath
  };
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      join_date TEXT NOT NULL,
      plan_type TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
      assigned_trainer_id INTEGER,
      freeze_start TEXT,
      freeze_end TEXT,
      freeze_reason TEXT,
      freeze_days_total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(assigned_trainer_id) REFERENCES trainers(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      late_fee REAL NOT NULL DEFAULT 0,
      payment_mode TEXT NOT NULL,
      date TEXT NOT NULL,
      invoice_id INTEGER,
      notes TEXT,
      voided_at TEXT,
      void_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(member_id) REFERENCES members(id),
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS trainers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      base_salary REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS trainer_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trainer_id INTEGER NOT NULL,
      check_in_time TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(trainer_id) REFERENCES trainers(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      check_in_time TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent')),
      voided_at TEXT,
      void_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      last_sent_at TEXT,
      last_channel TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_dispatch_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email', 'manual')),
      destination TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
      error TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS payment_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('cash', 'upi', 'card', 'bank-transfer', 'other')),
      amount REAL NOT NULL CHECK (amount > 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(payment_id) REFERENCES payments(id)
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      context TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      records INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
      next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      next_retry_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT NOT NULL UNIQUE,
      member_id INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
      recipient TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('expiry-reminder', 'overdue-alert')),
      message TEXT NOT NULL,
      run_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'failed')) DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_attempt_at TEXT,
      next_retry_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(member_id) REFERENCES members(id)
    );

    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed', 'skipped')),
      details TEXT,
      error TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
    CREATE INDEX IF NOT EXISTS idx_members_expiry_date ON members(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
    CREATE INDEX IF NOT EXISTS idx_payments_member_id ON payments(member_id);
    CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
    CREATE INDEX IF NOT EXISTS idx_attendance_member_id ON attendance(member_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
    CREATE INDEX IF NOT EXISTS idx_invoices_member_id ON invoices(member_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_dispatch_logs_invoice_id ON invoice_dispatch_logs(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_payment_splits_payment_id ON payment_splits(payment_id);
    CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_next_attempt ON sync_outbox(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_run_date ON notification_queue(run_date);
    CREATE INDEX IF NOT EXISTS idx_job_logs_name_created ON job_logs(job_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_trainer_attendance_trainer ON trainer_attendance(trainer_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_trainer_attendance_date_unique ON trainer_attendance(trainer_id, date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_member_date_unique ON attendance(member_id, date);

    CREATE TRIGGER IF NOT EXISTS trg_payments_validate_insert
    BEFORE INSERT ON payments
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.amount = 0 THEN RAISE(ABORT, 'Payment amount cannot be 0')
        WHEN NEW.payment_mode NOT IN ('cash', 'upi', 'card', 'bank-transfer', 'other') THEN RAISE(ABORT, 'Invalid payment mode')
      END;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_payments_validate_update
    BEFORE UPDATE ON payments
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN NEW.amount = 0 THEN RAISE(ABORT, 'Payment amount cannot be 0')
        WHEN NEW.payment_mode NOT IN ('cash', 'upi', 'card', 'bank-transfer', 'other') THEN RAISE(ABORT, 'Invalid payment mode')
      END;
    END;
  `);

  addColumnIfMissing(db, 'payments', 'notes', 'notes TEXT');
  addColumnIfMissing(db, 'payments', 'created_at', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'payments', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'payments', 'version', 'version INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'payments', 'late_fee', 'late_fee REAL NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'payments', 'voided_at', 'voided_at TEXT');
  addColumnIfMissing(db, 'payments', 'void_reason', 'void_reason TEXT');
  addColumnIfMissing(db, 'attendance', 'created_at', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'attendance', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'attendance', 'status', "status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent'))");
  addColumnIfMissing(db, 'attendance', 'voided_at', 'voided_at TEXT');
  addColumnIfMissing(db, 'attendance', 'void_reason', 'void_reason TEXT');
  addColumnIfMissing(db, 'members', 'created_at', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'members', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'members', 'version', 'version INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'members', 'assigned_trainer_id', 'assigned_trainer_id INTEGER REFERENCES trainers(id)');
  addColumnIfMissing(db, 'members', 'freeze_start', 'freeze_start TEXT');
  addColumnIfMissing(db, 'members', 'freeze_end', 'freeze_end TEXT');
  addColumnIfMissing(db, 'members', 'freeze_reason', 'freeze_reason TEXT');
  addColumnIfMissing(db, 'members', 'freeze_days_total', 'freeze_days_total INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'invoices', 'sent_count', 'sent_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'invoices', 'last_sent_at', 'last_sent_at TEXT');
  addColumnIfMissing(db, 'invoices', 'last_channel', 'last_channel TEXT');
  addColumnIfMissing(db, 'invoices', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'invoice_dispatch_logs', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'notification_logs', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'sync_logs', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'settings', 'created_at', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'audit_logs', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'job_logs', 'updated_at', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  addColumnIfMissing(db, 'sync_outbox', 'retry_count', 'retry_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'sync_outbox', 'last_attempt_at', 'last_attempt_at TEXT');
  addColumnIfMissing(db, 'sync_outbox', 'next_retry_at', 'next_retry_at TEXT');
  addColumnIfMissing(db, 'notification_queue', 'retry_count', 'retry_count INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'notification_queue', 'last_attempt_at', 'last_attempt_at TEXT');
  addColumnIfMissing(db, 'notification_queue', 'next_retry_at', 'next_retry_at TEXT');
  db.exec("UPDATE notification_queue SET next_retry_at = COALESCE(next_retry_at, datetime('now'))");
  ensureMembersPhoneUniqueConstraint(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_next_retry ON sync_outbox(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_notification_queue_status_retry ON notification_queue(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_members_assigned_trainer ON members(assigned_trainer_id);
  `);

  db.exec(`
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('late_fee_enabled', '1', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('late_fee_grace_days', '3', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('late_fee_per_day', '20', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('late_fee_max', '1000', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('backup_keep_last', '14', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('backup_offsite_path', '', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('lock_timeout_minutes', '15', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notification_enabled', '1', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notification_expiry_days_before', '3', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notification_channel', 'whatsapp', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notification_dispatch_mode', 'desktop', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('notification_last_sweep_at', '', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_enabled', '0', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_cloud_url', '', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_api_token', '', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_hmac_secret', '', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_interval_minutes', '60', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_mask_phone', '1', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_last_success_at', '', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_incremental_cursor', '', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_retry_max_attempts', '5', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_retry_base_delay_seconds', '30', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_circuit_breaker_threshold', '5', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_circuit_breaker_cooldown_minutes', '30', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_circuit_breaker_failure_streak', '0', datetime('now'));
    INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES ('sync_circuit_breaker_paused_until', '', datetime('now'));
  `);
}

function createDbManager(userDataPath) {
  const baseDir = path.join(userDataPath, 'gym-management');
  const backupsDir = path.join(baseDir, 'backups');
  const invoicesDir = path.join(baseDir, 'invoices');
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.mkdirSync(invoicesDir, { recursive: true });
  const encryptionStatus = ensureWindowsEfsEncryption(baseDir);
  if (!encryptionStatus.ok) {
    console.warn(`[db] data-at-rest encryption warning: ${encryptionStatus.error || encryptionStatus.mode}`);
  }

  const dbPath = path.join(baseDir, 'gym.sqlite');
  const recovery = tryRecoverCorruptDatabase(dbPath, backupsDir);
  if (recovery.recovered) {
    console.warn(`[db] recovered corrupt database from backup: ${recovery.backupPath}`);
  } else if (recovery.reason) {
    console.error(`[db] startup integrity warning: ${recovery.reason}`);
  }

  let db = new Database(dbPath);
  ensurePragmas(db);
  runMigrations(db);
  const startupIntegrity = readIntegrityResult(db).toLowerCase();
  if (startupIntegrity !== 'ok') {
    throw new Error(`Database integrity check failed after startup: ${startupIntegrity}`);
  }

  return {
    getDb() {
      return db;
    },
    getDbPath() {
      return dbPath;
    },
    getEncryptionStatus() {
      return encryptionStatus;
    },
    getWalPath() {
      return `${dbPath}-wal`;
    },
    getBaseDir() {
      return baseDir;
    },
    getBackupsDir() {
      return backupsDir;
    },
    getInvoicesDir() {
      return invoicesDir;
    },
    checkpointWal() {
      if (!db || !db.open) {
        return null;
      }
      try {
        return db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (_error) {
        return null;
      }
    },
    close() {
      if (db && db.open) {
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (_error) {
          // Ignore checkpoint failures during shutdown.
        }
        db.close();
      }
    },
    reopen() {
      if (db && db.open) {
        db.close();
      }

      const reopenRecovery = tryRecoverCorruptDatabase(dbPath, backupsDir);
      if (reopenRecovery.recovered) {
        console.warn(`[db] recovered corrupt database during reopen from backup: ${reopenRecovery.backupPath}`);
      }

      db = new Database(dbPath);
      ensurePragmas(db);
      runMigrations(db);
      const reopenIntegrity = readIntegrityResult(db).toLowerCase();
      if (reopenIntegrity !== 'ok') {
        throw new Error(`Database integrity check failed after reopen: ${reopenIntegrity}`);
      }
    }
  };
}

module.exports = { createDbManager };
