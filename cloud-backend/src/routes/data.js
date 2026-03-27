const express = require('express');
const { authMiddleware, requireRole } = require('../middleware/auth');
const SyncSnapshot = require('../models/SyncSnapshot');
const User = require('../models/User');
const Request = require('../models/Request');

const router = express.Router();

async function getSnapshotForGym(gymId) {
  const snapshot = await SyncSnapshot.findOne({ gymId }).lean();
  return snapshot ? snapshot.payload : null;
}

function toSafeId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function daysRemaining(expiryDate) {
  if (!expiryDate) {
    return 0;
  }

  const today = new Date(`${todayIso()}T00:00:00Z`);
  const expiry = new Date(`${expiryDate}T00:00:00Z`);
  const diffMs = expiry.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

function buildProfile(userDoc, row, fallbackRoleLabel) {
  return {
    name: userDoc?.displayName || row?.name || fallbackRoleLabel,
    phone: userDoc?.phone || row?.phone || '',
    email: userDoc?.email || '',
    governmentId: userDoc?.governmentId || '',
    governmentIdVerified: Boolean(userDoc?.governmentIdVerified),
    profilePhotoUrl: userDoc?.profilePhotoUrl || '',
    verifiedIdLocked: Boolean(userDoc?.governmentIdVerified)
  };
}

function getMembers(payload) {
  return Array.isArray(payload?.members) ? payload.members : [];
}

function getTrainers(payload) {
  return Array.isArray(payload?.trainers) ? payload.trainers : [];
}

function getAttendance(payload) {
  return Array.isArray(payload?.attendance) ? payload.attendance : [];
}

function getTrainerAttendance(payload) {
  return Array.isArray(payload?.trainerAttendance) ? payload.trainerAttendance : [];
}

function getPaymentHistory(payload) {
  return Array.isArray(payload?.paymentHistory) ? payload.paymentHistory : [];
}

function getDashboardMetrics(payload) {
  return payload?.dashboard || {};
}

function buildAttendanceCalendar(rows) {
  const currentMonth = monthKey();
  const entries = rows
    .filter((row) => String(row.date || '').startsWith(currentMonth))
    .map((row) => ({
      date: row.date,
      status: row.status === 'present' ? 'present' : 'absent'
    }));

  return {
    month: currentMonth,
    entries
  };
}

function buildUserMaps(users) {
  const byMemberId = new Map();
  const byTrainerId = new Map();

  for (const user of users) {
    if (toSafeId(user.memberId)) {
      byMemberId.set(Number(user.memberId), user);
    }
    if (toSafeId(user.trainerId)) {
      byTrainerId.set(Number(user.trainerId), user);
    }
  }

  return { byMemberId, byTrainerId };
}

function sortByDateDesc(rows, key = 'date') {
  return [...rows].sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));
}

function buildPaymentTotalsByMode(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const mode = String(row.paymentMode || 'unknown');
    buckets.set(mode, (buckets.get(mode) || 0) + Number(row.amount || 0));
  }

  return [...buckets.entries()].map(([mode, total]) => ({ mode, total }));
}

function monthRange(monthOffset) {
  const base = new Date();
  const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - monthOffset, 1));
  return monthKey(date);
}

function buildMonthlySeries(rows, key, months = 6) {
  const labels = Array.from({ length: months }, (_, index) => monthRange(months - 1 - index));
  return labels.map((label) => ({
    label,
    value: rows
      .filter((row) => String(row.date || row.joinDate || '').startsWith(label))
      .reduce((sum, row) => sum + Number(row[key] || 0), 0)
  }));
}

function buildMonthlyCountSeries(rows, field, months = 6) {
  const labels = Array.from({ length: months }, (_, index) => monthRange(months - 1 - index));
  return labels.map((label) => ({
    label,
    value: rows.filter((row) => String(row?.[field] || '').startsWith(label)).length
  }));
}

