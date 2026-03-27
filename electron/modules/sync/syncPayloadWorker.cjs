const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { parentPort, workerData } = require('node:worker_threads');

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length <= 4) {
    return digits;
  }

  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function buildPayload(dbPath, options) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
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
      phone: options.maskPhone ? maskPhone(member.phone) : member.phone,
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

    const trainers = db.prepare(`
      SELECT id, name, phone, base_salary AS baseSalary, status 
      FROM trainers
      ORDER BY id ASC
    `).all().map((trainer) => ({
      id: trainer.id,
      name: trainer.name,
      phone: options.maskPhone ? maskPhone(trainer.phone) : trainer.phone,
      baseSalary: trainer.baseSalary,
      status: trainer.status
    }));

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
    `).all();

    const trainerAttendance = db.prepare(`
      SELECT 
        ta.id, 
        ta.trainer_id AS trainerId, 
        t.name AS trainerName, 
        ta.check_in_time AS checkInTime, 
        ta.date 
      FROM trainer_attendance ta
      JOIN trainers t ON t.id = ta.trainer_id
    `).all();

    const notificationPolicy = options.notificationPolicy || {
      enabled: true,
      expiryDaysBefore: 3,
      channel: 'whatsapp',
      dispatchMode: 'desktop'
    };

    const cursorFrom = options.cursorFrom || null;
    const cursorTo = options.cursorTo || new Date().toISOString();
    const generatedAt = new Date().toISOString();

    const contentHash = crypto.createHash('sha256')
      .update(JSON.stringify({ members, paymentSummaries, paymentHistory, attendance, trainers, trainerAttendance, dashboard, notificationPolicy }))
      .digest('hex');

    const idempotencyKey = `${generatedAt.slice(0, 10)}-${contentHash.slice(0, 24)}`;

    return {
      syncMode: 'full',
      generatedAt,
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
  } finally {
    db.close();
  }
}

try {
  const payload = buildPayload(workerData.dbPath, {
    maskPhone: Boolean(workerData.maskPhone),
    notificationPolicy: workerData.notificationPolicy,
    cursorFrom: workerData.cursorFrom || null,
    cursorTo: workerData.cursorTo || null
  });
  parentPort.postMessage({ ok: true, payload });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : 'Sync payload worker failed'
  });
}


