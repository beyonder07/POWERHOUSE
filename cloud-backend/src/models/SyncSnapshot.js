const mongoose = require('mongoose');

const syncSnapshotSchema = new mongoose.Schema({
  gymId: { type: String, required: true, unique: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SyncSnapshot', syncSnapshotSchema);
