const { writeAuditLog } = require('../shared/auditLog.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { requireTimeGuard } = require('../system/clockHealth.cjs');
const { todayDate } = require('../shared/dateUtils.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const createTrainerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(10),
  baseSalary: z.number().min(0)
});

const updateTrainerStatusSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['active', 'inactive'])
});

const trainerCheckInSchema = z.object({
  trainerId: z.number().int().positive()
});

function registerTrainerHandlers(ipcMain, dbManager) {
  ipcMain.handle('trainers:list', () => {
    const db = dbManager.getDb();
    return db.prepare('SELECT id, name, phone, base_salary AS baseSalary, status FROM trainers ORDER BY name ASC').all();
  });

  registerValidatedHandler(ipcMain, 'trainers:create', createTrainerSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const db = dbManager.getDb();
    
    // Check if phone already exists
    const existing = db.prepare('SELECT id FROM trainers WHERE phone = ?').get(payload.phone);
    if (existing) {
      throw new Error('Trainer with this phone already exists');
    }
    
    const result = db.prepare(`
      INSERT INTO trainers (name, phone, base_salary)
      VALUES (@name, @phone, @baseSalary)
    `).run({
      name: payload.name.trim(),
      phone: payload.phone.trim(),
      baseSalary: payload.baseSalary
    });

    const trainerId = Number(result.lastInsertRowid);
    writeAuditLog(dbManager, {
      action: 'trainer.created',
      entity: 'trainers',
      entityId: trainerId,
      details: { name: payload.name }
    });

    return { id: trainerId, success: true };
  });

  registerValidatedHandler(ipcMain, 'trainers:update-status', updateTrainerStatusSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const db = dbManager.getDb();
    db.prepare('UPDATE trainers SET status = @status, updated_at = datetime("now") WHERE id = @id')
      .run({ id: payload.id, status: payload.status });

    writeAuditLog(dbManager, {
      action: 'trainer.status_updated',
      entity: 'trainers',
      entityId: payload.id,
      details: { status: payload.status }
    });

    return { ok: true };
  });

  registerValidatedHandler(ipcMain, 'trainers:attendance-check-in', trainerCheckInSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();
    
    const db = dbManager.getDb();
    const date = todayDate();
    
    const existing = db.prepare('SELECT id FROM trainer_attendance WHERE trainer_id = ? AND date = ?').get(payload.trainerId, date);
    if (existing) {
      throw new Error('Trainer is already checked in for today');
    }
    
    const checkInTime = new Date().toISOString();
    const result = db.prepare('INSERT INTO trainer_attendance(trainer_id, check_in_time, date) VALUES (?, ?, ?)')
      .run(payload.trainerId, checkInTime, date);
      
    writeAuditLog(dbManager, {
      action: 'trainer_attendance.checked_in',
      entity: 'trainer_attendance',
      entityId: Number(result.lastInsertRowid),
      details: { trainerId: payload.trainerId }
    });
    
    return { ok: true };
  });

  ipcMain.handle('trainers:attendance-today', () => {
    const db = dbManager.getDb();
    const date = todayDate();
    return db.prepare(`
      SELECT ta.id, t.name, t.phone, ta.check_in_time AS checkInTime 
      FROM trainer_attendance ta
      JOIN trainers t ON t.id = ta.trainer_id
      WHERE ta.date = ?
      ORDER BY ta.check_in_time DESC
    `).all(date);
  });
}

module.exports = { registerTrainerHandlers };
