'use strict';

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`${name} must be an integer`);
  return n;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

// Brevo's dashboard can show a key wrapped as base64 JSON ({"api_key":"xkeysib-..."}).
function brevoKey(raw) {
  const key = (raw || '').trim();
  if (!key || key.startsWith('xkeysib-')) return key;
  try {
    const parsed = JSON.parse(Buffer.from(key, 'base64').toString('utf8'));
    if (parsed && typeof parsed.api_key === 'string') return parsed.api_key.trim();
  } catch { /* not wrapped; use as given */ }
  return key;
}

function isLocalUrl(url) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function loadConfig(overrides = {}) {
  const env = process.env.NODE_ENV || 'development';
  const config = {
    env,
    port: int('PORT', 3000),
    databaseUrl: process.env.DATABASE_URL || '',
    jwtSecret: process.env.JWT_SECRET || (env === 'production' ? '' : 'dev-only-insecure-secret'),
    jwtTtl: process.env.JWT_TTL || '30d',
    otpSecret: process.env.OTP_SECRET || (env === 'production' ? '' : 'dev-only-otp-secret'),
    otpTtlMinutes: int('OTP_TTL_MINUTES', 10),
    otpMaxAttempts: int('OTP_MAX_ATTEMPTS', 5),
    otpCooldownSeconds: int('OTP_COOLDOWN_SECONDS', 60),
    otpMaxPerHour: int('OTP_MAX_PER_HOUR', 5),
    otpMaxFailuresPerDay: int('OTP_MAX_FAILURES_PER_DAY', 15),
    exposeOtpInResponse: bool('EXPOSE_OTP_IN_RESPONSE', false),
    smtpUrl: process.env.SMTP_URL || '',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
    smtpPort: int('SMTP_PORT', 465),
    mailFrom: process.env.MAIL_FROM || '',
    brevoApiKey: brevoKey(process.env.BREVO_API_KEY),
    mailFromEmail: process.env.MAIL_FROM_EMAIL || '',
    mailFromName: process.env.MAIL_FROM_NAME || 'Vision In Neighborhoods',
    rateLimitEnabled: bool('RATE_LIMIT_ENABLED', true),
    rateLimitStore: process.env.RATE_LIMIT_STORE || (process.env.VERCEL ? 'postgres' : 'memory'),
    // Emails (comma-separated) that can check leases and ownership proofs.
    adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
    // Shared with the Python rescore function and Vercel Cron.
    cronSecret: process.env.CRON_SECRET || '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000'),
    ...overrides,
  };

  if (config.env === 'production') {
    if (!config.jwtSecret || !config.otpSecret) {
      throw new Error('JWT_SECRET and OTP_SECRET must be set in production');
    }
    if (!config.brevoApiKey && !config.smtpUrl && !(config.smtpUser && config.smtpPass)) {
      throw new Error('Email is not configured: set BREVO_API_KEY, or SMTP_URL (or SMTP_USER and SMTP_PASS)');
    }
    if (config.brevoApiKey && !(config.mailFromEmail || config.smtpUser)) {
      throw new Error('MAIL_FROM_EMAIL must be set when using BREVO_API_KEY');
    }
    if (config.exposeOtpInResponse) {
      throw new Error('EXPOSE_OTP_IN_RESPONSE must not be enabled in production');
    }
  }
  if (config.exposeOtpInResponse && !isLocalUrl(config.publicBaseUrl)) {
    throw new Error('EXPOSE_OTP_IN_RESPONSE is only allowed when PUBLIC_BASE_URL is localhost');
  }
  return config;
}

module.exports = { loadConfig, brevoKey };
