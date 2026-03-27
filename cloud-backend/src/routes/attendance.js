const express = require('express');
const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const AttendanceAuditLog = require('../models/AttendanceAuditLog');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

const isDateFormat = (dateStr) => /^\d{4}-\d{2}-\d{2}$/.test(dateStr);

// OWNER APIs
router.post('/owner/create', authMiddleware, requireRole(['owner']), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { member_id, date, status } = req.body;
    const gymId = req.user.gymId;
    
    if (!Number.isInteger(member_id) || !isDateFormat(date) || !['present', 'absent'].includes(status)) {
      throw new Error('Invalid input payload');
    }

    const existing = await Attendance.findOne({ member_id, date, gymId }).session(session);
    if (existing) {
      throw new Error('Attendance entry already exists for this member on this date');
    }

    const attendance = new Attendance({
      member_id,
      gymId,
      date,
      status,
      created_by: req.user.userId
    });
    await attendance.save({ session });

    const auditLog = new AttendanceAuditLog({
      attendance_id: attendance._id,
      gymId,
      action: 'CREATE',
      new_value: { status, date, member_id },
      changed_by: req.user.userId
    });
    await auditLog.save({ session });

    await session.commitTransaction();
    res.status(201).json(attendance);
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
  }
});

router.put('/owner/update', authMiddleware, requireRole(['owner']), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id, status } = req.body;
    const gymId = req.user.gymId;

    if (!['present', 'absent'].includes(status)) {
      throw new Error('Invalid status');
    }

    const attendance = await Attendance.findOne({ _id: id, gymId }).session(session);
    if (!attendance) {
      throw new Error('Attendance record not found');
    }

    const oldStatus = attendance.status;
    attendance.status = status;
    attendance.updated_by = req.user.userId;
    await attendance.save({ session });

    const auditLog = new AttendanceAuditLog({
      attendance_id: attendance._id,
      gymId,
      action: 'UPDATE',
      old_value: { status: oldStatus },
      new_value: { status },
      changed_by: req.user.userId
    });
    await auditLog.save({ session });

    await session.commitTransaction();
    res.json(attendance);
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
  }
});

router.delete('/owner/delete', authMiddleware, requireRole(['owner']), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.body;
    const gymId = req.user.gymId;

    const attendance = await Attendance.findOne({ _id: id, gymId }).session(session);
    if (!attendance) {
      throw new Error('Attendance record not found');
    }

    await Attendance.deleteOne({ _id: id, gymId }).session(session);

    const auditLog = new AttendanceAuditLog({
      attendance_id: attendance._id,
      gymId,
      action: 'DELETE',
      old_value: { status: attendance.status, date: attendance.date, member_id: attendance.member_id },
      changed_by: req.user.userId
    });
    await auditLog.save({ session });

    await session.commitTransaction();
    res.json({ ok: true, deletedId: id });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
  }
});

router.get('/owner/history', authMiddleware, requireRole(['owner']), async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const records = await Attendance.find({ gymId }).sort({ date: -1 }).lean();
    const audits = await AttendanceAuditLog.find({ gymId }).sort({ changed_at: -1 }).limit(100).lean();
    res.json({ records, audits });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// TRAINER APIs
router.get('/trainer', authMiddleware, requireRole(['owner', 'trainer']), async (req, res) => {
  try {
    const gymId = req.user.gymId;
    // Read-only, no personal data attached inherently in attendance (just member_id)
    const records = await Attendance.find({ gymId }).sort({ date: -1 }).limit(200).lean();
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CLIENT APIs
router.get('/client', authMiddleware, requireRole(['owner', 'trainer', 'client']), async (req, res) => {
  try {
    const gymId = req.user.gymId;
    const memberId = req.user.memberId; 

    if (!memberId) {
      return res.status(400).json({ error: 'No member profile linked to this account' });
    }

    const records = await Attendance.find({ gymId, member_id: memberId }).sort({ date: -1 }).lean();
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
