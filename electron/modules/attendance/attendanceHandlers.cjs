const { todayDate } = require('../shared/dateUtils.cjs');
const { writeAuditLog } = require('../shared/auditLog.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { requireTimeGuard } = require('../system/clockHealth.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const checkInSchema = z.object({
  memberId: z.number().int().positive()
});
const voidAttendanceSchema = z.object({
  attendanceId: z.number().int().positive(),
  reason: z.string().min(1)
});

function registerAttendanceHandlers(ipcMain, dbManager) {
  registerValidatedHandler(ipcMain, 'attendance:check-in', checkInSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const db = dbManager.getDb();
    const member = db.prepare('SELECT id, status, name, freeze_start AS freezeStart, freeze_end AS freezeEnd FROM members WHERE id = ?').get(payload.memberId);
    if (!member) {
      throw new Error('Member not found');
    }

    if (member.status !== 'active') {
      throw new Error('Only active members can check in');
    }
    const date = todayDate();
    if (member.freezeStart && member.freezeEnd && date >= member.freezeStart && date <= member.freezeEnd) {
      throw new Error('Member is currently on freeze and cannot check in');
    }
    const existing = db.prepare('SELECT id FROM attendance WHERE member_id = ? AND date = ? LIMIT 1').get(payload.memberId, date);
    if (existing) {
      throw new Error('Member is already checked in for today');
    }

    const checkInTime = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO attendance(member_id, check_in_time, date, status)
      VALUES (@memberId, @checkInTime, @date, 'present')
    `).run({
      memberId: payload.memberId,
      checkInTime,
      date
    });

    const attendanceId = Number(result.lastInsertRowid);
    writeAuditLog(dbManager, {
      action: 'attendance.checked_in',
      entity: 'attendance',
      entityId: attendanceId,
      details: {
        memberId: payload.memberId,
        date,
        checkInTime
      }
    });

    return {
      id: attendanceId,
      date,
      checkInTime
    };
  });

  ipcMain.handle('attendance:today', () => {
    const db = dbManager.getDb();
    const date = todayDate();

    const rows = db.prepare(`
      SELECT a.id, a.member_id AS memberId, m.name AS memberName, m.phone AS phone, a.check_in_time AS checkInTime, a.date, a.status, a.voided_at AS voidedAt, a.void_reason AS voidReason
      FROM attendance a
      JOIN members m ON m.id = a.member_id
      WHERE a.date = ? AND a.voided_at IS NULL
      ORDER BY a.check_in_time DESC
    `).all(date);

    return {
      date,
      total: rows.length,
      rows
    };
  });

  registerValidatedHandler(ipcMain, 'attendance:void', voidAttendanceSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const db = dbManager.getDb();
    const target = db.prepare('SELECT id, member_id AS memberId, date, status, voided_at FROM attendance WHERE id = ?').get(payload.attendanceId);
    
    if (!target) {
      throw new Error('Attendance record not found');
    }
    if (target.voided_at) {
      throw new Error('Attendance is already voided');
    }

    const markVoided = db.prepare(`
      UPDATE attendance
      SET voided_at = datetime('now'),
          void_reason = @reason,
          status = 'absent',
          updated_at = datetime('now')
      WHERE id = @id
    `);

    const voidTx = db.transaction(() => {
      markVoided.run({ id: target.id, reason: payload.reason });

      writeAuditLog(dbManager, {
        action: 'attendance.voided',
        entity: 'attendance',
        entityId: target.id,
        details: { memberId: target.memberId, date: target.date, reason: payload.reason }
      });

      return { ok: true, attendanceId: target.id };
    });

    return voidTx();
  });
}

module.exports = { registerAttendanceHandlers };
