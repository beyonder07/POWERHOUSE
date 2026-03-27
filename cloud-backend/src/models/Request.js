const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  gymId: { type: String, required: true, index: true },
  type: {
    type: String,
    required: true,
    enum: ['client', 'trainer', 'member', 'payment', 'enrollment', 'workout-plan', 'trainer-attendance']
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByRole: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  reviewNote: { type: String, trim: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

requestSchema.index({ gymId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Request', requestSchema);
