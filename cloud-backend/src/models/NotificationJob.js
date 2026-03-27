const mongoose = require('mongoose');

const notificationJobSchema = new mongoose.Schema({
  gymId: { type: String, required: true, index: true },
  dedupeKey: { type: String, required: true, unique: true },
  memberId: { type: Number, required: true },
  memberName: { type: String, required: true },
  recipient: { type: String, required: true },
  channel: { type: String, enum: ['whatsapp', 'sms'], required: true },
  type: { type: String, enum: ['expiry-reminder', 'overdue-alert'], required: true },
  expiryDate: { type: String, required: true },
  payload: {
    message: { type: String, required: true },
    runDate: { type: String, required: true }
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'sent', 'failed', 'skipped'],
    default: 'pending',
    index: true
  },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  scheduledFor: { type: Date, required: true, index: true },
  nextAttemptAt: { type: Date, required: true, index: true },
  processingStartedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  provider: { type: String, default: null },
  providerMessageId: { type: String, default: null }
}, {
  timestamps: true
});

notificationJobSchema.index({ status: 1, nextAttemptAt: 1, scheduledFor: 1 });
notificationJobSchema.index({ gymId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationJob', notificationJobSchema);
