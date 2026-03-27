const mongoose = require('mongoose');

const passwordResetOtpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gymId: { type: String, required: true, index: true },
  role: { type: String, required: true, enum: ['owner', 'trainer', 'client'] },
  destinationType: { type: String, required: true, enum: ['phone', 'email'] },
  destinationMasked: { type: String, required: true },
  codeHash: { type: String, required: true },
  resetTokenHash: { type: String },
  expiresAt: { type: Date, required: true, index: true },
  verifiedAt: { type: Date },
  consumedAt: { type: Date },
  attempts: { type: Number, default: 0 }
}, {
  timestamps: true
});

passwordResetOtpSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('PasswordResetOtp', passwordResetOtpSchema);
