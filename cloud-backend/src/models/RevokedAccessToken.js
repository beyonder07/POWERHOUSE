const mongoose = require('mongoose');

const revokedAccessTokenSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: 'User' },
  gymId: { type: String, required: true, index: true },
  reason: { type: String, default: null },
  expiresAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RevokedAccessToken', revokedAccessTokenSchema);
