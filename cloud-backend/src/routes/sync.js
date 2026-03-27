const express = require('express');
const { z } = require('zod');
const config = require('../config');
const { verifySyncSecurity } = require('../lib/syncSecurity');
const SyncSnapshot = require('../models/SyncSnapshot');
const SyncEvent = require('../models/SyncEvent');
const SyncRequest = require('../models/SyncRequest');
const { enqueueNotificationJobsFromSnapshot } = require('../lib/cloudNotificationWorker');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

const memberSchema = z.object({
  id: z.number(),
  name: z.string(),
  phone: z.string(),
  joinDate: z.string().optional(),
  planType: z.string().optional(),
  expiryDate: z.string(),
  status: z.string(),
  assignedTrainerId: z.number().nullable().optional()
});

const paymentHistorySchema = z.object({
  id: z.number(),
  memberId: z.number(),
  memberName: z.string(),
  amount: z.number(),
  lateFee: z.number().optional(),
  paymentMode: z.string(),
  date: z.string(),
  status: z.string()
});

const paymentSummarySchema = z.object({
  memberId: z.number(),
  memberName: z.string(),
  paymentCount: z.number(),
  totalAmount: z.number(),
  totalLateFee: z.number(),
  lastPaymentDate: z.string().nullable().optional()
});

const attendanceSchema = z.object({
  id: z.number(),
  memberId: z.number(),
  memberName: z.string(),
  checkInTime: z.string(),
  date: z.string(),
  status: z.string(),
  voidedAt: z.string().nullable().optional(),
  voidReason: z.string().nullable().optional()
});

const trainerAttendanceSchema = z.object({
  id: z.number(),
  trainerId: z.number(),
  trainerName: z.string(),
  checkInTime: z.string(),
  date: z.string()
});

const trainerSchema = z.object({
  id: z.number(),
  name: z.string(),
  phone: z.string(),
  baseSalary: z.number(),
  status: z.string()
});

const dashboardSchema = z.object({
  totalMembers: z.number(),
  activeMembers: z.number(),
  revenueToday: z.number(),
  revenueMonth: z.number()
});

const notificationPolicySchema = z.object({
  enabled: z.boolean(),
  expiryDaysBefore: z.number().int().min(1).max(30),
  channel: z.enum(['whatsapp', 'sms']),
  dispatchMode: z.enum(['desktop', 'cloud'])
}).optional();

const syncPayloadSchema = z.object({
  syncMode: z.enum(['full', 'delta']).optional().default('full'),
  generatedAt: z.string(),
  cursorFrom: z.string().nullable().optional(),
  cursorTo: z.string().nullable().optional(),
  idempotencyKey: z.string().min(10).optional(),
  contentHash: z.string().min(16).optional(),
  members: z.array(memberSchema).default([]),
  paymentSummaries: z.array(paymentSummarySchema).default([]),
  paymentHistory: z.array(paymentHistorySchema).default([]),
  attendance: z.array(attendanceSchema).default([]),
  trainers: z.array(trainerSchema).default([]),
  trainerAttendance: z.array(trainerAttendanceSchema).default([]),
  dashboard: dashboardSchema,
  notificationPolicy: notificationPolicySchema
}).superRefine((payload, ctx) => {
  if (payload.syncMode === 'delta' && payload.cursorFrom && payload.cursorTo && payload.cursorFrom === payload.cursorTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cursorFrom and cursorTo cannot be equal for delta sync'
    });
  }
});