function summarizeRequestData(data) {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const summary = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'profilePhotoUrl') {
      summary.photo = value ? 'Attached' : 'Missing';
      continue;
    }

    if (Array.isArray(value)) {
      summary[key] = `${value.length} item(s)`;
      continue;
    }

    if (value && typeof value === 'object') {
      summary[key] = 'Provided';
      continue;
    }

    summary[key] = value;
  }

  return summary;
}

function buildOwnerContext(payload, users) {
  const { byMemberId, byTrainerId } = buildUserMaps(users);
  const paymentHistory = getPaymentHistory(payload);
  const attendance = getAttendance(payload);
  const trainers = getTrainers(payload);
  const trainerAttendance = getTrainerAttendance(payload);
  const members = getMembers(payload);
  const memberNameMap = new Map(members.map((member) => [Number(member.id), member.name]));

  const memberRecords = members.map((member) => {
    const linkedUser = byMemberId.get(Number(member.id));
    return {
      id: Number(member.id),
      name: member.name,
      phone: linkedUser?.phone || member.phone || '',
      email: linkedUser?.email || '',
      governmentId: linkedUser?.governmentId || '',
      governmentIdVerified: Boolean(linkedUser?.governmentIdVerified),
      profilePhotoUrl: linkedUser?.profilePhotoUrl || '',
      planType: member.planType || '',
      joinDate: member.joinDate || '',
      expiryDate: member.expiryDate || '',
      status: member.status || '',
      assignedTrainerId: member.assignedTrainerId ?? null,
      workoutPlan: linkedUser?.workoutPlan || { name: '', exercises: [] },
      payments: paymentHistory.filter((row) => Number(row.memberId) === Number(member.id)),
      attendance: attendance.filter((row) => Number(row.memberId) === Number(member.id))
    };
  });

  const trainerRecords = trainers.map((trainer) => {
    const linkedUser = byTrainerId.get(Number(trainer.id));
    const trainerRows = trainerAttendance.filter((row) => Number(row.trainerId) === Number(trainer.id));
    const currentMonthAmount = trainerRows
      .filter((row) => String(row.date || '').startsWith(monthKey()))
      .length * Number(trainer.baseSalary || 0);

    return {
      id: Number(trainer.id),
      name: trainer.name,
      phone: linkedUser?.phone || trainer.phone || '',
      email: linkedUser?.email || '',
      governmentId: linkedUser?.governmentId || '',
      governmentIdVerified: Boolean(linkedUser?.governmentIdVerified),
      profilePhotoUrl: linkedUser?.profilePhotoUrl || '',
      baseSalary: Number(trainer.baseSalary || 0),
      status: trainer.status || '',
      salaryLog: linkedUser?.salaryLogs?.length
        ? linkedUser.salaryLogs
        : [{ month: monthKey(), amount: currentMonthAmount, status: 'pending' }],
      attendance: trainerRows
    };
  });

  const attendanceRecords = attendance.map((row) => ({
    ...row,
    memberName: row.memberName || memberNameMap.get(Number(row.memberId)) || `Member #${row.memberId}`
  }));

  const paymentRecords = paymentHistory.map((row) => ({
    ...row,
    memberName: row.memberName || memberNameMap.get(Number(row.memberId)) || `Member #${row.memberId}`
  }));

  return { paymentHistory: paymentRecords, attendance: attendanceRecords, trainerAttendance, memberRecords, trainerRecords };
}

