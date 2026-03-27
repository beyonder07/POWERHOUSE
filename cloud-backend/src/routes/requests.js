const express = require('express');
const crypto = require('node:crypto');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const Request = require('../models/Request');
const User = require('../models/User');
const SyncSnapshot = require('../models/SyncSnapshot');
const { authMiddleware, optionalAuthMiddleware, requireRole } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

const publicImageSchema = z.string().trim().refine((value) => /^data:image\/(png|jpe?g|webp);base64,/i.test(value), {
  message: 'Profile photo must be a valid image upload.'
}).refine((value) => Buffer.byteLength(value, 'utf8') <= 2_800_000, {
  message: 'Profile photo exceeds the maximum size.'
});

const clientSignupSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  email: z.string().email(),
  governmentId: z.string().trim().min(4).max(60),
  profilePhotoUrl: publicImageSchema,
  planPreference: z.string().trim().max(120).optional(),
  gymId: z.string().trim().min(1).optional()
});

const trainerSignupSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  email: z.string().email(),
  governmentId: z.string().trim().min(4).max(60),
  profilePhotoUrl: publicImageSchema,
  experience: z.string().trim().max(240).optional(),
  gymId: z.string().trim().min(1).optional()
});

const memberRequestSchema = clientSignupSchema.extend({
  notes: z.string().trim().max(500).optional()
});

const authedRequestSchema = z.object({
  type: z.enum(['member', 'payment', 'enrollment', 'workout-plan', 'trainer-attendance']),
  data: z.record(z.any())
});

const publicRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('client'), data: clientSignupSchema }),
  z.object({ type: z.literal('trainer'), data: trainerSignupSchema })
]);

const reviewRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().trim().max(500).optional()
});

const directMemberCreateSchema = memberRequestSchema.extend({
  sendResetInstructions: z.boolean().optional()
});

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function getSnapshotForGym(gymId) {
  const snapshot = await SyncSnapshot.findOne({ gymId }).lean();
  return snapshot ? snapshot.payload : null;
}

async function nextMappedId(gymId, roleType) {
  const [users, payload] = await Promise.all([
    User.find({ gymId }).select(roleType === 'client' ? 'memberId' : 'trainerId').lean(),
    getSnapshotForGym(gymId)
  ]);

  const syncedItems = roleType === 'client'
    ? Array.isArray(payload?.members) ? payload.members : []
    : Array.isArray(payload?.trainers) ? payload.trainers : [];

  const syncedMax = syncedItems.reduce((max, item) => {
    const current = Number(item?.id || 0);
    return current > max ? current : max;
  }, 0);

  const userMax = users.reduce((max, user) => {
    const current = Number(roleType === 'client' ? user.memberId : user.trainerId) || 0;
    return current > max ? current : max;
  }, 0);

  return Math.max(syncedMax, userMax) + 1;
}

async function ensurePublicRequestAllowed(type, data) {
  const phone = normalizePhone(data.phone);
  const email = normalizeEmail(data.email);
  const existingUser = await User.findOne({
    $or: [{ phone }, { email }]
  }).lean();

  if (existingUser) {
    return { error: 'An account already exists with this phone number or email.' };
  }

  const pendingRequest = await Request.findOne({
    type,
    status: 'pending',
    $or: [{ 'data.phone': phone }, { 'data.email': email }]
  }).lean();

  if (pendingRequest) {
    return { error: 'A pending request already exists for this phone number or email.' };
  }

  return { phone, email };
}

