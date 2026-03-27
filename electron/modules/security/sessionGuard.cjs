const { getSetting, getLockTimeoutMinutes } = require('../shared/settings.cjs');

let unlocked = false;
let lastActivityTs = 0;

function isPinConfigured(dbManager) {
  const pinHash = getSetting(dbManager, 'app_pin_hash', '');
  return Boolean(pinHash);
}

function lockSession() {
  unlocked = false;
}

function unlockSession() {
  unlocked = true;
  lastActivityTs = Date.now();
}

function touchActivity() {
  lastActivityTs = Date.now();
}

function evaluateTimeout(dbManager) {
  if (!unlocked) {
    return;
  }

  const timeoutMinutes = getLockTimeoutMinutes(dbManager);
  const timeoutMs = timeoutMinutes * 60 * 1000;

  if (Date.now() - lastActivityTs > timeoutMs) {
    unlocked = false;
  }
}

function requireUnlocked(dbManager) {
  evaluateTimeout(dbManager);

  if (!isPinConfigured(dbManager)) {
    return;
  }

  if (!unlocked) {
    throw new Error('Application is locked. Enter PIN to continue.');
  }

  touchActivity();
}

function getSessionStatus(dbManager) {
  evaluateTimeout(dbManager);
  return {
    pinSet: isPinConfigured(dbManager),
    unlocked: !isPinConfigured(dbManager) || unlocked,
    lockTimeoutMinutes: getLockTimeoutMinutes(dbManager)
  };
}

module.exports = {
  lockSession,
  unlockSession,
  touchActivity,
  requireUnlocked,
  getSessionStatus,
  isPinConfigured,
  evaluateTimeout
};
