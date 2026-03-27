const mongoose = require('mongoose');

const attendanceAuditLogSchema = new mongoose.Schema({
  attendance_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', required: true },
  gymId: { type: String, required: true, index: true },
  action: { type: String, required: true, enum: ['CREATE', 'UPDATE', 'DELETE'] },
  old_value: { type: mongoose.Schema.Types.Mixed },
  new_value: { type: mongoose.Schema.Types.Mixed },
  changed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changed_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AttendanceAuditLog', attendanceAuditLogSchema);
