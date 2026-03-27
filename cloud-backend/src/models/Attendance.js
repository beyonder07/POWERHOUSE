const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  member_id: { type: Number, required: true },
  gymId: { type: String, required: true, index: true },
  date: { type: String, required: true }, 
  status: { type: String, required: true, enum: ['present', 'absent'] },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

attendanceSchema.index({ member_id: 1, date: 1, gymId: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
