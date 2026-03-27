const fs = require('node:fs');
const { todayDate, isDateFormat } = require('../shared/dateUtils.cjs');
const { isValidPositiveAmount, normalizeText } = require('../shared/validation.cjs');
const { writeAuditLog } = require('../shared/auditLog.cjs');
const { generateInvoicePdf } = require('../invoices/invoiceService.cjs');
const { calculateMemberLateFee } = require('../dues/duesService.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { requireTimeGuard } = require('../system/clockHealth.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const ALLOWED_PAYMENT_MODES = new Set(['cash', 'upi', 'card', 'bank-transfer', 'other']);
const createPaymentSchema = z.object({
  memberId: z.number().int().positive(),
  amount: z.number().positive(),
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank-transfer', 'other']),
  date: z.string().optional(),
  notes: z.string().optional(),
  lateFee: z.number().min(0).optional(),
  applyLateFee: z.boolean().optional(),
  generateInvoice: z.boolean().optional(),
  gymName: z.string().optional(),
  description: z.string().optional(),
  splits: z.array(z.object({
    mode: z.enum(['cash', 'upi', 'card', 'bank-transfer', 'other']),
    amount: z.number().positive()
  })).max(6).optional()
});
const voidPaymentSchema = z.object({
  paymentId: z.number().int().positive(),
  reason: z.string().min(1)
});

const zReportSchema = z.object({
  date: z.string().min(10).optional()
}).optional();

function validateCreatePaymentPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'Invalid payload';
  }

  if (typeof payload.memberId !== 'number' || !Number.isInteger(payload.memberId) || payload.memberId <= 0) {
    return 'Invalid memberId';
  }

  if (!isValidPositiveAmount(payload.amount)) {
    return 'amount must be greater than 0';
  }

  if (typeof payload.paymentMode !== 'string' || !ALLOWED_PAYMENT_MODES.has(payload.paymentMode)) {
    return `paymentMode must be one of ${Array.from(ALLOWED_PAYMENT_MODES).join(', ')}`;
  }

  if (payload.date && !isDateFormat(payload.date)) {
    return 'date must be YYYY-MM-DD';
  }

  if (payload.lateFee !== undefined) {
    if (typeof payload.lateFee !== 'number' || !Number.isFinite(payload.lateFee) || payload.lateFee < 0) {
      return 'lateFee must be a positive number or 0';
    }
  }

  return null;
}

