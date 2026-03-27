const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const RefreshToken = require('../models/RefreshToken');
const RevokedAccessToken = require('../models/RevokedAccessToken');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function parseDurationToMs(durationText, fallbackMs) {
  const value = String(durationText || '').trim();
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's'
    ? 1000
    : unit === 'm'
      ? 60 * 1000
      : unit === 'h'
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;
  return amount * multiplier;
}

function accessExpiresMs() {
  return parseDurationToMs(config.jwtAccessTtl, 15 * 60 * 1000);
}

function refreshExpiresMs() {
  return parseDurationToMs(config.jwtRefreshTtl, 30 * 24 * 60 * 60 * 1000);
}

function signAccessToken(user) {
  const jti = crypto.randomUUID();
  const payload = {
    userId: String(user._id),
    gymId: user.gymId,
    email: user.email,
    role: user.role,
    typ: 'access',
    jti
  };

  if (user.memberId) payload.memberId = user.memberId;
  if (user.trainerId) payload.trainerId = user.trainerId;

  const token = jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtAccessTtl });
  return {
    token,
    jti,
    expiresAt: new Date(Date.now() + accessExpiresMs())
  };
}

async function issueRefreshToken(user, reason = 'login') {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + refreshExpiresMs());
  await RefreshToken.create({
    userId: user._id,
    gymId: user.gymId,
    tokenHash,
    expiresAt,
    revokedReason: reason === 'login' ? null : reason
  });
  return {
    refreshToken: rawToken,
    expiresAt
  };
}

async function revokeRefreshToken(rawRefreshToken, reason = 'logout', replacedByTokenHash = null) {
  const tokenHash = hashToken(rawRefreshToken);
  const token = await RefreshToken.findOne({ tokenHash });
  if (!token || token.revokedAt) {
    return false;
  }

  token.revokedAt = new Date();
  token.revokedReason = reason;
  if (replacedByTokenHash) {
    token.replacedByTokenHash = replacedByTokenHash;
  }
  await token.save();
  return true;
}

async function rotateRefreshToken(rawRefreshToken) {
  const tokenHash = hashToken(rawRefreshToken);
  const tokenDoc = await RefreshToken.findOne({ tokenHash }).lean();
  if (!tokenDoc) {
    return { ok: false, error: 'Invalid refresh token' };
  }
  if (tokenDoc.revokedAt) {
    return { ok: false, error: 'Refresh token already revoked' };
  }
  if (new Date(tokenDoc.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: 'Refresh token expired' };
  }

  const nextRawToken = crypto.randomBytes(48).toString('hex');
  const nextHash = hashToken(nextRawToken);
  const nextExpiresAt = new Date(Date.now() + refreshExpiresMs());

  await RefreshToken.create({
    userId: tokenDoc.userId,
    gymId: tokenDoc.gymId,
    tokenHash: nextHash,
    expiresAt: nextExpiresAt
  });

  await RefreshToken.updateOne(
    { _id: tokenDoc._id, revokedAt: null },
    {
      $set: {
        revokedAt: new Date(),
        revokedReason: 'rotated',
        replacedByTokenHash: nextHash,
        lastUsedAt: new Date()
      }
    }
  );

  return {
    ok: true,
    userId: tokenDoc.userId,
    gymId: tokenDoc.gymId,
    refreshToken: nextRawToken,
    refreshTokenExpiresAt: nextExpiresAt
  };
}

async function revokeAccessTokenFromDecoded(decoded, reason = 'logout') {
  if (!decoded || !decoded.jti || !decoded.exp) {
    return false;
  }

  const expiresAt = new Date(Number(decoded.exp) * 1000);
  if (expiresAt.getTime() <= Date.now()) {
    return false;
  }

  try {
    await RevokedAccessToken.create({
      jti: decoded.jti,
      userId: decoded.userId,
      gymId: decoded.gymId,
      reason,
      expiresAt
    });
    return true;
  } catch (error) {
    if (error && error.code === 11000) {
      return true;
    }
    throw error;
  }
}

async function isAccessTokenRevoked(jti) {
  if (!jti) {
    return false;
  }
  const token = await RevokedAccessToken.findOne({ jti }).lean();
  return Boolean(token);
}

function issueAuthPair(user) {
  const access = signAccessToken(user);
  return access;
}

module.exports = {
  hashToken,
  issueAuthPair,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAccessTokenFromDecoded,
  isAccessTokenRevoked
};