function mergeSnapshot(existingPayload, deltaPayload) {
  const baseMembers = Array.isArray(existingPayload.members) ? existingPayload.members : [];
  const baseSummaries = Array.isArray(existingPayload.paymentSummaries) ? existingPayload.paymentSummaries : [];
  const basePaymentHistory = Array.isArray(existingPayload.paymentHistory) ? existingPayload.paymentHistory : [];

  const membersMap = new Map(baseMembers.map((member) => [Number(member.id), member]));
  for (const member of deltaPayload.members || []) {
    membersMap.set(Number(member.id), member);
  }

  const summaryMap = new Map(baseSummaries.map((summary) => [Number(summary.memberId), summary]));
  for (const summary of deltaPayload.paymentSummaries || []) {
    summaryMap.set(Number(summary.memberId), summary);
  }

  const paymentHistoryMap = new Map(basePaymentHistory.map((payment) => [Number(payment.id), payment]));
  for (const payment of deltaPayload.paymentHistory || []) {
    paymentHistoryMap.set(Number(payment.id), payment);
  }

  const baseAttendance = Array.isArray(existingPayload.attendance) ? existingPayload.attendance : [];
  const attendanceMap = new Map(baseAttendance.map((att) => [Number(att.id), att]));
  for (const att of deltaPayload.attendance || []) {
    attendanceMap.set(Number(att.id), att);
  }

  const baseTrainers = Array.isArray(existingPayload.trainers) ? existingPayload.trainers : [];
  const trainersMap = new Map(baseTrainers.map((t) => [Number(t.id), t]));
  for (const t of deltaPayload.trainers || []) {
    trainersMap.set(Number(t.id), t);
  }

  const baseTrainerAttendance = Array.isArray(existingPayload.trainerAttendance) ? existingPayload.trainerAttendance : [];
  const trainerAttendanceMap = new Map(baseTrainerAttendance.map((tAtt) => [Number(tAtt.id), tAtt]));
  for (const tAtt of deltaPayload.trainerAttendance || []) {
    trainerAttendanceMap.set(Number(tAtt.id), tAtt);
  }

  return {
    generatedAt: deltaPayload.generatedAt,
    members: Array.from(membersMap.values()),
    paymentSummaries: Array.from(summaryMap.values()),
    paymentHistory: Array.from(paymentHistoryMap.values()),
    attendance: Array.from(attendanceMap.values()),
    trainers: Array.from(trainersMap.values()),
    trainerAttendance: Array.from(trainerAttendanceMap.values()),
    dashboard: deltaPayload.dashboard || existingPayload.dashboard || {
      totalMembers: 0,
      activeMembers: 0,
      revenueToday: 0,
      revenueMonth: 0
    },
    notificationPolicy: deltaPayload.notificationPolicy || existingPayload.notificationPolicy || null
  };
}

router.post('/push', authMiddleware, requireRole(['admin', 'owner']), async (req, res) => {
  if (!config.syncHmacSecret) {
    return res.status(503).json({ error: 'Sync HMAC secret is not configured on cloud backend' });
  }

  const timestampHeader = String(req.headers['x-sync-timestamp'] || '').trim();
  const signatureHeader = String(req.headers['x-sync-signature'] || '').trim();
  const idempotencyHeader = String(req.headers['x-idempotency-key'] || '').trim();
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || {});

  const verification = verifySyncSecurity({
    secret: config.syncHmacSecret,
    timestampHeader,
    signatureHeader,
    idempotencyKey: idempotencyHeader,
    rawBody
  });
  if (!verification.ok) {
    return res.status(401).json({ error: 'Invalid sync signature' });
  }

  const parsed = syncPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid sync payload', details: parsed.error.flatten() });
  }

  const gymId = req.user.gymId;
  const payload = parsed.data;
  const idempotencyKey = idempotencyHeader || payload.idempotencyKey || '';

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Missing idempotency key' });
  }

  if (payload.idempotencyKey && payload.idempotencyKey !== idempotencyHeader) {
    return res.status(400).json({ error: 'Idempotency key mismatch between header and payload' });
  }

  let syncRequestDoc = null;
  try {
    syncRequestDoc = await SyncRequest.create({
      gymId,
      idempotencyKey,
      contentHash: payload.contentHash || null,
      status: 'accepted',
      receivedAt: new Date()
    });
  } catch (error) {
    if (error && error.code === 11000) {
      const existing = await SyncRequest.findOne({ gymId, idempotencyKey }).lean();
      return res.json({
        ok: true,
        deduped: true,
        gymId,
        syncedAt: existing?.receivedAt ? new Date(existing.receivedAt).toISOString() : new Date().toISOString()
      });
    }

    throw error;
  }

  let snapshotPayload = payload;
  if (payload.syncMode === 'delta') {
    const existing = await SyncSnapshot.findOne({ gymId }).lean();
    if (!existing || !existing.payload) {
      return res.status(409).json({
        error: 'Delta sync rejected because no baseline snapshot exists. Send a full sync first.'
      });
    }

    snapshotPayload = mergeSnapshot(existing.payload, payload);
  }

  try {
    await SyncSnapshot.findOneAndUpdate(
      { gymId },
      { gymId, payload: snapshotPayload, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (syncRequestDoc) {
      await SyncRequest.deleteOne({ _id: syncRequestDoc._id }).catch(console.error);
    }
    throw error;
  }

  await SyncEvent.create({
    gymId,
    membersCount: payload.members.length,
    paymentSummaryCount: payload.paymentSummaries.length,
    receivedAt: new Date()
  });

  let notificationJobs = null;
  try {
    notificationJobs = await enqueueNotificationJobsFromSnapshot(gymId, snapshotPayload);
  } catch (error) {
    console.error('[cloud-backend] failed to enqueue notification jobs:', error);
    notificationJobs = {
      error: error instanceof Error ? error.message : 'Failed to enqueue notification jobs'
    };
  }

  return res.json({
    ok: true,
    gymId,
    syncMode: payload.syncMode || 'full',
    syncedAt: new Date().toISOString(),
    notificationJobs
  });
});

module.exports = router;


