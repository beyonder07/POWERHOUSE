const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('../models/User');
const PasswordResetOtp = require('../models/PasswordResetOtp');
const RefreshToken = require('../models/RefreshToken');
const config = require('../config');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const {
  hashToken,
  issueAuthPair,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAccessTokenFromDecoded
} = require('../lib/tokenService');

const router = express.Router();
const TEMP_OWNER_EMAIL_ACCESS = new Set(['owner@test.com']);

const loginSchema = z.object({
  identifier: z.string().trim().min(3).optional(),
  email: z.string().email().optional(),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(16)
});

const logoutSchema = z.object({
  refreshToken: z.string().min(16).optional()
}).optional();

const createStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  gymId: z.string().min(1)
});

const forgotPasswordSchema = z.object({
  role: z.enum(['owner', 'trainer', 'client']),
  phone: z.string().trim().min(8).optional(),
  email: z.string().email().optional()
});

const verifyOtpSchema = z.object({
  requestId: z.string().min(12),
  otp: z.string().trim().regex(/^\d{6}$/)
});

const resetPasswordSchema = z.object({
  requestId: z.string().min(12),
  resetToken: z.string().min(20),
  password: z.string().min(8)
});

const authLimiter = createRateLimiter({
  windowMs: config.authRateLimitWindowMs,
  max: config.authRateLimitMax,
  keyPrefix: 'auth',
  keyFn: (req) => `${req.ip || 'ip'}:${req.path}:${String(req.body?.identifier || req.body?.email || req.body?.phone || '').toLowerCase()}`
});

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').trim();
}

function maskPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length <= 4) {
    return digits;
  }
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function maskEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const [name, domain] = value.split('@');
  if (!name || !domain) {
    return value;
  }
  if (name.length <= 2) {
    return `${name[0] || '*'}*@${domain}`;
  }
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function authResponseForUser(user, accessToken, refreshToken, refreshTokenExpiresAt) {
  return {
    token: accessToken.token,
    accessToken: accessToken.token,
    accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    gymId: user.gymId,
    email: user.email,
    phone: user.phone || '',
    role: user.role
  };
}

async function issueTokensForUser(user, reason = 'login') {
  const accessToken = issueAuthPair(user);
  const refresh = await issueRefreshToken(user, reason);
  return authResponseForUser(user, accessToken, refresh.refreshToken, refresh.expiresAt);
}

async function findUserForLogin(identifier) {
  const value = String(identifier || '').trim();
  const normalizedPhone = normalizePhone(value);
  const loweredEmail = value.toLowerCase();

  if (value.includes('@')) {
    return {
      user: await User.findOne({ email: loweredEmail }),
      lookupMode: 'email',
      normalizedValue: loweredEmail
    };
  }

  return {
    user: await User.findOne({ phone: normalizedPhone }),
    lookupMode: 'phone',
    normalizedValue: normalizedPhone
  };
}

async function buildForgotPasswordUser(role, phone, email) {
  if (role === 'owner') {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return { error: 'Owner password reset requires a phone number.' };
    }
    const user = await User.findOne({ role: 'owner', phone: normalizedPhone });
    return { user, destinationType: 'phone', destinationValue: normalizedPhone };
  }

  if (phone) {
    const normalizedPhone = normalizePhone(phone);
    const user = await User.findOne({ role, phone: normalizedPhone });
    return { user, destinationType: 'phone', destinationValue: normalizedPhone };
  }

  if (email) {
    const loweredEmail = String(email || '').trim().toLowerCase();
    const user = await User.findOne({ role, email: loweredEmail });
    return { user, destinationType: 'email', destinationValue: loweredEmail };
  }

  return { error: 'Provide a phone number or email address.' };
}

router.post('/register', (_req, res) => {
  return res.status(403).json({ error: 'Direct signup is disabled. Client and trainer accounts must go through approval.' });
});

router.post('/staff', authMiddleware, requireRole(['admin']), async (req, res) => {
  const parsed = createStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const { email, password, gymId } = parsed.data;
  if (gymId !== req.user.gymId) {
    return res.status(403).json({ error: 'Cannot create staff for another gym' });
  }

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash, gymId, role: 'staff' });
  return res.status(201).json({
    userId: String(user._id),
    email: user.email,
    gymId: user.gymId,
    role: user.role
  });
});

