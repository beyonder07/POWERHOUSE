const path = require('node:path');
const fs = require('node:fs');
const { BrowserWindow } = require('electron');
const { toSafeFileTimeStamp, nowIso } = require('../shared/dateUtils.cjs');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInvoiceHtml(data) {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Invoice #${escapeHtml(data.invoiceNumber)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #1a1a1a; margin: 40px; }
          .top { display: flex; justify-content: space-between; margin-bottom: 22px; }
          .brand h1 { margin: 0; color: #0f4f99; }
          .muted { color: #666; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border: 1px solid #d3d3d3; padding: 10px; text-align: left; }
          th { background: #f3f6fa; }
          .total { margin-top: 16px; text-align: right; font-size: 18px; font-weight: 700; }
          .footer { margin-top: 30px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="top">
          <div class="brand">
            <h1>${escapeHtml(data.gymName)}</h1>
            <div class="muted">Membership Invoice</div>
          </div>
          <div>
            <div><strong>Invoice:</strong> ${escapeHtml(data.invoiceNumber)}</div>
            <div><strong>Date:</strong> ${escapeHtml(data.date)}</div>
          </div>
        </div>

        <div><strong>Member:</strong> ${escapeHtml(data.memberName)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(data.memberPhone)}</div>
        <div><strong>Plan:</strong> ${escapeHtml(data.planType)}</div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Payment Mode</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${escapeHtml(data.description)}</td>
              <td>${escapeHtml(data.paymentMode)}</td>
              <td>INR ${escapeHtml(data.amount.toFixed(2))}</td>
            </tr>
          </tbody>
        </table>

        <div class="total">Total: INR ${escapeHtml(data.amount.toFixed(2))}</div>
        <div class="footer">This is a system generated invoice.</div>
      </body>
    </html>
  `;
}

async function generateInvoicePdf(dbManager, payload) {
  const db = dbManager.getDb();

  const member = db.prepare(`
    SELECT id, name, phone, plan_type AS planType
    FROM members
    WHERE id = ?
  `).get(payload.memberId);

  if (!member) {
    throw new Error('Member not found for invoice generation');
  }

  const paymentDate = payload.paymentDate;
  const paymentMode = payload.paymentMode;
  const amount = Number(payload.amount || 0);
  if (!paymentDate || typeof paymentDate !== 'string') {
    throw new Error('paymentDate is required for invoice generation');
  }
  if (!paymentMode || typeof paymentMode !== 'string') {
    throw new Error('paymentMode is required for invoice generation');
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be greater than 0 for invoice generation');
  }

  const createdAt = nowIso();
  const invoiceNumber = `INV-${toSafeFileTimeStamp()}`;
  const fileName = `${invoiceNumber}.pdf`;
  const filePath = path.join(dbManager.getInvoicesDir(), fileName);

  const html = buildInvoiceHtml({
    gymName: payload.gymName || 'Gym Management System',
    invoiceNumber,
    date: paymentDate,
    memberName: member.name,
    memberPhone: member.phone,
    planType: member.planType,
    description: payload.description || 'Membership Fee',
    paymentMode,
    amount
  });

  let invoiceWindow;
  try {
    invoiceWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true
      }
    });
    await invoiceWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdfBuffer = await invoiceWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    });
    fs.writeFileSync(filePath, pdfBuffer);
  } finally {
    if (invoiceWindow && !invoiceWindow.isDestroyed()) {
      invoiceWindow.destroy();
    }
  }

  return {
    filePath,
    createdAt,
    invoiceNumber
  };
}

module.exports = { generateInvoicePdf };
