const config = require('../config');
const NotificationJob = require('../models/NotificationJob');

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseDateOnly(dateText) {
  const value = String(dateText || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDay(date) {
  return date.toISOString().slice(0, 10);
}

function isMaskedPhone(phone) {
  const value = String(phone || '').trim();
  return value.includes('*') || value.length < 8;
}

function normalizePhone(phone) {
  return String(phone || '').trim();
}

function buildMessage(type, memberName, expiryDate) {
  if (type === 'expiry-reminder') {
    return `Hi ${memberName}, your gym membership expires on ${expiryDate}. Please renew to continue uninterrupted access.`;
  }

  return `Hi ${memberName}, your gym membership expired on ${expiryDate}. Please clear dues and renew your plan.`;
}

function getDispatchTimestamp(now) {
  const scheduled = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    config.notificationDispatchHourUtc,
    0,
    0,
    0
  ));

  if (scheduled.getTime() < now.getTime()) {
    return now;
  }

  return scheduled;
}

async function sendWhatsApp(recipient, message) {
  if (!config.whatsappToken || !config.whatsappPhoneNumberId) {
    return {
      status: 'simulated',
      retriable: false,
      provider: 'whatsapp-simulated',
      providerMessageId: null,
      error: null
    };
  }

  const endpoint = `https://graph.facebook.com/${config.whatsappApiVersion}/${config.whatsappPhoneNumberId}/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: {
        body: message
      }
    })
  });

  const bodyText = await response.text();
  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch (_error) {
    bodyJson = null;
  }

  if (!response.ok) {
    return {
      status: 'failed',
      retriable: response.status >= 500 || response.status === 429,
      provider: 'whatsapp-cloud-api',
      providerMessageId: null,
      error: bodyJson && bodyJson.error && bodyJson.error.message
        ? String(bodyJson.error.message)
        : bodyText || `HTTP ${response.status}`
    };
  }

  return {
    status: 'sent',
    retriable: false,
    provider: 'whatsapp-cloud-api',
    providerMessageId: bodyJson && Array.isArray(bodyJson.messages) && bodyJson.messages[0] ? String(bodyJson.messages[0].id) : null,
    error: null
  };
}

async function sendSms(recipient, message) {
  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber) {
    return {
      status: 'simulated',
      retriable: false,
      provider: 'twilio-simulated',
      providerMessageId: null,
      error: null
    };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
  const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
  const form = new URLSearchParams();
  form.set('To', recipient);
  form.set('From', config.twilioFromNumber);
  form.set('Body', message);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form.toString()
  });

  const bodyText = await response.text();
  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch (_error) {
    bodyJson = null;
  }

  if (!response.ok) {
    return {
      status: 'failed',
      retriable: response.status >= 500 || response.status === 429,
      provider: 'twilio',
      providerMessageId: null,
      error: bodyJson && bodyJson.message
        ? String(bodyJson.message)
        : bodyText || `HTTP ${response.status}`
    };
  }

  return {
    status: 'sent',
    retriable: false,
    provider: 'twilio',
    providerMessageId: bodyJson && bodyJson.sid ? String(bodyJson.sid) : null,
    error: null
  };
}

async function dispatchNotification(channel, recipient, message) {
  if (channel === 'sms') {
    return sendSms(recipient, message);
  }

  return sendWhatsApp(recipient, message);
}

function getDaysDiff(target, base) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((target.getTime() - base.getTime()) / msPerDay);
}

function deriveNotificationType(expiryDateText, todayUtc, windowDays) {
  const expiryDate = parseDateOnly(expiryDateText);
  if (!expiryDate) {
    return null;
  }

  const daysDiff = getDaysDiff(expiryDate, todayUtc);
  if (daysDiff >= 0 && daysDiff <= windowDays) {
    return 'expiry-reminder';
  }
  if (daysDiff < 0) {
    return 'overdue-alert';
  }
  return null;
}

function getNotificationPolicy(payload) {
  const policy = payload && payload.notificationPolicy && typeof payload.notificationPolicy === 'object'
    ? payload.notificationPolicy
    : {};

  const dispatchMode = policy.dispatchMode === 'cloud' ? 'cloud' : 'desktop';
  const channel = policy.channel === 'sms' ? 'sms' : 'whatsapp';
  const enabled = Boolean(policy.enabled);
  const expiryDaysBefore = Number.isFinite(Number(policy.expiryDaysBefore))
    ? Math.max(1, Math.min(30, Math.floor(Number(policy.expiryDaysBefore))))
    : config.notificationWindowDaysDefault;

  return {
    enabled,
    dispatchMode,
    channel,
    expiryDaysBefore
  };
}

async function enqueueNotificationJobsFromSnapshot(gymId, payload) {
  if (!config.cloudNotificationsEnabled) {
    return {
      mode: 'disabled',
      queued: 0,
      deduped: 0,
      skippedMasked: 0,
      skippedInvalid: 0
    };
  }

  const policy = getNotificationPolicy(payload);
  if (!policy.enabled || policy.dispatchMode !== 'cloud') {
    return {
      mode: policy.dispatchMode,
      queued: 0,
      deduped: 0,
      skippedMasked: 0,
      skippedInvalid: 0
    };
  }

  const members = Array.isArray(payload && payload.members) ? payload.members : [];
  const now = new Date();
  const todayUtc = startOfUtcDay(now);
  const runDate = toIsoDay(todayUtc);
  const scheduledFor = getDispatchTimestamp(now);
  const maxAttempts = config.notificationMaxAttempts;

  const summary = {
    mode: policy.dispatchMode,
    queued: 0,
    deduped: 0,
    skippedMasked: 0,
    skippedInvalid: 0
  };

  for (const member of members) {
    if (!member || member.status !== 'active') {
      continue;
    }

    const memberId = Number(member.id);
    if (!Number.isFinite(memberId) || memberId <= 0) {
      summary.skippedInvalid += 1;
      continue;
    }

    const recipient = normalizePhone(member.phone);
    if (!recipient || isMaskedPhone(recipient)) {
      summary.skippedMasked += 1;
      continue;
    }

    const type = deriveNotificationType(member.expiryDate, todayUtc, policy.expiryDaysBefore);
    if (!type) {
      continue;
    }

    const memberName = String(member.name || '').trim() || `Member #${memberId}`;
    const expiryDate = String(member.expiryDate || '').trim();
    const message = buildMessage(type, memberName, expiryDate);
    const dedupeKey = `${gymId}:${runDate}:${type}:${memberId}`;

    const result = await NotificationJob.updateOne(
      { dedupeKey },
      {
        $setOnInsert: {
          gymId,
          dedupeKey,
          memberId,
          memberName,
          recipient,
          channel: policy.channel,
          type,
          expiryDate,
          payload: {
            message,
            runDate
          },
          status: 'pending',
          attempts: 0,
          maxAttempts,
          scheduledFor,
          nextAttemptAt: scheduledFor
        }
      },
      { upsert: true }
    );

    if (result && result.upsertedCount > 0) {
      summary.queued += 1;
    } else {
      summary.deduped += 1;
    }
  }

  return summary;
}

