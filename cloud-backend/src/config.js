const dotenv = require('dotenv');

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  port: Number(process.env.PORT || 4500),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gym-cloud',
  jwtSecret: process.env.JWT_SECRET || 'development-secret',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  syncHmacSecret: process.env.SYNC_HMAC_SECRET || '',
  cloudNotificationsEnabled: toBoolean(process.env.CLOUD_NOTIFICATIONS_ENABLED, false),
  notificationPollMs: Math.max(15000, toNumber(process.env.CLOUD_NOTIFICATIONS_POLL_MS, 60000)),
  notificationBatchSize: clamp(Math.floor(toNumber(process.env.CLOUD_NOTIFICATIONS_BATCH_SIZE, 20)), 1, 200),
  notificationMaxAttempts: clamp(Math.floor(toNumber(process.env.CLOUD_NOTIFICATIONS_MAX_ATTEMPTS, 5)), 1, 20),
  notificationWindowDaysDefault: clamp(Math.floor(toNumber(process.env.CLOUD_NOTIFICATIONS_WINDOW_DAYS_DEFAULT, 3)), 1, 30),
  notificationDispatchHourUtc: clamp(Math.floor(toNumber(process.env.CLOUD_NOTIFICATIONS_DISPATCH_HOUR_UTC, 9)), 0, 23),
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION || 'v19.0',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  otpTtlMinutes: clamp(Math.floor(toNumber(process.env.OTP_TTL_MINUTES, 10)), 3, 30),
  authRateLimitWindowMs: clamp(Math.floor(toNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000)), 60 * 1000, 60 * 60 * 1000),
  authRateLimitMax: clamp(Math.floor(toNumber(process.env.AUTH_RATE_LIMIT_MAX, 10)), 3, 50),
  publicGymId: process.env.PUBLIC_GYM_ID || 'TEST_GYM_01'
};
