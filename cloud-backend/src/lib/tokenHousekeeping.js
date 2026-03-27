const RefreshToken = require('../models/RefreshToken');
const RevokedAccessToken = require('../models/RevokedAccessToken');

function startTokenHousekeeping(logger = console) {
  const run = async () => {
    try {
      const now = new Date();
      const [expiredRefresh, expiredRevoked] = await Promise.all([
        RefreshToken.deleteMany({
          $or: [
            { expiresAt: { $lte: now } },
            { revokedAt: { $ne: null }, createdAt: { $lte: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000) } }
          ]
        }),
        RevokedAccessToken.deleteMany({ expiresAt: { $lte: now } })
      ]);

      const refreshCount = expiredRefresh && typeof expiredRefresh.deletedCount === 'number' ? expiredRefresh.deletedCount : 0;
      const revokedCount = expiredRevoked && typeof expiredRevoked.deletedCount === 'number' ? expiredRevoked.deletedCount : 0;
      if (refreshCount > 0 || revokedCount > 0) {
        logger.info('[auth] token housekeeping removed', { refreshCount, revokedCount });
      }
    } catch (error) {
      logger.error('[auth] token housekeeping failed', error);
    }
  };

  const timer = setInterval(() => {
    void run();
  }, 60 * 60 * 1000);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  void run();

  return {
    stop() {
      clearInterval(timer);
    }
  };
}

module.exports = {
  startTokenHousekeeping
};
