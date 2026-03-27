const mongoose = require('mongoose');

const syncRequestSchema = new mongoose.Schema({
  gymId: { type: String, required: true, index: true },
  idempotencyKey: { type: String, required: true },
  contentHash: { type: String, default: null },
  status: { type: String, required: true, default: 'accepted' },
  receivedAt: { type: Date, default: Date.now }
});

syncRequestSchema.index({ gymId: 1, idempotencyKey: 1 }, { unique: true });

module.exports = mongoose.model('SyncRequest', syncRequestSchema);
