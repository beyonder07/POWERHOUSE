const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  getSyncSettings,
  getSyncSettingsForUi,
  getSyncRetrySettings,
  getNotificationSettings,
  setSetting,
  setSyncCircuitBreakerState
} = require('../shared/settings.cjs');
const { writeJobLog } = require('../shared/jobLog.cjs');
const { isCooldownActive, nextCircuitBreakerState } = require('./circuitBreaker.cjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 4) {
    return digits;
  }

  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function buildSyncPayloadInline(dbManager, settings, notificationSettings, options = {}) {
  const db = dbManager.getDb();
  const cursorFrom = options.cursorFrom || null;
  const cursorTo = options.cursorTo || new Date().toISOString();

  const members = db.prepare(`
    SELECT
      id,
      name,
      phone,
      join_date AS joinDate,
      plan_type AS planType,
      expiry_date AS expiryDate,
      status,
      assigned_trainer_id AS assignedTrainerId
    FROM members
    ORDER BY id DESC
  `).all().map((member) => ({
    id: member.id,
    name: member.name,
    phone: settings.maskPhone ? maskPhone(member.phone) : member.phone,
    joinDate: member.joinDate,
    planType: member.planType,
    expiryDate: member.expiryDate,
    status: member.status,
    assignedTrainerId: member.assignedTrainerId ?? null
  }));

  const paymentSummaries = db.prepare(`
    SELECT
      p.member_id AS memberId,
      m.name AS memberName,
      COUNT(p.id) AS paymentCount,
      COALESCE(SUM(p.amount), 0) AS totalAmount,
      COALESCE(SUM(p.late_fee), 0) AS totalLateFee,
      MAX(p.date) AS lastPaymentDate
    FROM payments p
    JOIN members m ON m.id = p.member_id
    WHERE p.voided_at IS NULL
    GROUP BY p.member_id, m.name
  `).all();

  const paymentHistory = db.prepare(`
    SELECT
      p.id,
      p.member_id AS memberId,
      m.name AS memberName,
      p.amount,
      p.late_fee AS lateFee,
      p.payment_mode AS paymentMode,
      p.date,
      CASE
        WHEN p.voided_at IS NULL THEN 'paid'
        ELSE 'voided'
      END AS status
    FROM payments p
    JOIN members m ON m.id = p.member_id
    ORDER BY p.date DESC, p.id DESC
  `).all();

  const dashboard = {
    totalMembers: db.prepare('SELECT COUNT(1) AS total FROM members').get().total,
    activeMembers: db.prepare("SELECT COUNT(1) AS total FROM members WHERE status = 'active'").get().total,
    revenueToday: db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date = date('now') AND voided_at IS NULL").get().total,
    revenueMonth: db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE substr(date,1,7) = strftime('%Y-%m','now') AND voided_at IS NULL").get().total
  };

  const attendance = db.prepare(`
    SELECT
      a.id,
      a.member_id AS memberId,
      m.name AS memberName,
      a.check_in_time AS checkInTime,
      a.date,
      a.status,
      a.voided_at AS voidedAt,
      a.void_reason AS voidReason
    FROM attendance a
    JOIN members m ON m.id = a.member_id
    ORDER BY a.id DESC
  `).all();

  const trainers = db.prepare(`
    SELECT
      t.id,
      t.name,
      t.phone,
      t.base_salary AS baseSalary,
      t.status
    FROM trainers t
    ORDER BY t.id ASC
  `).all().map((trainer) => ({
    id: trainer.id,
    name: trainer.name,
    phone: settings.maskPhone ? maskPhone(trainer.phone) : trainer.phone,
    baseSalary: trainer.baseSalary,
    status: trainer.status
  }));

  const trainerAttendance = db.prepare(`
    SELECT
      ta.id,
      ta.trainer_id AS trainerId,
      t.name AS trainerName,
      ta.check_in_time AS checkInTime,
      ta.date
    FROM trainer_attendance ta
    JOIN trainers t ON t.id = ta.trainer_id
    ORDER BY ta.id DESC
  `).all();

  const notificationPolicy = {
    enabled: notificationSettings.enabled,
    expiryDaysBefore: notificationSettings.expiryDaysBefore,
    channel: notificationSettings.channel,
    dispatchMode: notificationSettings.dispatchMode
  };

  const contentHash = crypto.createHash('sha256')
    .update(JSON.stringify({ members, paymentSummaries, paymentHistory, attendance, trainers, trainerAttendance, dashboard, notificationPolicy }))
    .digest('hex');

  const idempotencyKey = `${new Date().toISOString().slice(0, 10)}-${contentHash.slice(0, 24)}`;

  return {
    syncMode: 'full',
    generatedAt: new Date().toISOString(),
    cursorFrom,
    cursorTo,
    idempotencyKey,
    contentHash,
    members,
    paymentSummaries,
    paymentHistory,
    attendance,
    trainers,
    trainerAttendance,
    dashboard,
    notificationPolicy
  };
}