async function loadClientContext(req) {
  const memberId = toSafeId(req.user.memberId);
  if (!memberId) {
    return { error: 'No member profile linked to this account', status: 400 };
  }

  const [payload, userDoc, users] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.findById(req.user.userId).lean(),
    User.find({ gymId: req.user.gymId }).lean()
  ]);

  const member = getMembers(payload).find((row) => Number(row.id) === memberId) || null;
  const attendanceRows = sortByDateDesc(getAttendance(payload).filter((row) => Number(row.memberId) === memberId));
  const paymentHistory = sortByDateDesc(getPaymentHistory(payload).filter((row) => Number(row.memberId) === memberId));
  const trainersById = buildUserMaps(users).byTrainerId;
  const assignedTrainer = member?.assignedTrainerId
    ? getTrainers(payload).find((row) => Number(row.id) === Number(member.assignedTrainerId)) || null
    : null;
  const trainerUser = assignedTrainer ? trainersById.get(Number(assignedTrainer.id)) : null;

  return {
    memberId,
    payload,
    userDoc,
    member,
    attendanceRows,
    paymentHistory,
    membership: member ? {
      planType: member.planType || 'Membership',
      startDate: member.joinDate || '',
      expiryDate: member.expiryDate || '',
      status: member.status || 'active',
      daysRemaining: daysRemaining(member.expiryDate)
    } : null,
    workoutPlan: userDoc?.workoutPlan || { name: '', exercises: [] },
    assignedTrainer: assignedTrainer ? {
      id: Number(assignedTrainer.id),
      name: assignedTrainer.name,
      profilePhotoUrl: trainerUser?.profilePhotoUrl || ''
    } : null,
    profile: buildProfile(userDoc, member, 'Client')
  };
}

async function loadTrainerContext(req) {
  const trainerId = toSafeId(req.user.trainerId);
  if (!trainerId) {
    return { error: 'No trainer profile linked to this account', status: 400 };
  }

  const [payload, userDoc, users, myRequests] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.findById(req.user.userId).lean(),
    User.find({ gymId: req.user.gymId }).lean(),
    Request.find({ gymId: req.user.gymId, createdBy: req.user.userId }).sort({ createdAt: -1 }).limit(50).lean()
  ]);

  const { byMemberId } = buildUserMaps(users);
  const trainerRow = getTrainers(payload).find((row) => Number(row.id) === trainerId) || null;
  const assignedMembers = getMembers(payload)
    .filter((row) => Number(row.assignedTrainerId) === trainerId)
    .map((member) => {
      const linkedUser = byMemberId.get(Number(member.id));
      return {
        id: Number(member.id),
        name: member.name,
        profilePhotoUrl: linkedUser?.profilePhotoUrl || '',
        workoutPlan: linkedUser?.workoutPlan || { name: '', exercises: [] },
        membershipStatus: member.status || '',
        expiryDate: member.expiryDate || ''
      };
    });

  const assignedIds = new Set(assignedMembers.map((member) => Number(member.id)));
  const memberAttendance = sortByDateDesc(getAttendance(payload).filter((row) => assignedIds.has(Number(row.memberId))));
  const trainerAttendance = sortByDateDesc(getTrainerAttendance(payload).filter((row) => Number(row.trainerId) === trainerId));
  const currentMonth = monthKey();
  const currentMonthShifts = trainerAttendance.filter((row) => String(row.date || '').startsWith(currentMonth)).length;
  const currentMonthAmount = currentMonthShifts * Number(trainerRow?.baseSalary || 0);
  const salaryLog = userDoc?.salaryLogs?.length
    ? userDoc.salaryLogs
    : [{ month: currentMonth, amount: currentMonthAmount, status: 'pending' }];

  return {
    trainerId,
    payload,
    userDoc,
    trainerRow,
    assignedMembers,
    memberAttendance,
    trainerAttendance,
    salaryLog,
    requests: myRequests,
    profile: buildProfile(userDoc, trainerRow, 'Trainer'),
    workoutAssignments: assignedMembers.map((member) => ({
      memberId: member.id,
      memberName: member.name,
      workoutPlan: member.workoutPlan
    }))
  };
}

router.get('/client/overview', authMiddleware, requireRole(['client']), async (req, res) => {
  const context = await loadClientContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  const month = monthKey();
  const monthlyAttendance = context.attendanceRows.filter((row) => String(row.date || '').startsWith(month));

  return res.json({
    profile: context.profile,
    membership: context.membership,
    attendanceSummary: {
      month,
      presentCount: monthlyAttendance.filter((row) => row.status === 'present').length,
      totalRecorded: monthlyAttendance.length
    },
    latestPayment: context.paymentHistory[0] || null,
    workoutPlan: context.workoutPlan,
    assignedTrainer: context.assignedTrainer
  });
});