async function requeueStaleProcessingJobs() {
  const staleBefore = new Date(Date.now() - (10 * 60 * 1000));
  await NotificationJob.updateMany(
    {
      status: 'processing',
      processingStartedAt: { $lte: staleBefore }
    },
    {
      $set: {
        status: 'pending',
        nextAttemptAt: new Date(),
        processingStartedAt: null,
        updatedAt: new Date()
      }
    }
  );
}

async function claimNextDueJob() {
  const now = new Date();
  return NotificationJob.findOneAndUpdate(
    {
      status: 'pending',
      scheduledFor: { $lte: now },
      nextAttemptAt: { $lte: now }
    },
    {
      $set: {
        status: 'processing',
        processingStartedAt: now
      }
    },
    {
      sort: { nextAttemptAt: 1, createdAt: 1 },
      new: true
    }
  );
}

function nextRetryAt(attempts) {
  const baseMs = 30000;
  const maxMs = 30 * 60 * 1000;
  const backoff = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempts - 1)));
  const jitter = Math.floor(Math.random() * 1000);
  return new Date(Date.now() + backoff + jitter);
}

async function processDueNotificationJobs() {
  if (!config.cloudNotificationsEnabled) {
    return {
      processed: 0,
      sent: 0,
      simulated: 0,
      failed: 0,
      retried: 0
    };
  }

  await requeueStaleProcessingJobs();

  const summary = {
    processed: 0,
    sent: 0,
    simulated: 0,
    failed: 0,
    retried: 0
  };

  for (let i = 0; i < config.notificationBatchSize; i += 1) {
    const job = await claimNextDueJob();
    if (!job) {
      break;
    }

    summary.processed += 1;
    const attempts = Number(job.attempts || 0) + 1;

    let dispatchResult;
    try {
      dispatchResult = await dispatchNotification(job.channel, job.recipient, job.payload.message);
    } catch (error) {
      dispatchResult = {
        status: 'failed',
        retriable: true,
        provider: job.channel,
        providerMessageId: null,
        error: error instanceof Error ? error.message : 'Unexpected notification provider error'
      };
    }

    if (dispatchResult.status === 'sent' || dispatchResult.status === 'simulated') {
      await NotificationJob.updateOne(
        { _id: job._id, status: 'processing' },
        {
          $set: {
            status: 'sent',
            attempts,
            sentAt: new Date(),
            processingStartedAt: null,
            lastError: null,
            provider: dispatchResult.provider || job.channel,
            providerMessageId: dispatchResult.providerMessageId || null
          }
        }
      );

      if (dispatchResult.status === 'simulated') {
        summary.simulated += 1;
      } else {
        summary.sent += 1;
      }
      continue;
    }

    const maxAttempts = Math.max(1, Number(job.maxAttempts || config.notificationMaxAttempts));
    const canRetry = Boolean(dispatchResult.retriable) && attempts < maxAttempts;
    if (canRetry) {
      await NotificationJob.updateOne(
        { _id: job._id, status: 'processing' },
        {
          $set: {
            status: 'pending',
            attempts,
            nextAttemptAt: nextRetryAt(attempts),
            processingStartedAt: null,
            lastError: dispatchResult.error || 'Notification send failed',
            provider: dispatchResult.provider || job.channel,
            providerMessageId: dispatchResult.providerMessageId || null
          }
        }
      );
      summary.retried += 1;
      continue;
    }

    await NotificationJob.updateOne(
      { _id: job._id, status: 'processing' },
      {
        $set: {
          status: 'failed',
          attempts,
          processingStartedAt: null,
          lastError: dispatchResult.error || 'Notification send failed',
          provider: dispatchResult.provider || job.channel,
          providerMessageId: dispatchResult.providerMessageId || null
        }
      }
    );
    summary.failed += 1;
  }

  return summary;
}

function startCloudNotificationWorker(logger = console) {
  if (!config.cloudNotificationsEnabled) {
    logger.info('[cloud-notifications] worker disabled (CLOUD_NOTIFICATIONS_ENABLED is off)');
    return {
      stop() {}
    };
  }

  let running = false;
  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const summary = await processDueNotificationJobs();
      if (summary.processed > 0) {
        logger.info('[cloud-notifications] worker tick summary:', summary);
      }
    } catch (error) {
      logger.error('[cloud-notifications] worker tick failed:', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, config.notificationPollMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  void tick();

  logger.info(`[cloud-notifications] worker started (poll=${config.notificationPollMs}ms batch=${config.notificationBatchSize})`);

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = {
  enqueueNotificationJobsFromSnapshot,
  processDueNotificationJobs,
  startCloudNotificationWorker,
  getNotificationPolicy
};
