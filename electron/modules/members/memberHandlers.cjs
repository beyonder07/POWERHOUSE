const { isDateFormat } = require('../shared/dateUtils.cjs');
const { normalizePhone, normalizeText, isValidPhone } = require('../shared/validation.cjs');
const { writeAuditLog } = require('../shared/auditLog.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { requireTimeGuard } = require('../system/clockHealth.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const createMemberSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  joinDate: z.string().min(10),
  planType: z.string().min(1),
  expiryDate: z.string().min(10),
  assignedTrainerId: z.number().int().positive().nullable().optional()
});

const updateMemberStatusSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['active', 'inactive'])
});

const freezeMemberSchema = z.object({
  id: z.number().int().positive(),
  startDate: z.string().min(10),
  endDate: z.string().min(10),
  reason: z.string().max(300).optional()
});

const unfreezeMemberSchema = z.object({
  id: z.number().int().positive()
});

function calcFreezeDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function shiftDateByDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validateMemberPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Invalid payload';
  }

  const name = normalizeText(payload.name);
  const phone = normalizePhone(payload.phone);
  const planType = normalizeText(payload.planType);

  if (!name) {
    return 'Missing name';
  }

  if (!phone) {
    return 'Missing phone';
  }

  if (!isValidPhone(phone)) {
    return 'Phone must be 10 to 15 digits (optional +)';
  }

  if (!payload.joinDate || !isDateFormat(payload.joinDate)) {
    return 'joinDate must be YYYY-MM-DD';
  }

  if (!payload.expiryDate || !isDateFormat(payload.expiryDate)) {
    return 'expiryDate must be YYYY-MM-DD';
  }

  if (payload.expiryDate < payload.joinDate) {
    return 'expiryDate must be on or after joinDate';
  }

  if (!planType) {
    return 'Missing planType';
  }

  if (payload.assignedTrainerId !== undefined && payload.assignedTrainerId !== null && typeof payload.assignedTrainerId !== 'number') {
    return 'assignedTrainerId must be a number or null';
  }
  if (typeof payload.assignedTrainerId === 'number' && payload.assignedTrainerId <= 0) {
    return 'assignedTrainerId must be a positive integer';
  }

  return null;
}

