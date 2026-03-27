const { todayDate } = require('../shared/dateUtils.cjs');
const { getLateFeeSettings } = require('../shared/settings.cjs');

function toUtcDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function calculateDaysOverdue(expiryDate, referenceDate = todayDate()) {
  const expiry = toUtcDate(expiryDate);
  const reference = toUtcDate(referenceDate);
  const diffMs = reference.getTime() - expiry.getTime();
  if (diffMs <= 0) {
    return 0;
  }

  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function calculateLateFee(daysOverdue, settings) {
  if (!settings.enabled) {
    return 0;
  }

  const lateDays = Math.max(0, daysOverdue - settings.graceDays);
  if (lateDays <= 0) {
    return 0;
  }

  const fee = lateDays * settings.perDay;
  return Number(Math.min(fee, settings.maxFee).toFixed(2));
}

function calculateMemberLateFee(dbManager, member) {
  const settings = getLateFeeSettings(dbManager);
  const daysOverdue = calculateDaysOverdue(member.expiryDate);
  const lateFee = calculateLateFee(daysOverdue, settings);

  return {
    daysOverdue,
    lateFee,
    settings
  };
}

function getOverdueMembers(dbManager) {
  const db = dbManager.getDb();
  const rows = db.prepare(`
    SELECT
      id,
      name,
      phone,
      plan_type AS planType,
      expiry_date AS expiryDate,
      status
    FROM members
    WHERE status = 'active'
      AND expiry_date < date('now')
    ORDER BY expiry_date ASC
  `).all();

  return rows.map((row) => {
    const late = calculateMemberLateFee(dbManager, row);
    return {
      ...row,
      daysOverdue: late.daysOverdue,
      lateFee: late.lateFee
    };
  });
}

module.exports = {
  calculateDaysOverdue,
  calculateLateFee,
  calculateMemberLateFee,
  getOverdueMembers
};
