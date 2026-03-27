const { todayDate, monthKey } = require('../shared/dateUtils.cjs');
const { listRecentAuditLogs } = require('../shared/auditLog.cjs');
const { getOverdueMembers } = require('../dues/duesService.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const auditRecentSchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
}).optional();

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function shiftDate(baseDate, dayOffset) {
  const next = new Date(baseDate);
  next.setUTCDate(next.getUTCDate() + dayOffset);
  return next;
}

function shiftMonth(baseDate, monthOffset) {
  return new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + monthOffset, 1));
}

function formatDateKey(date) {
  return `${date.getUTCFullYear()}-${padNumber(date.getUTCMonth() + 1)}-${padNumber(date.getUTCDate())}`;
}

function formatMonthKey(date) {
  return `${date.getUTCFullYear()}-${padNumber(date.getUTCMonth() + 1)}`;
}

function formatShortDay(dateKey) {
  const parsed = new Date(`${dateKey}T00:00:00Z`);
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function formatShortMonth(monthKeyValue) {
  const parsed = new Date(`${monthKeyValue}-01T00:00:00Z`);
  return parsed.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function fillDailyTrend(rows, days) {
  const rowMap = new Map(rows.map((row) => [row.bucket, Number(row.total || 0)]));
  const today = new Date(`${todayDate()}T00:00:00Z`);

  return Array.from({ length: days }, (_value, index) => {
    const date = shiftDate(today, index - (days - 1));
    const bucket = formatDateKey(date);
    return {
      bucket,
      label: formatShortDay(bucket),
      value: rowMap.get(bucket) || 0
    };
  });
}

function fillMonthlyTrend(rows, months) {
  const rowMap = new Map(rows.map((row) => [row.bucket, Number(row.total || 0)]));
  const current = new Date(`${monthKey()}-01T00:00:00Z`);

  return Array.from({ length: months }, (_value, index) => {
    const date = shiftMonth(current, index - (months - 1));
    const bucket = formatMonthKey(date);
    return {
      bucket,
      label: formatShortMonth(bucket),
      value: rowMap.get(bucket) || 0
    };
  });
}

function summarizeBuckets(rows) {
  return rows.map((row) => ({
    label: row.label,
    value: Number(row.total || 0)
  }));
}

function registerDashboardHandlers(ipcMain, dbManager) {
  ipcMain.handle('dashboard:overview', () => {
    const db = dbManager.getDb();
    const today = todayDate();
    const month = monthKey();

    const totalMembers = db.prepare('SELECT COUNT(1) AS total FROM members').get().total;
    const activeMembers = db.prepare("SELECT COUNT(1) AS total FROM members WHERE status = 'active'").get().total;
    const dailyRevenue = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date = ? AND voided_at IS NULL').get(today).total;
    const monthlyRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE substr(date, 1, 7) = ? AND voided_at IS NULL").get(month).total;
    const expiringSoon = db.prepare(`
      SELECT COUNT(1) AS total
      FROM members
      WHERE status = 'active'
        AND expiry_date BETWEEN date('now') AND date('now', '+7 day')
    `).get().total;
    const attendanceToday = db.prepare("SELECT COUNT(1) AS total FROM attendance WHERE date = ? AND voided_at IS NULL AND status = 'present'").get(today).total;
    const overdueMembers = getOverdueMembers(dbManager);
    const totalLateFeeExposure = overdueMembers.reduce((sum, row) => sum + row.lateFee, 0);

    return {
      totalMembers: Number(totalMembers || 0),
      activeMembers: Number(activeMembers || 0),
      dailyRevenue: Number(dailyRevenue || 0),
      monthlyRevenue: Number(monthlyRevenue || 0),
      expiringSoon: Number(expiringSoon || 0),
      attendanceToday: Number(attendanceToday || 0),
      overdueMembers: overdueMembers.length,
      lateFeeExposure: Number(totalLateFeeExposure.toFixed(2))
    };
  });

  ipcMain.handle('dashboard:trends', () => {
    const db = dbManager.getDb();

    const revenueRows = db.prepare(`
      SELECT date AS bucket, COALESCE(SUM(amount + COALESCE(late_fee, 0)), 0) AS total
      FROM payments
      WHERE date BETWEEN date('now', '-13 day') AND date('now')
        AND voided_at IS NULL
      GROUP BY date
      ORDER BY date ASC
    `).all();

    const attendanceRows = db.prepare(`
      SELECT date AS bucket, COUNT(1) AS total
      FROM attendance
      WHERE date BETWEEN date('now', '-13 day') AND date('now')
        AND voided_at IS NULL
        AND status = 'present'
      GROUP BY date
      ORDER BY date ASC
    `).all();

    const growthRows = db.prepare(`
      SELECT substr(join_date, 1, 7) AS bucket, COUNT(1) AS total
      FROM members
      WHERE join_date IS NOT NULL
        AND join_date != ''
        AND substr(join_date, 1, 7) BETWEEN strftime('%Y-%m', 'now', '-5 month') AND strftime('%Y-%m', 'now')
      GROUP BY substr(join_date, 1, 7)
      ORDER BY bucket ASC
    `).all();

    const expiringRows = db.prepare(`
      SELECT
        CASE
          WHEN julianday(expiry_date) - julianday(date('now')) BETWEEN 0 AND 7 THEN 'Next 7 days'
          WHEN julianday(expiry_date) - julianday(date('now')) BETWEEN 8 AND 14 THEN '8-14 days'
          WHEN julianday(expiry_date) - julianday(date('now')) BETWEEN 15 AND 30 THEN '15-30 days'
          ELSE 'Beyond 30 days'
        END AS label,
        COUNT(1) AS total
      FROM members
      WHERE status = 'active'
        AND expiry_date >= date('now')
      GROUP BY label
      ORDER BY CASE label
        WHEN 'Next 7 days' THEN 1
        WHEN '8-14 days' THEN 2
        WHEN '15-30 days' THEN 3
        ELSE 4
      END
    `).all();

    const paymentModeRows = db.prepare(`
      SELECT
        CASE
          WHEN COALESCE(ps.mode, p.payment_mode) = 'bank-transfer' THEN 'Bank'
          WHEN COALESCE(ps.mode, p.payment_mode) = 'upi' THEN 'UPI'
          WHEN COALESCE(ps.mode, p.payment_mode) = 'card' THEN 'Card'
          WHEN COALESCE(ps.mode, p.payment_mode) = 'cash' THEN 'Cash'
          ELSE 'Other'
        END AS label,
        COALESCE(SUM(COALESCE(ps.amount, p.amount)), 0) AS total
      FROM payments p
      LEFT JOIN payment_splits ps ON ps.payment_id = p.id
      WHERE substr(p.date, 1, 7) = ?
        AND p.voided_at IS NULL
      GROUP BY label
      ORDER BY total DESC
    `).all(monthKey());

    return {
      revenueLast14Days: fillDailyTrend(revenueRows, 14),
      attendanceLast14Days: fillDailyTrend(attendanceRows, 14),
      memberGrowthLast6Months: fillMonthlyTrend(growthRows, 6),
      expiringBuckets: summarizeBuckets(expiringRows),
      paymentModeBreakdownMonth: summarizeBuckets(paymentModeRows)
    };
  });

  ipcMain.handle('dashboard:expiring-members', () => {
    const db = dbManager.getDb();
    return db.prepare(`
      SELECT id, name, phone, expiry_date AS expiryDate, status, plan_type AS planType
      FROM members
      WHERE status = 'active'
        AND expiry_date BETWEEN date('now') AND date('now', '+7 day')
      ORDER BY expiry_date ASC
    `).all();
  });

  registerValidatedHandler(ipcMain, 'audit:recent', auditRecentSchema, (_event, payload) => {
    const limit = payload && typeof payload.limit === 'number' ? Math.max(1, Math.min(500, Math.floor(payload.limit))) : 50;
    return listRecentAuditLogs(dbManager, limit);
  });
}

module.exports = { registerDashboardHandlers };
