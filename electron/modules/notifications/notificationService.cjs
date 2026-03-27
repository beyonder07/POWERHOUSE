const { getNotificationSettings, getSetting, setSetting } = require('../shared/settings.cjs');
const { writeAuditLog } = require('../shared/auditLog.cjs');
const { writeJobLog } = require('../shared/jobLog.cjs');
const { sendWhatsAppMessage } = require('./providers/whatsappCloudProvider.cjs');
const { sendSmsTwilio } = require('./providers/twilioSmsProvider.cjs');

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function createMessage(type, member) {
  if (type === 'expiry-reminder') {
    return `Hi ${member.name}, your gym membership expires on ${member.expiryDate}. Please renew to continue uninterrupted access.`;
  }

  return `Hi ${member.name}, your gym membership expired on ${member.expiryDate}. Please clear dues and renew your plan.`;
}

async function dispatchWithProvider(channel, recipient, message) {
  if (channel === 'sms') {
    return sendSmsTwilio(recipient, message);
  }

  return sendWhatsAppMessage(recipient, message);
}

function getTargets(dbManager, expiryDaysBefore) {
  const db = dbManager.getDb();
  const expiring = db.prepare(`
    SELECT id, name, phone, expiry_date AS expiryDate
    FROM members
    WHERE status = 'active'
      AND expiry_date BETWEEN date('now') AND date('now', @days)
    ORDER BY expiry_date ASC
  `).all({ days: `+${expiryDaysBefore} day` });

  const overdue = db.prepare(`
    SELECT id, name, phone, expiry_date AS expiryDate
    FROM members
    WHERE status = 'active'
      AND expiry_date < date('now')
    ORDER BY expiry_date ASC
  `).all();

  return {
    expiring,
    overdue
  };
}

function queueNotificationCandidates(dbManager, settings, runDate) {
  const targets = getTargets(dbManager, settings.expiryDaysBefore);
  const channel = settings.channel === 'sms' ? 'sms' : 'whatsapp';
  const queue = [
    ...targets.expiring.map((member) => ({ type: 'expiry-reminder', member })),
    ...targets.overdue.map((member) => ({ type: 'overdue-alert', member }))
  ];

  const db = dbManager.getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO notification_queue(
      dedupe_key,
      member_id,
      channel,
      recipient,
      type,
      message,
      run_date,
      status,
      retry_count,
      max_attempts,
      last_attempt_at,
      next_retry_at,
      last_error,
      created_at,
      updated_at
    )
    VALUES (
      @dedupeKey,
      @memberId,
      @channel,
      @recipient,
      @type,
      @message,
      @runDate,
      'pending',
      0,
      5,
      NULL,
      datetime('now'),
      NULL,
      datetime('now'),
      datetime('now')
    )
  `);

  let queued = 0;
  let deduped = 0;
  for (const item of queue) {
    const dedupeKey = `${runDate}:${item.type}:${item.member.id}`;
    const result = insert.run({
      dedupeKey,
      memberId: item.member.id,
      channel,
      recipient: item.member.phone,
      type: item.type,
      message: createMessage(item.type, item.member),
      runDate
    });
    if (result.changes > 0) {
      queued += 1;
    } else {
      deduped += 1;
    }
  }

  return {
    queued,
    deduped,
    totalCandidates: queue.length
  };
}

function requeueStaleProcessingNotifications(dbManager) {
  const db = dbManager.getDb();
  db.prepare(`
    UPDATE notification_queue
    SET status = 'pending',
        next_retry_at = datetime('now'),
        updated_at = datetime('now')
    WHERE status = 'processing'
      AND datetime(updated_at) <= datetime('now', '-10 minutes')
  `).run();
}

function getNextDueNotification(dbManager) {
  const db = dbManager.getDb();
  return db.prepare(`
    SELECT
      id,
      member_id AS memberId,
      channel,
      recipient,
      type,
      message,
      run_date AS runDate,
      retry_count AS retryCount,
      max_attempts AS maxAttempts
    FROM notification_queue
    WHERE status = 'pending'
      AND datetime(next_retry_at) <= datetime('now')
    ORDER BY id ASC
    LIMIT 1
  `).get();
}

function markQueueItemProcessing(dbManager, id) {
  const db = dbManager.getDb();
  db.prepare(`
    UPDATE notification_queue
    SET status = 'processing',
        last_attempt_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = @id
  `).run({ id });
}

function markQueueItemSent(dbManager, item, dispatchResult) {
  const db = dbManager.getDb();
  db.prepare(`
    UPDATE notification_queue
    SET status = 'sent',
        retry_count = @retryCount,
        last_error = NULL,
        updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id: item.id,
    retryCount: item.retryCount + 1
  });

  db.prepare(`
    INSERT INTO notification_logs(channel, recipient, message, status, error, context, created_at, updated_at)
    VALUES (@channel, @recipient, @message, @status, @error, @context, datetime('now'), datetime('now'))
  `).run({
    channel: item.channel,
    recipient: item.recipient,
    message: item.message,
    status: dispatchResult.status,
    error: null,
    context: JSON.stringify({
      memberId: item.memberId,
      type: item.type,
      runDate: item.runDate,
      provider: dispatchResult.provider || item.channel,
      providerMessageId: dispatchResult.providerMessageId || null
    })
  });
}