async function createMemberAccount({
  gymId,
  data,
  reviewerId
}) {
  const phone = normalizePhone(data?.phone);
  const email = normalizeEmail(data?.email);
  const displayName = String(data?.fullName || '').trim();

  const duplicate = await User.findOne({
    $or: [{ phone }, { email }]
  }).lean();
  if (duplicate) {
    throw new Error('An account already exists for this request.');
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const userPayload = {
    email,
    phone,
    passwordHash,
    role: 'client',
    gymId,
    displayName,
    governmentId: String(data?.governmentId || '').trim(),
    profilePhotoUrl: String(data?.profilePhotoUrl || '').trim(),
    planPreference: String(data?.planPreference || '').trim(),
    passwordResetRequired: true,
    approvedBy: reviewerId
  };

  userPayload.memberId = await nextMappedId(gymId, 'client');

  const user = await User.create(userPayload);
  return user;
}

async function approveOnboardingRequest(request, reviewerId) {
  const role = request.type;
  const phone = normalizePhone(request.data?.phone);
  const email = normalizeEmail(request.data?.email);
  const displayName = String(request.data?.fullName || '').trim();
  const gymId = request.gymId;

  if (role === 'member') {
    return createMemberAccount({ gymId, data: request.data, reviewerId });
  }

  const duplicate = await User.findOne({
    $or: [{ phone }, { email }]
  }).lean();
  if (duplicate) {
    throw new Error('An account already exists for this request.');
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const userPayload = {
    email,
    phone,
    passwordHash,
    role,
    gymId,
    displayName,
    governmentId: String(request.data?.governmentId || '').trim(),
    profilePhotoUrl: String(request.data?.profilePhotoUrl || '').trim(),
    planPreference: role === 'client' ? String(request.data?.planPreference || '').trim() : '',
    experience: role === 'trainer' ? String(request.data?.experience || '').trim() : '',
    passwordResetRequired: true,
    approvedBy: reviewerId
  };

  if (role === 'client') {
    userPayload.memberId = await nextMappedId(gymId, 'client');
  }
  if (role === 'trainer') {
    userPayload.trainerId = await nextMappedId(gymId, 'trainer');
  }

  const user = await User.create(userPayload);
  return user;
}

router.post('/', optionalAuthMiddleware, async (req, res) => {
  if (req.user) {
    const parsed = authedRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    if (!['trainer', 'client'].includes(req.user.role)) {
      return res.status(403).json({ error: 'This role cannot create requests here' });
    }

    const allowedTypes = req.user.role === 'trainer'
      ? new Set(['member', 'workout-plan', 'trainer-attendance'])
      : new Set(['enrollment']);

    if (!allowedTypes.has(parsed.data.type)) {
      return res.status(403).json({ error: 'This role cannot create that request type' });
    }

    if (parsed.data.type === 'member') {
      const memberParsed = memberRequestSchema.safeParse(parsed.data.data);
      if (!memberParsed.success) {
        return res.status(400).json({ error: 'Invalid payload', details: memberParsed.error.flatten() });
      }

      const allow = await ensurePublicRequestAllowed('member', memberParsed.data);
      if (allow.error) {
        return res.status(409).json({ error: allow.error });
      }

      const request = await Request.create({
        gymId: req.user.gymId,
        type: parsed.data.type,
        createdBy: req.user.userId,
        createdByRole: req.user.role,
        data: {
          ...memberParsed.data,
          phone: allow.phone,
          email: allow.email
        },
        status: 'pending'
      });

      return res.status(201).json({ request });
    }

    const request = await Request.create({
      gymId: req.user.gymId,
      type: parsed.data.type,
      createdBy: req.user.userId,
      createdByRole: req.user.role,
      data: parsed.data.data,
      status: 'pending'
    });

    return res.status(201).json({ request });
  }

  const parsed = publicRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const allow = await ensurePublicRequestAllowed(parsed.data.type, parsed.data.data);
  if (allow.error) {
    return res.status(409).json({ error: allow.error });
  }

  const request = await Request.create({
    gymId: parsed.data.data.gymId || config.publicGymId,
    type: parsed.data.type,
    createdByRole: 'public',
    data: {
      ...parsed.data.data,
      phone: allow.phone,
      email: allow.email
    },
    status: 'pending'
  });

  return res.status(201).json({
    requestId: String(request._id),
    message: 'Request sent. Waiting for approval.'
  });
});

router.post('/direct-member', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const parsed = directMemberCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const allow = await ensurePublicRequestAllowed('member', parsed.data);
  if (allow.error) {
    return res.status(409).json({ error: allow.error });
  }

  try {
    const user = await createMemberAccount({
      gymId: req.user.gymId,
      reviewerId: req.user.userId,
      data: {
        ...parsed.data,
        phone: allow.phone,
        email: allow.email
      }
    });

    return res.status(201).json({
      createdUser: {
        id: String(user._id),
        role: user.role,
        email: user.email,
        phone: user.phone,
        memberId: user.memberId,
        message: 'Member created. Ask the member to use Forgot Password to set a password.'
      }
    });
  } catch (error) {
    return res.status(409).json({ error: error.message || 'Could not create member' });
  }
});

router.get('/mine', authMiddleware, requireRole(['trainer', 'client']), async (req, res) => {
  const items = await Request.find({
    gymId: req.user.gymId,
    createdBy: req.user.userId
  }).sort({ createdAt: -1 }).lean();

  return res.json({ items });
});

router.get('/', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const filter = { gymId: req.user.gymId };
  if (['pending', 'approved', 'rejected'].includes(status)) {
    filter.status = status;
  }

  const items = await Request.find(filter).sort({ createdAt: -1 }).lean();
  return res.json({ items });
});

router.patch('/:id/review', authMiddleware, requireRole(['owner', 'admin']), async (req, res) => {
  const parsed = reviewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const request = await Request.findOne({
    _id: req.params.id,
    gymId: req.user.gymId
  });

  if (!request) {
    return res.status(404).json({ error: 'Request not found' });
  }
  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'This request has already been reviewed.' });
  }

  request.status = parsed.data.status;
  request.reviewNote = parsed.data.reviewNote || '';
  request.reviewedBy = req.user.userId;
  request.reviewedAt = new Date();

  let createdUser = null;
  if (request.status === 'approved' && (request.type === 'client' || request.type === 'trainer' || request.type === 'member')) {
    try {
      const user = await approveOnboardingRequest(request, req.user.userId);
      createdUser = {
        id: String(user._id),
        role: user.role,
        email: user.email,
        phone: user.phone,
        message: 'Account created. Ask the user to use Forgot Password to set their password.'
      };
    } catch (error) {
      return res.status(409).json({ error: error.message || 'Could not approve this request' });
    }
  }

  await request.save();

  if (request.status === 'approved' && request.type === 'workout-plan') {
    const memberId = Number(request.data?.memberId || 0);
    const workoutPlan = request.data?.workoutPlan;

    if (memberId > 0 && workoutPlan && typeof workoutPlan === 'object') {
      await User.updateOne(
        { gymId: req.user.gymId, memberId },
        {
          $set: {
            workoutPlan: {
              name: typeof workoutPlan.name === 'string' ? workoutPlan.name.trim() : '',
              exercises: Array.isArray(workoutPlan.exercises)
                ? workoutPlan.exercises.map((item) => String(item).trim()).filter(Boolean)
                : []
            }
          }
        }
      );
    }
  }

  return res.json({ request, createdUser });
});

module.exports = router;
