const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, required: true, enum: ['admin', 'staff', 'owner', 'trainer', 'client'], default: 'admin' },
  gymId: { type: String, required: true, index: true },
  memberId: { type: Number },
  trainerId: { type: Number },
  displayName: { type: String, trim: true },
  phone: { type: String, trim: true },
  governmentId: { type: String, trim: true },
  governmentIdVerified: { type: Boolean, default: false },
  profilePhotoUrl: { type: String, trim: true },
  planPreference: { type: String, trim: true },
  experience: { type: String, trim: true },
  passwordResetRequired: { type: Boolean, default: false },
  isPrimaryOwner: { type: Boolean, default: false },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  workoutPlan: {
    name: { type: String, trim: true },
    exercises: [{ type: String, trim: true }]
  },
  salaryLogs: [{
    month: { type: String, trim: true },
    amount: { type: Number, default: 0 },
    status: { type: String, enum: ['paid', 'pending'], default: 'pending' }
  }],
  createdAt: { type: Date, default: Date.now }
});

userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ gymId: 1, isPrimaryOwner: 1 }, { unique: true, partialFilterExpression: { isPrimaryOwner: true } });

module.exports = mongoose.model('User', userSchema);