router.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const identifier = String(parsed.data.identifier || parsed.data.email || '').trim();
  if (!identifier) {
    return res.status(400).json({ error: 'Phone number or email is required' });
  }

  const { user, lookupMode } = await findUserForLogin(identifier);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const allowTemporaryOwnerEmailAccess =
    user.role === 'owner' &&
    lookupMode === 'email' &&
    TEMP_OWNER_EMAIL_ACCESS.has(String(user.email || '').toLowerCase());

  if (user.role === 'owner' && lookupMode !== 'phone' && !allowTemporaryOwnerEmailAccess) {
    return res.status(403).json({ error: 'Owner must sign in with phone number' });
  }

  if (user.passwordResetRequired) {
    return res.status(403).json({ error: 'This account needs a password reset. Use Forgot Password to continue.' });
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const response = await issueTokensForUser(user, 'login');
  return res.json(response);
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const lookup = await buildForgotPasswordUser(parsed.data.role, parsed.data.phone, parsed.data.email);
  if (lookup.error) {
    return res.status(400).json({ error: lookup.error });
  }
  if (!lookup.user) {
    return res.status(404).json({ error: 'No account matched that role and contact information.' });
  }

  await PasswordResetOtp.updateMany(
    { userId: lookup.user._id, consumedAt: null, verifiedAt: null },
    { $set: { consumedAt: new Date() } }
  );

  const otp = generateOtp();
  const resetRecord = await PasswordResetOtp.create({
    userId: lookup.user._id,
    gymId: lookup.user.gymId,
    role: lookup.user.role,
    destinationType: lookup.destinationType,
    destinationMasked: lookup.destinationType === 'phone' ? maskPhone(lookup.destinationValue) : maskEmail(lookup.destinationValue),
    codeHash: hashToken(otp),
    expiresAt: new Date(Date.now() + config.otpTtlMinutes * 60 * 1000)
  });

  console.log(`[auth] password reset OTP for ${lookup.user.role} ${lookup.user._id}: ${otp}`);

  return res.json({
    ok: true,
    requestId: String(resetRecord._id),
    destination: resetRecord.destinationMasked,
    expiresAt: resetRecord.expiresAt.toISOString(),
    ...(process.env.NODE_ENV === 'production' ? {} : { otpPreview: otp })
  });
});

router.post('/verify-otp', authLimiter, async (req, res) => {
  const parsed = verifyOtpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const resetRecord = await PasswordResetOtp.findById(parsed.data.requestId);
  if (!resetRecord) {
    return res.status(404).json({ error: 'Reset request not found' });
  }
  if (resetRecord.consumedAt) {
    return res.status(400).json({ error: 'Reset request is no longer active' });
  }
  if (resetRecord.expiresAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'OTP expired. Request a new code.' });
  }
  if (resetRecord.attempts >= 5) {
    return res.status(429).json({ error: 'Too many invalid OTP attempts. Request a new code.' });
  }

  if (resetRecord.codeHash !== hashToken(parsed.data.otp)) {
    resetRecord.attempts += 1;
    await resetRecord.save();
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  const resetToken = crypto.randomBytes(24).toString('hex');
  resetRecord.verifiedAt = new Date();
  resetRecord.resetTokenHash = hashToken(resetToken);
  await resetRecord.save();

  return res.json({
    ok: true,
    requestId: String(resetRecord._id),
    resetToken
  });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const resetRecord = await PasswordResetOtp.findById(parsed.data.requestId);
  if (!resetRecord) {
    return res.status(404).json({ error: 'Reset request not found' });
  }
  if (!resetRecord.verifiedAt || resetRecord.consumedAt) {
    return res.status(400).json({ error: 'OTP verification is required before resetting password.' });
  }
  if (resetRecord.expiresAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Reset request expired. Start over.' });
  }
  if (resetRecord.resetTokenHash !== hashToken(parsed.data.resetToken)) {
    return res.status(400).json({ error: 'Invalid reset token' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await User.updateOne(
    { _id: resetRecord.userId },
    { $set: { passwordHash, passwordResetRequired: false } }
  );

  await RefreshToken.updateMany(
    { userId: resetRecord.userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'password-reset' } }
  );

  resetRecord.consumedAt = new Date();
  await resetRecord.save();

  return res.json({ ok: true, message: 'Password updated successfully. You can sign in now.' });
});

router.post('/refresh', async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const rotated = await rotateRefreshToken(parsed.data.refreshToken);
  if (!rotated.ok) {
    return res.status(401).json({ error: rotated.error || 'Invalid refresh token' });
  }

  const user = await User.findById(rotated.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found for refresh token' });
  }

  const accessToken = issueAuthPair(user);
  return res.json(authResponseForUser(user, accessToken, rotated.refreshToken, rotated.refreshTokenExpiresAt));
});

router.post('/logout', authMiddleware, async (req, res) => {
  const parsed = logoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  if (parsed.data && parsed.data.refreshToken) {
    await revokeRefreshToken(parsed.data.refreshToken, 'logout');
  }

  try {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (token) {
      const decoded = jwt.verify(token, config.jwtSecret);
      await revokeAccessTokenFromDecoded(decoded, 'logout');
    }
  } catch (_error) {
    // Ignore malformed tokens during logout.
  }

  return res.json({ ok: true });
});

module.exports = router;