function buildSyncPayloadInWorker(dbManager, settings, notificationPolicy, options = {}) {
  const workerFile = path.join(__dirname, 'syncPayloadWorker.cjs');
  const workerData = {
    dbPath: dbManager.getDbPath(),
    maskPhone: Boolean(settings.maskPhone),
    notificationPolicy,
    cursorFrom: options.cursorFrom || null,
    cursorTo: options.cursorTo || new Date().toISOString()
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(workerFile, { workerData });

    worker.once('message', (message) => {
      if (settled) {
        return;
      }
      settled = true;

      if (message && message.ok) {
        resolve(message.payload);
      } else {
        reject(new Error(message && message.error ? message.error : 'Sync payload worker failed'));
      }
    });

    worker.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    worker.once('exit', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        reject(new Error('Sync payload worker exited without result'));
      } else {
        reject(new Error(`Sync payload worker exited with code ${code}`));
      }
    });
  });
}

function buildDeltaSyncPayload(dbManager, settings, notificationSettings, cursorFrom) {
  const db = dbManager.getDb();
  const cursorTo = new Date().toISOString();
  const notificationPolicy = {
    enabled: notificationSettings.enabled,
    expiryDaysBefore: notificationSettings.expiryDaysBefore,
    channel: notificationSettings.channel,
    dispatchMode: notificationSettings.dispatchMode
  };

  const members = db.prepare(`
    SELECT
      id,
      name,
      phone,
      join_date AS joinDate,
      plan_type AS planType,
      expiry_date AS expiryDate,
      status,
      assigned_trainer_id AS assignedTrainerId
    FROM members
    WHERE datetime(updated_at) > datetime(@cursorFrom)
    ORDER BY updated_at ASC, id ASC
  `).all({ cursorFrom }).map((member) => ({
    id: member.id,
    name: member.name,
    phone: settings.maskPhone ? maskPhone(member.phone) : member.phone,
    joinDate: member.joinDate,
    planType: member.planType,
    expiryDate: member.expiryDate,
    status: member.status,
    assignedTrainerId: member.assignedTrainerId ?? null
  }));

  const changedMemberRows = db.prepare(`
    SELECT DISTINCT member_id AS memberId
    FROM payments
    WHERE datetime(COALESCE(updated_at, created_at)) > datetime(@cursorFrom)
  `).all({ cursorFrom });
  const changedMemberIds = changedMemberRows.map((row) => Number(row.memberId)).filter((value) => Number.isFinite(value));

  let paymentSummaries = [];
  let paymentHistory = [];
  if (changedMemberIds.length > 0) {
    const placeholders = changedMemberIds.map((_, index) => `@id${index}`).join(',');
    const bindings = {};
    changedMemberIds.forEach((memberId, index) => {
      bindings[`id${index}`] = memberId;
    });
    paymentSummaries = db.prepare(`
      SELECT
        p.member_id AS memberId,
        m.name AS memberName,
        COUNT(p.id) AS paymentCount,
        COALESCE(SUM(p.amount), 0) AS totalAmount,
        COALESCE(SUM(p.late_fee), 0) AS totalLateFee,
        MAX(p.date) AS lastPaymentDate
      FROM payments p
      JOIN members m ON m.id = p.member_id
      WHERE p.member_id IN (${placeholders})
      AND p.voided_at IS NULL
      GROUP BY p.member_id, m.name
    `).all(bindings);

    paymentHistory = db.prepare(`
      SELECT
        p.id,
        p.member_id AS memberId,
        m.name AS memberName,
        p.amount,
        p.late_fee AS lateFee,
        p.payment_mode AS paymentMode,
        p.date,
        CASE
          WHEN p.voided_at IS NULL THEN 'paid'
          ELSE 'voided'
        END AS status
      FROM payments p
      JOIN members m ON m.id = p.member_id
      WHERE p.member_id IN (${placeholders})
      ORDER BY p.date DESC, p.id DESC
    `).all(bindings);
  }

  const dashboard = {
    totalMembers: db.prepare('SELECT COUNT(1) AS total FROM members').get().total,
    activeMembers: db.prepare("SELECT COUNT(1) AS total FROM members WHERE status = 'active'").get().total,
    revenueToday: db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date = date('now') AND voided_at IS NULL").get().total,
    revenueMonth: db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE substr(date,1,7) = strftime('%Y-%m','now') AND voided_at IS NULL").get().total
  };

  const attendance = db.prepare(`
    SELECT
      a.id,
      a.member_id AS memberId,
      m.name AS memberName,
      a.check_in_time AS checkInTime,
      a.date,
      a.status,
      a.voided_at AS voidedAt,
      a.void_reason AS voidReason
    FROM attendance a
    JOIN members m ON m.id = a.member_id
    WHERE datetime(COALESCE(a.updated_at, a.created_at)) > datetime(@cursorFrom)
    ORDER BY datetime(COALESCE(a.updated_at, a.created_at)) ASC, a.id ASC
  `).all({ cursorFrom });

  const trainers = db.prepare(`
    SELECT
      t.id,
      t.name,
      t.phone,
      t.base_salary AS baseSalary,
      t.status
    FROM trainers t
    WHERE datetime(COALESCE(t.updated_at, t.created_at)) > datetime(@cursorFrom)
    ORDER BY datetime(COALESCE(t.updated_at, t.created_at)) ASC, t.id ASC
  `).all({ cursorFrom }).map((trainer) => ({
    id: trainer.id,
    name: trainer.name,
    phone: settings.maskPhone ? maskPhone(trainer.phone) : trainer.phone,
    baseSalary: trainer.baseSalary,
    status: trainer.status
  }));

  const trainerAttendance = db.prepare(`
    SELECT
      ta.id,
      ta.trainer_id AS trainerId,
      t.name AS trainerName,
      ta.check_in_time AS checkInTime,
      ta.date
    FROM trainer_attendance ta
    JOIN trainers t ON t.id = ta.trainer_id
    WHERE datetime(COALESCE(ta.updated_at, ta.created_at)) > datetime(@cursorFrom)
    ORDER BY datetime(COALESCE(ta.updated_at, ta.created_at)) ASC, ta.id ASC
  `).all({ cursorFrom });

  const contentHash = crypto.createHash('sha256')
    .update(JSON.stringify({ cursorFrom, cursorTo, members, paymentSummaries, paymentHistory,
    attendance,
    trainers,
    trainerAttendance,
    dashboard, notificationPolicy }))
    .digest('hex');
  const idempotencyKey = `${new Date().toISOString().slice(0, 10)}-delta-${contentHash.slice(0, 20)}`;

  return {
    syncMode: 'delta',
    generatedAt: new Date().toISOString(),
    cursorFrom,
    cursorTo,
    idempotencyKey,
    contentHash,
    members,
    paymentSummaries,
    paymentHistory,
    attendance,
    trainers,
    trainerAttendance,
    dashboard,
    notificationPolicy
  };
}

