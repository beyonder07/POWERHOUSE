const { writeAuditLog } = require('../shared/auditLog.cjs');
const { requireUnlocked } = require('../security/sessionGuard.cjs');
const { z, registerValidatedHandler } = require('../shared/ipcValidation.cjs');

const ALLOWED_CHANNELS = new Set(['whatsapp', 'sms', 'email', 'manual']);
const ALLOWED_STATUSES = new Set(['queued', 'sent', 'failed']);
const byPaymentSchema = z.object({
  paymentId: z.number().int().positive()
});
const markSentSchema = z.object({
  invoiceId: z.number().int().positive(),
  channel: z.enum(['whatsapp', 'sms', 'email', 'manual']).optional(),
  status: z.enum(['queued', 'sent', 'failed']).optional(),
  destination: z.string().optional(),
  error: z.string().optional()
});
const dispatchHistorySchema = z.object({
  invoiceId: z.number().int().positive()
});

function normalizeNullableText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function registerInvoiceHandlers(ipcMain, dbManager) {
  ipcMain.handle('invoices:list', () => {
    const db = dbManager.getDb();
    return db.prepare(`
      SELECT
        i.id,
        i.member_id AS memberId,
        m.name AS memberName,
        i.file_path AS filePath,
        i.created_at AS createdAt,
        i.sent_count AS sentCount,
        i.last_sent_at AS lastSentAt,
        i.last_channel AS lastChannel
      FROM invoices i
      JOIN members m ON m.id = i.member_id
      ORDER BY i.id DESC
      LIMIT 200
    `).all();
  });

  registerValidatedHandler(ipcMain, 'invoices:by-payment', byPaymentSchema, (_event, payload) => {
    const db = dbManager.getDb();
    const row = db.prepare(`
      SELECT
        p.id AS paymentId,
        p.invoice_id AS invoiceId,
        i.file_path AS filePath,
        i.sent_count AS sentCount,
        i.last_sent_at AS lastSentAt,
        i.last_channel AS lastChannel
      FROM payments p
      LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.id = ?
    `).get(payload.paymentId);

    if (!row) {
      throw new Error('Payment not found');
    }

    return row;
  });

  registerValidatedHandler(ipcMain, 'invoices:mark-sent', markSentSchema, (_event, payload) => {
    requireUnlocked(dbManager);

    const channel = typeof payload.channel === 'string' ? payload.channel : 'manual';
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new Error(`channel must be one of: ${Array.from(ALLOWED_CHANNELS).join(', ')}`);
    }

    const status = typeof payload.status === 'string' ? payload.status : 'sent';
    if (!ALLOWED_STATUSES.has(status)) {
      throw new Error(`status must be one of: ${Array.from(ALLOWED_STATUSES).join(', ')}`);
    }

    const db = dbManager.getDb();
    const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(payload.invoiceId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const destination = normalizeNullableText(payload.destination);
    const errorMessage = normalizeNullableText(payload.error);
    const sentAt = status === 'sent' ? new Date().toISOString() : null;

    db.prepare(`
      INSERT INTO invoice_dispatch_logs(invoice_id, channel, destination, status, error, sent_at, created_at, updated_at)
      VALUES (@invoiceId, @channel, @destination, @status, @error, @sentAt, datetime('now'), datetime('now'))
    `).run({
      invoiceId: payload.invoiceId,
      channel,
      destination,
      status,
      error: errorMessage,
      sentAt
    });

    if (status === 'sent') {
      db.prepare(`
        UPDATE invoices
        SET sent_count = COALESCE(sent_count, 0) + 1,
            last_sent_at = @sentAt,
            last_channel = @channel,
            updated_at = datetime('now')
        WHERE id = @invoiceId
      `).run({ invoiceId: payload.invoiceId, sentAt, channel });
    }

    writeAuditLog(dbManager, {
      action: 'invoice.dispatch.logged',
      entity: 'invoice',
      entityId: payload.invoiceId,
      details: {
        channel,
        destination,
        status,
        error: errorMessage
      }
    });

    return { ok: true };
  });

  registerValidatedHandler(ipcMain, 'invoices:dispatch-history', dispatchHistorySchema, (_event, payload) => {
    const db = dbManager.getDb();
    return db.prepare(`
      SELECT
        id,
        invoice_id AS invoiceId,
        channel,
        destination,
        status,
        error,
        sent_at AS sentAt,
        created_at AS createdAt
      FROM invoice_dispatch_logs
      WHERE invoice_id = ?
      ORDER BY id DESC
      LIMIT 100
    `).all(payload.invoiceId);
  });
}

module.exports = { registerInvoiceHandlers };