function registerPaymentHandlers(ipcMain, dbManager) {
  ipcMain.handle('payments:list', () => {
    const db = dbManager.getDb();
    return db.prepare(`
      SELECT
        p.id,
        p.member_id AS memberId,
        m.name AS memberName,
        p.amount,
        p.late_fee AS lateFee,
        p.payment_mode AS paymentMode,
        p.date,
        p.invoice_id AS invoiceId,
        i.file_path AS invoicePath,
        p.notes,
        p.voided_at AS voidedAt,
        p.void_reason AS voidReason,
        p.created_at AS createdAt
      FROM payments p
      JOIN members m ON m.id = p.member_id
      LEFT JOIN invoices i ON i.id = p.invoice_id
      ORDER BY p.id DESC
      LIMIT 200
    `).all();
  });

  ipcMain.handle('payments:summary', () => {
    const db = dbManager.getDb();
    const today = todayDate();
    const month = today.slice(0, 7);

    const daily = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE date = ?').get(today);
    const monthly = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE substr(date, 1, 7) = ?").get(month);
    const count = db.prepare('SELECT COUNT(1) AS total FROM payments').get();
    const dailyLateFee = db.prepare('SELECT COALESCE(SUM(late_fee), 0) AS total FROM payments WHERE date = ?').get(today);
    const monthlyLateFee = db.prepare("SELECT COALESCE(SUM(late_fee), 0) AS total FROM payments WHERE substr(date, 1, 7) = ?").get(month);

    return {
      dailyRevenue: Number(daily.total || 0),
      monthlyRevenue: Number(monthly.total || 0),
      totalPayments: Number(count.total || 0),
      dailyLateFeeCollected: Number(dailyLateFee.total || 0),
      monthlyLateFeeCollected: Number(monthlyLateFee.total || 0)
    };
  });

  registerValidatedHandler(ipcMain, 'payments:create', createPaymentSchema, async (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const error = validateCreatePaymentPayload(payload);
    if (error) {
      throw new Error(error);
    }

    const db = dbManager.getDb();

    const member = db.prepare(`
      SELECT id, name, expiry_date AS expiryDate
      FROM members
      WHERE id = ?
    `).get(payload.memberId);
    if (!member) {
      throw new Error('Member not found');
    }

    const insertPayment = db.prepare(`
      INSERT INTO payments(member_id, amount, late_fee, payment_mode, date, invoice_id, notes, created_at, updated_at)
      VALUES (@memberId, @amount, @lateFee, @paymentMode, @date, NULL, @notes, datetime('now'), datetime('now'))
    `);
    const insertInvoice = db.prepare(`
      INSERT INTO invoices(member_id, file_path, created_at)
      VALUES (@memberId, @filePath, @createdAt)
    `);
    const updatePaymentInvoice = db.prepare(`
      UPDATE payments
      SET invoice_id = @invoiceId,
          updated_at = datetime('now'),
          version = COALESCE(version, 1) + 1
      WHERE id = @paymentId
    `);
    const insertSplit = db.prepare(`
      INSERT INTO payment_splits(payment_id, mode, amount, created_at)
      VALUES (@paymentId, @mode, @amount, datetime('now'))
    `);

    const paymentDate = payload.date || todayDate();
    const normalizedNotes = normalizeText(payload.notes || '');
    const calculatedLateFee = payload.applyLateFee ? calculateMemberLateFee(dbManager, member).lateFee : 0;
    const lateFee = Number(payload.lateFee ?? calculatedLateFee);

    if (!Number.isFinite(lateFee) || lateFee < 0) {
      throw new Error('Invalid late fee value');
    }

    if (payload.amount < lateFee) {
      throw new Error('Total amount must be equal to or greater than late fee');
    }

    let normalizedSplits;
    if (Array.isArray(payload.splits) && payload.splits.length > 0) {
      const splitTotal = payload.splits.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (Math.abs(splitTotal - payload.amount) > 0.009) {
        throw new Error('Split payment total must match payment amount');
      }
      normalizedSplits = payload.splits.map((item) => ({
        mode: item.mode,
        amount: Number(item.amount)
      }));
    } else {
      normalizedSplits = [{
        mode: payload.paymentMode,
        amount: Number(payload.amount)
      }];
    }

    let generatedInvoice = null;

    if (payload.generateInvoice) {
      generatedInvoice = await generateInvoicePdf(dbManager, {
        memberId: payload.memberId,
        paymentDate,
        paymentMode: payload.paymentMode,
        amount: payload.amount,
        gymName: payload.gymName,
        description: payload.description
      });
    }

    const createPaymentTx = db.transaction((input) => {
      const insertResult = insertPayment.run({
        memberId: payload.memberId,
        amount: payload.amount,
        lateFee,
        paymentMode: payload.paymentMode,
        date: paymentDate,
        notes: normalizedNotes || null
      });
      const paymentId = Number(insertResult.lastInsertRowid);
      for (const split of normalizedSplits) {
        insertSplit.run({
          paymentId,
          mode: split.mode,
          amount: split.amount
        });
      }

      let invoiceId = null;
      let invoicePath = null;
      if (input.generatedInvoice) {
        const invoiceResult = insertInvoice.run({
          memberId: payload.memberId,
          filePath: input.generatedInvoice.filePath,
          createdAt: input.generatedInvoice.createdAt
        });
        invoiceId = Number(invoiceResult.lastInsertRowid);
        invoicePath = input.generatedInvoice.filePath;
        updatePaymentInvoice.run({ invoiceId, paymentId });
      }

      writeAuditLog(dbManager, {
        action: 'payment.created',
        entity: 'payment',
        entityId: paymentId,
        details: {
          memberId: payload.memberId,
          amount: payload.amount,
          lateFee,
          paymentMode: payload.paymentMode,
          splits: normalizedSplits,
          date: paymentDate,
          invoiceGenerated: Boolean(input.generatedInvoice)
        }
      });

      return {
        id: paymentId,
        lateFee,
        invoiceId,
        invoicePath,
        invoiceError: null
      };
    });

    try {
      return createPaymentTx({ generatedInvoice });
    } catch (txError) {
      if (generatedInvoice && generatedInvoice.filePath && fs.existsSync(generatedInvoice.filePath)) {
        fs.rmSync(generatedInvoice.filePath, { force: true });
      }
      throw txError;
    }
  });

  registerValidatedHandler(ipcMain, 'payments:void', voidPaymentSchema, (_event, payload) => {
    requireUnlocked(dbManager);
    requireTimeGuard();

    const voidReason = normalizeText(payload.reason || '');
    if (!voidReason) {
      throw new Error('Void reason is required');
    }

    const db = dbManager.getDb();
    const target = db.prepare(`
      SELECT id, member_id AS memberId, amount, late_fee AS lateFee, payment_mode AS paymentMode, date, notes, voided_at AS voidedAt
      FROM payments
      WHERE id = ?
    `).get(payload.paymentId);

    if (!target) {
      throw new Error('Payment not found');
    }
    if (target.voidedAt) {
      throw new Error('Payment is already voided');
    }

    const insertReversal = db.prepare(`
      INSERT INTO payments(member_id, amount, late_fee, payment_mode, date, invoice_id, notes, created_at, updated_at)
      VALUES (@memberId, @amount, @lateFee, @paymentMode, @date, NULL, @notes, datetime('now'), datetime('now'))
    `);
    const markVoided = db.prepare(`
      UPDATE payments
      SET voided_at = datetime('now'),
          void_reason = @voidReason,
          updated_at = datetime('now'),
          version = COALESCE(version, 1) + 1
      WHERE id = @paymentId
    `);

    const voidTx = db.transaction(() => {
      const reversal = insertReversal.run({
        memberId: target.memberId,
        amount: -Math.abs(Number(target.amount || 0)),
        lateFee: -Math.abs(Number(target.lateFee || 0)),
        paymentMode: 'other',
        date: todayDate(),
        notes: `Reversal for payment #${target.id}. Reason: ${voidReason}`
      });

      markVoided.run({
        paymentId: target.id,
        voidReason
      });

      const reversalPaymentId = Number(reversal.lastInsertRowid);
      writeAuditLog(dbManager, {
        action: 'payment.voided',
        entity: 'payment',
        entityId: target.id,
        details: {
          reason: voidReason,
          reversalPaymentId
        }
      });

      return {
        ok: true,
        paymentId: target.id,
        reversalPaymentId
      };
    });

    return voidTx();
  });

  registerValidatedHandler(ipcMain, 'payments:z-report', zReportSchema, (_event, payload) => {
    const db = dbManager.getDb();
    const date = payload?.date || todayDate();

    const rows = db.prepare(`
      SELECT 
        s.mode as mode,
        COUNT(DISTINCT p.id) as count,
        COALESCE(SUM(s.amount), 0) as total
      FROM payment_splits s
      INNER JOIN payments p ON p.id = s.payment_id
      WHERE p.date = ? AND p.voided_at IS NULL
      GROUP BY s.mode
    `).all(date);

    let cashTotal = 0;
    let digitalTotal = 0;
    let grandTotal = 0;
    let count = 0;

    for (const row of rows) {
      grandTotal += row.total;
      count += row.count;
      if (row.mode === 'cash') {
        cashTotal += row.total;
      } else {
        digitalTotal += row.total;
      }
    }

    return {
      date,
      rows,
      cashTotal,
      digitalTotal,
      grandTotal,
      count
    };
  });
}

module.exports = {
  registerPaymentHandlers,
  ALLOWED_PAYMENT_MODES
};