async function buildSyncPayload(dbManager, settings) {
  const notificationSettings = getNotificationSettings(dbManager);
  const notificationPolicy = {
    enabled: notificationSettings.enabled,
    expiryDaysBefore: notificationSettings.expiryDaysBefore,
    channel: notificationSettings.channel,
    dispatchMode: notificationSettings.dispatchMode
  };
  const cursorFrom = settings.incrementalCursor || null;

  // Incremental mode sends only changed records since last successful sync.
  if (cursorFrom) {
    return buildDeltaSyncPayload(dbManager, settings, notificationSettings, cursorFrom);
  }

  try {
    return await buildSyncPayloadInWorker(dbManager, settings, notificationPolicy, {
      cursorFrom: null,
      cursorTo: new Date().toISOString()
    });
  } catch (error) {
    console.warn('[sync] payload worker fallback to inline build:', error instanceof Error ? error.message : error);
    return buildSyncPayloadInline(dbManager, settings, notificationSettings, {
      cursorFrom: null,
      cursorTo: new Date().toISOString()
    });
  }
}

function logSync(dbManager, payload) {
  const db = dbManager.getDb();
  db.prepare(`
    INSERT INTO sync_logs(status, records, error, created_at)
    VALUES (@status, @records, @error, datetime('now'))
  `).run({
    status: payload.status,
    records: payload.records,
    error: payload.error || null
  });
}