router.get('/client/profile', authMiddleware, requireRole(['client']), async (req, res) => {
  const context = await loadClientContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({ profile: context.profile });
});

router.get('/client/attendance', authMiddleware, requireRole(['client']), async (req, res) => {
  const context = await loadClientContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    calendar: buildAttendanceCalendar(context.attendanceRows),
    recent: context.attendanceRows.slice(0, 20)
  });
});

router.get('/client/payments', authMiddleware, requireRole(['client']), async (req, res) => {
  const context = await loadClientContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    items: context.paymentHistory,
    totalPaid: context.paymentHistory.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  });
});

router.get('/client/membership', authMiddleware, requireRole(['client']), async (req, res) => {
  const context = await loadClientContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({ membership: context.membership });
});

router.get('/client/workout', authMiddleware, requireRole(['client']), async (req, res) => {
  const context = await loadClientContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    workoutPlan: context.workoutPlan,
    assignedTrainer: context.assignedTrainer
  });
});

router.get('/client/dashboard', authMiddleware, requireRole(['client']), async (req, res) => {
  const context = await loadClientContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    profile: context.profile,
    attendanceCalendar: buildAttendanceCalendar(context.attendanceRows),
    attendanceRows: context.attendanceRows,
    paymentHistory: context.paymentHistory,
    membership: context.membership,
    workoutPlan: context.workoutPlan
  });
});

router.patch('/client/profile', authMiddleware, requireRole(['client']), async (req, res) => {
  const payload = {
    displayName: typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : undefined,
    phone: typeof req.body?.phone === 'string' ? req.body.phone.trim() : undefined,
    profilePhotoUrl: typeof req.body?.profilePhotoUrl === 'string' ? req.body.profilePhotoUrl.trim() : undefined
  };

  const update = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      update[key] = value;
    }
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }

  const userDoc = await User.findByIdAndUpdate(req.user.userId, { $set: update }, { new: true }).lean();
  return res.json({
    profile: buildProfile(userDoc, null, 'Client')
  });
});

router.get('/trainer/overview', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  const today = todayIso();
  const currentMonth = monthKey();

  return res.json({
    profile: context.profile,
    metrics: {
      assignedMembers: context.assignedMembers.length,
      pendingRequests: context.requests.filter((item) => item.status === 'pending').length,
      todayMemberCheckIns: context.memberAttendance.filter((row) => row.date === today && row.status === 'present').length,
      monthAttendance: context.trainerAttendance.filter((row) => String(row.date || '').startsWith(currentMonth)).length
    },
    salarySnapshot: context.salaryLog[0] || { month: currentMonth, amount: 0, status: 'pending' },
    todayCheckIns: context.memberAttendance.filter((row) => row.date === today).slice(0, 8)
  });
});

router.get('/trainer/profile', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({ profile: context.profile });
});

router.get('/trainer/members', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({ items: context.assignedMembers });
});

router.get('/trainer/workouts', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    items: context.workoutAssignments,
    memberOptions: context.assignedMembers.map((member) => ({ id: member.id, name: member.name }))
  });
});

router.get('/trainer/attendance', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    memberAttendance: context.memberAttendance,
    trainerAttendance: context.trainerAttendance
  });
});

router.get('/trainer/salary', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    currentMonth: monthKey(),
    currentAmount: context.salaryLog[0]?.amount || 0,
    items: context.salaryLog
  });
});

router.get('/trainer/requests', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({ items: context.requests });
});