function markQueueItemRetry(dbManager, item, errorMessage) {
  const db = dbManager.getDb();
  const nextRetryCount = item.retryCount + 1;
  if (nextRetryCount >= item.maxAttempts) {
    db.prepare(`
      UPDATE notification_queue
      SET status = 'failed',
          retry_count = @retryCount,
          last_error = @error,
          updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id: item.id,
      retryCount: nextRetryCount,
      error: errorMessage
    });
    return;
  }

  const delaySeconds = Math.min(1800, 30 * Math.pow(2, Math.max(0, nextRetryCount - 1)));
  db.prepare(`
    UPDATE notification_queue
    SET status = 'pending',
        retry_count = @retryCount,
        next_retry_at = datetime('now', @delay),
        last_error = @error,
        updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id: item.id,
    retryCount: nextRetryCount,
    delay: `+${delaySeconds} seconds`,
    error: errorMessage
  });
}

async function processNotificationQueue(dbManager, limit = 50) {
  requeueStaleProcessingNotifications(dbManager);

  const summary = {
    processed: 0,
    sent: 0,
    simulated: 0,
    failed: 0,
    retried: 0
  };

  for (let i = 0; i < limit; i += 1) {
    const item = getNextDueNotification(dbManager);
    if (!item) {
      break;
    }

    markQueueItemProcessing(dbManager, item.id);
    summary.processed += 1;

    let result;
    try {
      result = await dispatchWithProvider(item.channel, item.recipient, item.message);
    } catch (error) {
      result = {
        status: 'failed',
        retriable: true,
        error: error instanceof Error ? error.message : 'Notification provider error',
        provider: item.channel,
        providerMessageId: null
      };
    }

    if (result.status === 'sent' || result.status === 'simulated') {
      markQueueItemSent(dbManager, item, result);
      if (result.status === 'simulated') {
        summary.simulated += 1;
      } else {
        summary.sent += 1;
      }
    } else {
      markQueueItemRetry(dbManager, item, result.error || 'Notification failed');
      if (result.retriable && item.retryCount + 1 < item.maxAttempts) {
        summary.retried += 1;
      } else {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

function getQueueStats(dbManager) {
  const db = dbManager.getDb();
  const pending = db.prepare("SELECT COUNT(1) AS total FROM notification_queue WHERE status = 'pending'").get().total;
  const processing = db.prepare("SELECT COUNT(1) AS total FROM notification_queue WHERE status = 'processing'").get().total;
  const failed = db.prepare("SELECT COUNT(1) AS total FROM notification_queue WHERE status = 'failed'").get().total;
  return {
    pending: Number(pending || 0),
    processing: Number(processing || 0),
    failed: Number(failed || 0)
  };
}

async function runNotificationSweep(dbManager, options = {}) {
  const settings = getNotificationSettings(dbManager);
  if (!settings.enabled) {
    return {
      sent: 0,
      simulated: 0,
      failed: 0,
      skipped: 0,
      queue: getQueueStats(dbManager),
      message: 'Notifications are disabled.'
    };
  }

  if (settings.dispatchMode === 'cloud' && options.force !== true) {
    return {
      sent: 0,
      simulated: 0,
      failed: 0,
      skipped: 0,
      queue: getQueueStats(dbManager),
      message: 'Notifications are configured for cloud dispatch. Local sweep skipped.'
    };
  }

  const startedAt = new Date().toISOString();
  const enqueueTargets = options.enqueueTargets !== false;
  const runDate = todayDate();
  let enqueueSummary = {
    queued: 0,
    deduped: 0,
    totalCandidates: 0
  };

  if (enqueueTargets) {
    enqueueSummary = queueNotificationCandidates(dbManager, settings, runDate);
    setSetting(dbManager, 'notification_last_sweep_at', startedAt);
  }

  const processSummary = await processNotificationQueue(dbManager, 80);
  const queue = getQueueStats(dbManager);
  const summary = {
    sent: processSummary.sent,
    simulated: processSummary.simulated,
    failed: processSummary.failed,
    skipped: enqueueSummary.deduped,
    processed: processSummary.processed,
    enqueued: enqueueSummary.queued,
    queue,
    runDate
  };

  writeAuditLog(dbManager, {
    action: 'notifications.sweep.completed',
    entity: 'notifications',
    details: summary
  });
  writeJobLog(dbManager, {
    jobName: enqueueTargets ? 'notifications.daily' : 'notifications.retry-drain',
    status: processSummary.failed > 0 ? 'failed' : 'success',
    startedAt,
    finishedAt: new Date().toISOString(),
    details: summary,
    error: processSummary.failed > 0 ? 'One or more notifications failed' : null
  });

  return summary;
}

function getNotificationHealth(dbManager) {
  const settings = getNotificationSettings(dbManager);
  const lastSweepAt = getSetting(dbManager, 'notification_last_sweep_at', '') || null;
  const today = todayDate();
  const lastSweepDate = lastSweepAt ? String(lastSweepAt).slice(0, 10) : null;

  return {
    lastSweepAt,
    staleToday: settings.dispatchMode === 'cloud' ? false : lastSweepDate !== today,
    queue: getQueueStats(dbManager)
  };
}

function listRecentNotificationLogs(dbManager, limit = 100) {
  const db = dbManager.getDb();
  return db.prepare(`
    SELECT id, channel, recipient, message, status, error, context, created_at AS createdAt
    FROM notification_logs
    ORDER BY id DESC
    LIMIT @limit
  `).all({ limit });
}

module.exports = {
  runNotificationSweep,
  processNotificationQueue,
  listRecentNotificationLogs,
  getNotificationHealth
};