function enqueuePayload(dbManager, payload) {
  const db = dbManager.getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sync_outbox(
      idempotency_key,
      payload,
      attempts,
      retry_count,
      status,
      next_attempt_at,
      next_retry_at,
      last_attempt_at,
      last_error,
      created_at,
      updated_at
    )
    VALUES (
      @idempotencyKey,
      @payload,
      0,
      0,
      'pending',
      datetime('now'),
      datetime('now'),
      NULL,
      NULL,
      datetime('now'),
      datetime('now')
    )
  `);

  const result = insert.run({
    idempotencyKey: payload.idempotencyKey,
    payload: JSON.stringify(payload)
  });

  return result.changes > 0;
}

function getNextOutboxItem(dbManager) {
  const db = dbManager.getDb();
  return db.prepare(`
    SELECT
      id,
      idempotency_key AS idempotencyKey,
      payload,
      attempts,
      retry_count AS retryCount,
      status,
      next_attempt_at AS nextAttemptAt,
      next_retry_at AS nextRetryAt,
      last_attempt_at AS lastAttemptAt
    FROM sync_outbox
    WHERE status = 'pending'
      AND datetime(COALESCE(next_retry_at, next_attempt_at)) <= datetime('now')
    ORDER BY id ASC
    LIMIT 1
  `).get();
}

function updateOutboxAsProcessing(dbManager, id) {
  const db = dbManager.getDb();
  db.prepare(`
    UPDATE sync_outbox
    SET status = 'processing',
        last_attempt_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = @id
  `).run({ id });
}

function updateOutboxAsSuccess(dbManager, id, retryCount = 0) {
  const db = dbManager.getDb();
  db.prepare(`
    UPDATE sync_outbox
    SET status = 'completed',
        retry_count = @retryCount,
        next_retry_at = NULL,
        last_error = NULL,
        updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, retryCount });
}

function updateOutboxRetry(dbManager, item, errorMessage, retrySettings) {
  const db = dbManager.getDb();
  const nextAttempts = item.attempts + 1;

  if (nextAttempts >= retrySettings.maxAttempts) {
    db.prepare(`
      UPDATE sync_outbox
      SET status = 'failed',
          attempts = @attempts,
          retry_count = @retryCount,
          last_error = @error,
          updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id: item.id,
      attempts: nextAttempts,
      retryCount: nextAttempts,
      error: errorMessage
    });
    return;
  }

  const delaySeconds = Math.min(
    retrySettings.baseDelaySeconds * Math.pow(2, Math.max(0, nextAttempts - 1)),
    60 * 30
  );

  db.prepare(`
    UPDATE sync_outbox
    SET status = 'pending',
        attempts = @attempts,
        retry_count = @retryCount,
        last_error = @error,
        next_attempt_at = datetime('now', @delay),
        next_retry_at = datetime('now', @delay),
        updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id: item.id,
    attempts: nextAttempts,
    retryCount: nextAttempts,
    error: errorMessage,
    delay: `+${delaySeconds} seconds`
  });
}