router.get('/trainer/dashboard', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const context = await loadTrainerContext(req);
  if (context.error) {
    return res.status(context.status).json({ error: context.error });
  }

  return res.json({
    profile: context.profile,
    assignedMembers: context.assignedMembers,
    workoutAssignments: context.workoutAssignments,
    memberAttendance: context.memberAttendance,
    trainerAttendance: context.trainerAttendance,
    salaryLog: context.salaryLog,
    requests: context.requests
  });
});

router.patch('/trainer/profile', authMiddleware, requireRole(['trainer']), async (req, res) => {
  const payload = {
    displayName: typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : undefined,
    phone: typeof req.body?.phone === 'string' ? req.body.phone.trim() : undefined,
    profilePhotoUrl: typeof req.body?.profilePhotoUrl === 'string' ? req.body.profilePhotoUrl.trim() : undefined
  };

  const update = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      update[key] = value;
    }
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }

  const userDoc = await User.findByIdAndUpdate(req.user.userId, { $set: update }, { new: true }).lean();
  return res.json({
    profile: buildProfile(userDoc, null, 'Trainer')
  });
});

router.get('/owner/overview', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const [payload, users, requests] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.find({ gymId: req.user.gymId }).lean(),
    Request.find({ gymId: req.user.gymId }).sort({ createdAt: -1 }).limit(20).lean()
  ]);

  if (!payload) {
    return res.json({
      analytics: null,
      sync: { generatedAt: null, pendingRequests: requests.filter((item) => item.status === 'pending').length },
      expiringMembers: [],
      recentPayments: [],
      pendingApprovals: requests.filter((item) => item.status === 'pending')
    });
  }

  const ownerContext = buildOwnerContext(payload, users);
  const sanitizedRequests = requests.map((item) => ({
    ...item,
    data: summarizeRequestData(item.data)
  }));
  return res.json({
    analytics: {
      revenueToday: Number(getDashboardMetrics(payload).revenueToday || 0),
      revenueMonth: Number(getDashboardMetrics(payload).revenueMonth || 0),
      totalMembers: Number(getDashboardMetrics(payload).totalMembers || 0),
      activeMembers: Number(getDashboardMetrics(payload).activeMembers || 0),
      trainerCount: ownerContext.trainerRecords.length
    },
    sync: {
      generatedAt: payload.generatedAt || null,
      pendingRequests: requests.filter((item) => item.status === 'pending').length
    },
    expiringMembers: ownerContext.memberRecords
      .filter((member) => member.expiryDate && daysRemaining(member.expiryDate) <= 10)
      .sort((a, b) => daysRemaining(a.expiryDate) - daysRemaining(b.expiryDate))
      .slice(0, 8),
    recentPayments: sortByDateDesc(ownerContext.paymentHistory).slice(0, 8),
    pendingApprovals: sanitizedRequests.filter((item) => item.status === 'pending')
  });
});

router.get('/owner/analytics', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const [payload, users] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.find({ gymId: req.user.gymId }).lean()
  ]);

  if (!payload) {
    return res.json({ analytics: null, revenueTrend: [], memberTrend: [] });
  }

  const ownerContext = buildOwnerContext(payload, users);
  const sanitizedRequests = requests.map((item) => ({
    ...item,
    data: summarizeRequestData(item.data)
  }));
  return res.json({
    analytics: {
      revenueToday: Number(getDashboardMetrics(payload).revenueToday || 0),
      revenueMonth: Number(getDashboardMetrics(payload).revenueMonth || 0),
      totalMembers: Number(getDashboardMetrics(payload).totalMembers || 0),
      activeMembers: Number(getDashboardMetrics(payload).activeMembers || 0),
      trainerCount: ownerContext.trainerRecords.length
    },
    revenueTrend: buildMonthlySeries(ownerContext.paymentHistory, 'amount', 6),
    memberTrend: buildMonthlyCountSeries(ownerContext.memberRecords, 'joinDate', 6)
  });
});

router.get('/owner/members', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const [payload, users] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.find({ gymId: req.user.gymId }).lean()
  ]);

  if (!payload) {
    return res.json({ items: [] });
  }

  return res.json({ items: buildOwnerContext(payload, users).memberRecords });
});

