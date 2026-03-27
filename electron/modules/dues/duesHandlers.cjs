const { getOverdueMembers, calculateMemberLateFee } = require('./duesService.cjs');
const { getLateFeeSettings } = require('../shared/settings.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const memberCalculateSchema = z.object({
  memberId: z.number().int().positive()
});

function registerDuesHandlers(ipcMain, dbManager) {
  ipcMain.handle('dues:list-overdue', () => {
    return getOverdueMembers(dbManager);
  });

  ipcMain.handle('dues:summary', () => {
    const overdue = getOverdueMembers(dbManager);
    const totalLateFeeExposure = overdue.reduce((sum, row) => sum + row.lateFee, 0);

    return {
      overdueCount: overdue.length,
      totalLateFeeExposure: Number(totalLateFeeExposure.toFixed(2)),
      lateFeeSettings: getLateFeeSettings(dbManager)
    };
  });

  registerValidatedHandler(ipcMain, 'dues:calculate-member', memberCalculateSchema, (_event, payload) => {
    const db = dbManager.getDb();
    const member = db.prepare(`
      SELECT id, name, expiry_date AS expiryDate, status
      FROM members
      WHERE id = ?
    `).get(payload.memberId);

    if (!member) {
      throw new Error('Member not found');
    }

    const late = calculateMemberLateFee(dbManager, member);

    return {
      memberId: member.id,
      memberName: member.name,
      expiryDate: member.expiryDate,
      status: member.status,
      daysOverdue: late.daysOverdue,
      lateFee: late.lateFee,
      lateFeeSettings: late.settings
    };
  });
}

module.exports = { registerDuesHandlers };
