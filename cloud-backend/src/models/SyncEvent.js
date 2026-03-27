const mongoose = require('mongoose');

const syncEventSchema = new mongoose.Schema({
  gymId: { type: String, required: true, index: true },
  membersCount: { type: Number, required: true },
  paymentSummaryCount: { type: Number, required: true },
  receivedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SyncEvent', syncEventSchema);