router.get('/owner/trainers', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const [payload, users] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.find({ gymId: req.user.gymId }).lean()
  ]);

  if (!payload) {
    return res.json({ items: [] });
  }

  return res.json({ items: buildOwnerContext(payload, users).trainerRecords });
});

router.get('/owner/payments', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const payload = await getSnapshotForGym(req.user.gymId);
  const paymentHistory = sortByDateDesc(getPaymentHistory(payload));

  return res.json({
    items: paymentHistory,
    totalsByMode: buildPaymentTotalsByMode(paymentHistory),
    totalCollected: paymentHistory.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  });
});

router.get('/owner/attendance', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const [payload, users] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.find({ gymId: req.user.gymId }).lean()
  ]);

  if (!payload) {
    return res.json({ items: [], memberOptions: [] });
  }

  const ownerContext = buildOwnerContext(payload, users);
  return res.json({
    items: sortByDateDesc(ownerContext.attendance),
    memberOptions: ownerContext.memberRecords.map((member) => ({ id: member.id, name: member.name }))
  });
});

router.get('/owner/requests', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const items = await Request.find({ gymId: req.user.gymId }).sort({ createdAt: -1 }).lean();
  return res.json({
    items: items.map((item) => ({
      ...item,
      data: summarizeRequestData(item.data)
    })),
    pendingCount: items.filter((item) => item.status === 'pending').length
  });
});

router.get('/owner/dashboard', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const [payload, users, requests] = await Promise.all([
    getSnapshotForGym(req.user.gymId),
    User.find({ gymId: req.user.gymId }).lean(),
    Request.find({ gymId: req.user.gymId }).sort({ createdAt: -1 }).limit(50).lean()
  ]);

  if (!payload) {
    return res.json({
      analytics: null,
      members: [],
      trainers: [],
      attendance: [],
      paymentHistory: [],
      approvals: requests,
      sync: { generatedAt: null, pendingRequests: requests.filter((item) => item.status === 'pending').length }
    });
  }

  const ownerContext = buildOwnerContext(payload, users);
  return res.json({
    analytics: {
      revenueToday: Number(getDashboardMetrics(payload).revenueToday || 0),
      revenueMonth: Number(getDashboardMetrics(payload).revenueMonth || 0),
      totalMembers: Number(getDashboardMetrics(payload).totalMembers || 0),
      activeMembers: Number(getDashboardMetrics(payload).activeMembers || 0),
      memberGrowth: ownerContext.memberRecords.length,
      trainerCount: ownerContext.trainerRecords.length
    },
    members: ownerContext.memberRecords,
    trainers: ownerContext.trainerRecords,
    attendance: ownerContext.attendance,
    paymentHistory: ownerContext.paymentHistory,
    approvals: sanitizedRequests,
    sync: {
      generatedAt: payload.generatedAt || null,
      pendingRequests: sanitizedRequests.filter((item) => item.status === 'pending').length
    }
  });
});

router.get('/dashboard', authMiddleware, requireRole(['admin', 'staff', 'owner', 'trainer', 'client']), async (req, res) => {
  const payload = await getSnapshotForGym(req.user.gymId);
  if (!payload || !payload.dashboard) {
    return res.json({ dashboard: null, syncedAt: null });
  }

  const dashboard = {
    totalMembers: Number(payload.dashboard.totalMembers || 0),
    activeMembers: Number(payload.dashboard.activeMembers || 0),
    revenueToday: Number(payload.dashboard.revenueToday || 0),
    revenueMonth: Number(payload.dashboard.revenueMonth || 0)
  };

  if (req.user.role === 'trainer' || req.user.role === 'client') {
    dashboard.revenueToday = 0;
    dashboard.revenueMonth = 0;
  }

  return res.json({
    dashboard,
    syncedAt: payload.generatedAt
  });
});

module.exports = router;