function registerMemberHandlers(ipcMain, dbManager) {
  ipcMain.handle('members:list', () => {
    const db = dbManager.getDb();
    return db.prepare(`
      SELECT
        id,
        name,
        phone,
        join_date AS joinDate,
        plan_type AS planType,
        expiry_date AS expiryDate,
        status,
        assigned_trainer_id AS assignedTrainerId,
        freeze_start AS freezeStart,
        freeze_end AS freezeEnd,
        freeze_reason AS freezeReason,
        freeze_days_total AS freezeDaysTotal
      FROM members
      ORDER BY name ASC
    `).all();
  });

  registerValidatedHandler(ipcMain, 'members:create', createMemberSchema, (_event, payload) => {
    requireUnlocked(dbManager);

    const validationError = validateMemberPayload(payload);
    if (validationError) {
      throw new Error(validationError);
    }

    const db = dbManager.getDb();
    const normalizedName = normalizeText(payload.name);
    const normalizedPhone = normalizePhone(payload.phone);
    const normalizedPlanType = normalizeText(payload.planType);

    const duplicate = db.prepare('SELECT id FROM members WHERE phone = ? LIMIT 1').get(normalizedPhone);
    if (duplicate) {
      throw new Error('A member with this phone number already exists');
    }

    const createStmt = db.prepare(`
      INSERT INTO members(name, phone, join_date, plan_type, expiry_date, status, assigned_trainer_id, updated_at)
      VALUES (@name, @phone, @joinDate, @planType, @expiryDate, 'active', @assignedTrainerId, datetime('now'))
    `);

    let result;
    try {
      result = createStmt.run({
        name: normalizedName,
        phone: normalizedPhone,
        joinDate: payload.joinDate,
        planType: normalizedPlanType,
        expiryDate: payload.expiryDate,
        assignedTrainerId: payload.assignedTrainerId || null
      });
    } catch (insertError) {
      if (insertError && String(insertError.message || '').includes('UNIQUE constraint failed: members.phone')) {
        throw new Error('A member with this phone number already exists');
      }
      throw insertError;
    }

    const memberId = Number(result.lastInsertRowid);
    writeAuditLog(dbManager, {
      action: 'member.created',
      entity: 'member',
      entityId: memberId,
      details: {
        name: normalizedName,
        phone: normalizedPhone,
        planType: normalizedPlanType,
        expiryDate: payload.expiryDate
      }
    });

    return { id: memberId };
  });

  registerValidatedHandler(ipcMain, 'members:update-status', updateMemberStatusSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const db = dbManager.getDb();
    const updateStatusStmt = db.prepare(`
      UPDATE members
      SET status = @status,
          updated_at = datetime('now'),
          version = COALESCE(version, 1) + 1
      WHERE id = @id
    `);

    const result = updateStatusStmt.run({ id: payload.id, status: payload.status });
    if (result.changes > 0) {
      writeAuditLog(dbManager, {
        action: 'member.status.updated',
        entity: 'member',
        entityId: payload.id,
        details: { status: payload.status }
      });
    }

    return { updated: result.changes > 0 };
  });

  registerValidatedHandler(ipcMain, 'members:freeze', freezeMemberSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    if (!isDateFormat(payload.startDate) || !isDateFormat(payload.endDate)) {
      throw new Error('Freeze startDate/endDate must be YYYY-MM-DD');
    }
    if (payload.endDate < payload.startDate) {
      throw new Error('Freeze endDate must be on or after startDate');
    }

    const db = dbManager.getDb();
    const member = db.prepare(`
      SELECT id, expiry_date AS expiryDate
      FROM members
      WHERE id = ?
    `).get(payload.id);
    if (!member) {
      throw new Error('Member not found');
    }

    const freezeDays = calcFreezeDays(payload.startDate, payload.endDate);
    const nextExpiryDate = shiftDateByDays(member.expiryDate, freezeDays);
    const reason = normalizeText(payload.reason || '') || null;

    const result = db.prepare(`
      UPDATE members
      SET status = 'inactive',
          freeze_start = @startDate,
          freeze_end = @endDate,
          freeze_reason = @reason,
          freeze_days_total = COALESCE(freeze_days_total, 0) + @freezeDays,
          expiry_date = @expiryDate,
          updated_at = datetime('now'),
          version = COALESCE(version, 1) + 1
      WHERE id = @id
    `).run({
      id: payload.id,
      startDate: payload.startDate,
      endDate: payload.endDate,
      reason,
      freezeDays,
      expiryDate: nextExpiryDate
    });

    if (result.changes > 0) {
      writeAuditLog(dbManager, {
        action: 'member.freeze.applied',
        entity: 'member',
        entityId: payload.id,
        details: {
          startDate: payload.startDate,
          endDate: payload.endDate,
          freezeDays,
          reason
        }
      });
    }

    return {
      updated: result.changes > 0,
      freezeDays,
      expiryDate: nextExpiryDate
    };
  });

  registerValidatedHandler(ipcMain, 'members:unfreeze', unfreezeMemberSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const db = dbManager.getDb();
    const result = db.prepare(`
      UPDATE members
      SET status = 'active',
          freeze_start = NULL,
          freeze_end = NULL,
          freeze_reason = NULL,
          updated_at = datetime('now'),
          version = COALESCE(version, 1) + 1
      WHERE id = @id
    `).run({ id: payload.id });

    if (result.changes > 0) {
      writeAuditLog(dbManager, {
        action: 'member.freeze.cleared',
        entity: 'member',
        entityId: payload.id
      });
    }

    return { updated: result.changes > 0 };
  });
}

module.exports = { registerMemberHandlers };