async function pushPayloadToCloud(settings, payload) {
  const endpoint = `${settings.cloudUrl.replace(/\/$/, '')}/api/sync/push`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', settings.hmacSecret)
    .update(`${timestamp}.${payload.idempotencyKey}.${rawBody}`)
    .digest('hex');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiToken}`,
      'x-idempotency-key': payload.idempotencyKey,
      'x-sync-timestamp': timestamp,
      'x-sync-signature': signature
    },
    body: rawBody
  });

  if (!response.ok) {
    const text = await response.text();
    const retriable = response.status >= 500 || response.status === 429 || (response.status === 409 && payload.syncMode === 'delta');
    const errorCode = response.status === 409 && payload.syncMode === 'delta'
      ? 'delta-baseline-missing'
      : 'http-error';
    return {
      ok: false,
      retriable,
      errorCode,
      statusCode: response.status,
      error: text || `HTTP ${response.status}`
    };
  }

  return {
    ok: true,
    retriable: false,
    errorCode: null,
    statusCode: response.status,
    error: null
  };
}

async function sendWithRetry(settings, payload, retrySettings) {
  let attempt = 0;
  while (attempt < retrySettings.maxAttempts) {
    attempt += 1;

    try {
      const result = await pushPayloadToCloud(settings, payload);
      if (result.ok) {
        return { ok: true, error: null };
      }

      if (!result.retriable) {
        return { ok: false, error: result.error };
      }

      if (result.errorCode === 'delta-baseline-missing') {
        return { ok: false, errorCode: result.errorCode, error: result.error };
      }

      if (attempt < retrySettings.maxAttempts) {
        const jitter = Math.floor(Math.random() * 500);
        const waitMs = retrySettings.baseDelaySeconds * 1000 * Math.pow(2, Math.max(0, attempt - 1)) + jitter;
        await sleep(waitMs);
      } else {
        return { ok: false, error: result.error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync network error';
      if (attempt >= retrySettings.maxAttempts) {
        return { ok: false, error: message };
      }

      const jitter = Math.floor(Math.random() * 500);
      const waitMs = retrySettings.baseDelaySeconds * 1000 * Math.pow(2, Math.max(0, attempt - 1)) + jitter;
      await sleep(waitMs);
    }
  }

  return { ok: false, errorCode: 'retry-limit', error: 'Retry limit exceeded' };
}

async function processDueOutboxItems(dbManager, settings, retrySettings, maxItems = 3) {
  const summary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    syncModes: {
      full: 0,
      delta: 0
    }
  };

  for (let i = 0; i < maxItems; i += 1) {
    const item = getNextOutboxItem(dbManager);
    if (!item) {
      break;
    }

    updateOutboxAsProcessing(dbManager, item.id);
    summary.attempted += 1;

    let payload;
    try {
      payload = JSON.parse(item.payload);
    } catch (_error) {
      updateOutboxRetry(dbManager, item, 'Invalid queued payload JSON', retrySettings);
      summary.failed += 1;
      continue;
    }

    const result = await sendWithRetry(settings, payload, retrySettings);
    if (result.ok) {
      updateOutboxAsSuccess(dbManager, item.id, item.attempts + 1);
      setSetting(dbManager, 'sync_last_success_at', new Date().toISOString());
      const nextCursor = payload.cursorTo || payload.generatedAt;
      if (nextCursor) {
        setSetting(dbManager, 'sync_incremental_cursor', nextCursor);
      }
      const mode = payload.syncMode === 'delta' ? 'delta' : 'full';
      summary.syncModes[mode] += 1;
      logSync(dbManager, {
        status: 'success',
        records: Array.isArray(payload.members) ? payload.members.length : 0,
        error: null
      });
      summary.succeeded += 1;
    } else {
      if (result.errorCode === 'delta-baseline-missing') {
        setSetting(dbManager, 'sync_incremental_cursor', '');
        updateOutboxAsSuccess(dbManager, item.id, item.attempts + 1);

        const resetSettings = getSyncSettings(dbManager);
        const fullPayload = await buildSyncPayload(dbManager, resetSettings);
        enqueuePayload(dbManager, fullPayload);

        logSync(dbManager, {
          status: 'failed',
          records: Array.isArray(payload.members) ? payload.members.length : 0,
          error: 'Delta sync reset requested by cloud; queued full resync'
        });
        summary.succeeded += 1;
        continue;
      }

      updateOutboxRetry(dbManager, item, result.error || 'Sync failed', retrySettings);
      logSync(dbManager, {
        status: 'failed',
        records: Array.isArray(payload.members) ? payload.members.length : 0,
        error: result.error || 'Sync failed'
      });
      summary.failed += 1;
    }
  }

  return summary;
}

function getOutboxStats(dbManager) {
  const db = dbManager.getDb();
  const pending = db.prepare("SELECT COUNT(1) AS total FROM sync_outbox WHERE status = 'pending'").get().total;
  const failed = db.prepare("SELECT COUNT(1) AS total FROM sync_outbox WHERE status = 'failed'").get().total;
  const completed = db.prepare("SELECT COUNT(1) AS total FROM sync_outbox WHERE status = 'completed'").get().total;
  return {
    pending: Number(pending || 0),
    failed: Number(failed || 0),
    completed: Number(completed || 0)
  };
}

function requeueStaleProcessingItems(dbManager) {
  const db = dbManager.getDb();
  db.prepare(`
    UPDATE sync_outbox
    SET status = 'pending',
        next_attempt_at = datetime('now'),
        next_retry_at = datetime('now'),
        updated_at = datetime('now')
    WHERE status = 'processing'
      AND datetime(updated_at) <= datetime('now', '-15 minutes')
  `).run();
}

async function runSyncPush(dbManager, options = {}) {
  const runStartedAt = new Date().toISOString();
  const settings = getSyncSettings(dbManager);
  const retrySettings = getSyncRetrySettings(dbManager);
  const enqueueFresh = options.enqueueFresh !== false;
  const ignoreCooldown = options.ignoreCooldown === true;

  if (!settings.enabled) {
    writeJobLog(dbManager, {
      jobName: 'sync.push',
      status: 'skipped',
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      details: { reason: 'sync-disabled' }
    });
    return {
      ok: false,
      skipped: true,
      reason: 'sync-disabled',
      outbox: getOutboxStats(dbManager)
    };
  }

  if (!settings.cloudUrl) {
    writeJobLog(dbManager, {
      jobName: 'sync.push',
      status: 'skipped',
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      details: { reason: 'missing-cloud-url' }
    });
    return {
      ok: false,
      skipped: true,
      reason: 'missing-cloud-url',
      outbox: getOutboxStats(dbManager)
    };
  }

  if (!settings.apiToken) {
    writeJobLog(dbManager, {
      jobName: 'sync.push',
      status: 'skipped',
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      details: { reason: 'missing-api-token' }
    });
    return {
      ok: false,
      skipped: true,
      reason: 'missing-api-token',
      outbox: getOutboxStats(dbManager)
    };
  }

  if (!settings.hmacSecret) {
    writeJobLog(dbManager, {
      jobName: 'sync.push',
      status: 'skipped',
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      details: { reason: 'missing-hmac-secret' }
    });
    return {
      ok: false,
      skipped: true,
      reason: 'missing-hmac-secret',
      outbox: getOutboxStats(dbManager)
    };
  }

  if (!ignoreCooldown && isCooldownActive(settings.circuitBreaker.pausedUntil)) {
    writeJobLog(dbManager, {
      jobName: 'sync.push',
      status: 'skipped',
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      details: {
        reason: 'cooldown-active',
        pausedUntil: settings.circuitBreaker.pausedUntil || null
      }
    });
    return {
      ok: false,
      skipped: true,
      reason: 'cooldown-active',
      cooldownUntil: settings.circuitBreaker.pausedUntil,
      outbox: getOutboxStats(dbManager)
    };
  }

  requeueStaleProcessingItems(dbManager);

  let queuedNewSnapshot = false;
  if (enqueueFresh) {
    const payload = await buildSyncPayload(dbManager, settings);
    queuedNewSnapshot = enqueuePayload(dbManager, payload);
  }

  const processSummary = await processDueOutboxItems(dbManager, settings, retrySettings, 3);
  const outbox = getOutboxStats(dbManager);

  if (processSummary.attempted > 0) {
    const nextState = nextCircuitBreakerState(settings.circuitBreaker, processSummary);
    setSyncCircuitBreakerState(dbManager, {
      failureStreak: nextState.failureStreak,
      pausedUntil: nextState.pausedUntil
    });
  }

  writeJobLog(dbManager, {
    jobName: 'sync.push',
    status: processSummary.failed > 0 ? 'failed' : 'success',
    startedAt: runStartedAt,
    finishedAt: new Date().toISOString(),
    details: {
      queuedNewSnapshot,
      outbox,
      processed: processSummary
    },
    error: processSummary.failed > 0 ? 'One or more sync items failed' : null
  });

  return {
    ok: processSummary.failed === 0,
    skipped: processSummary.attempted === 0,
    queuedNewSnapshot,
    processed: processSummary,
    outbox
  };
}

function getSyncStatus(dbManager) {
  const db = dbManager.getDb();
  const settings = getSyncSettingsForUi(dbManager);
  const latest = db.prepare(`
    SELECT id, status, records, error, created_at AS createdAt
    FROM sync_logs
    ORDER BY id DESC
    LIMIT 1
  `).get();

  return {
    settings,
    latest: latest || null,
    outbox: getOutboxStats(dbManager)
  };
}

function getSyncLogs(dbManager, limit = 100) {
  const db = dbManager.getDb();
  return db.prepare(`
    SELECT id, status, records, error, created_at AS createdAt
    FROM sync_logs
    ORDER BY id DESC
    LIMIT @limit
  `).all({ limit });
}

function getOutboxItems(dbManager, limit = 100) {
  const db = dbManager.getDb();
  return db.prepare(`
    SELECT
      id,
      idempotency_key AS idempotencyKey,
      attempts,
      retry_count AS retryCount,
      status,
      next_attempt_at AS nextAttemptAt,
      next_retry_at AS nextRetryAt,
      last_attempt_at AS lastAttemptAt,
      last_error AS lastError,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM sync_outbox
    ORDER BY id DESC
    LIMIT @limit
  `).all({ limit });
}

function retryFailedOutbox(dbManager, limit = 50) {
  const db = dbManager.getDb();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(Number(limit || 50))));
  const result = db.prepare(`
    UPDATE sync_outbox
    SET status = 'pending',
        attempts = 0,
        retry_count = 0,
        next_attempt_at = datetime('now'),
        next_retry_at = datetime('now'),
        last_error = NULL,
        updated_at = datetime('now')
    WHERE id IN (
      SELECT id
      FROM sync_outbox
      WHERE status = 'failed'
      ORDER BY id ASC
      LIMIT @limit
    )
  `).run({ limit: safeLimit });

  return {
    retried: result.changes,
    outbox: getOutboxStats(dbManager)
  };
}

function retryOutboxItem(dbManager, id) {
  const db = dbManager.getDb();
  const outboxId = Math.floor(Number(id || 0));
  if (!Number.isFinite(outboxId) || outboxId <= 0) {
    throw new Error('Invalid outbox item id');
  }

  const result = db.prepare(`
    UPDATE sync_outbox
    SET status = 'pending',
        attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END,
        retry_count = CASE WHEN status = 'failed' THEN 0 ELSE retry_count END,
        next_attempt_at = datetime('now'),
        next_retry_at = datetime('now'),
        last_error = NULL,
        updated_at = datetime('now')
    WHERE id = @id
      AND status IN ('failed', 'pending')
  `).run({ id: outboxId });

  return {
    updated: result.changes > 0,
    outbox: getOutboxStats(dbManager)
  };
}

module.exports = {
  runSyncPush,
  getSyncStatus,
  getSyncLogs,
  getOutboxItems,
  retryFailedOutbox,
  retryOutboxItem,
  buildSyncPayload
};





