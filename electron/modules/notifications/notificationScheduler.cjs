const cron = require('node-cron');
const { runNotificationSweep } = require('./notificationService.cjs');
const { getNotificationSettings, getSetting } = require('../shared/settings.cjs');

function shouldRunLocally(dbManager) {
  const settings = getNotificationSettings(dbManager);
  return settings.dispatchMode !== 'cloud';
}

async function runStartupCatchUp(dbManager, logger = console) {
  if (!shouldRunLocally(dbManager)) {
    logger.info('[notifications] startup catch-up skipped (dispatch mode = cloud)');
    return;
  }

  const lastSweepAt = getSetting(dbManager, 'notification_last_sweep_at', '') || '';
  const today = new Date().toISOString().slice(0, 10);
  const lastSweepDate = lastSweepAt ? String(lastSweepAt).slice(0, 10) : null;

  if (lastSweepDate === today) {
    return;
  }

  try {
    const result = await runNotificationSweep(dbManager);
    logger.info('[notifications] startup catch-up sweep:', result);
  } catch (error) {
    logger.error('[notifications] startup catch-up failed:', error);
  }
}

function scheduleNotifications(dbManager, logger = console) {
  void runStartupCatchUp(dbManager, logger);

  const daily = cron.schedule('0 9 * * *', async () => {
    if (!shouldRunLocally(dbManager)) {
      logger.info('[notifications] scheduled sweep skipped (dispatch mode = cloud)');
      return;
    }

    try {
      const result = await runNotificationSweep(dbManager);
      logger.info('[notifications] Daily sweep:', result);
    } catch (error) {
      logger.error('[notifications] sweep failed:', error);
    }
  });

  const retryDrain = cron.schedule('*/15 * * * *', async () => {
    if (!shouldRunLocally(dbManager)) {
      return;
    }

    try {
      const result = await runNotificationSweep(dbManager, { enqueueTargets: false });
      if ((result.processed || 0) > 0 || (result.failed || 0) > 0) {
        logger.info('[notifications] retry drain:', result);
      }
    } catch (error) {
      logger.error('[notifications] retry drain failed:', error);
    }
  });

  return {
    stop() {
      daily.stop();
      retryDrain.stop();
    }
  };
}

module.exports = {
  scheduleNotifications
};
