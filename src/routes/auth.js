'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { ah, badRequest, HttpError } = require('../lib/http');
const { generateCode, hashCode, codesMatch } = require('../lib/otp');
const { otpEmail } = require('../lib/emails');
const { signToken, setSessionCookie, clearSessionCookie, revokeSession, readCredentials } = require('../middleware/auth');

const EMAIL_RE = /^[a-z0-9._%+-]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/;

function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

async function findOrCreateUser(db, email) {
  return db.tx(async (tx) => {
    const existing = await tx.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
      if (existing.rows[0].verified_at) return { user: existing.rows[0], created: false };
      const updated = await tx.query('UPDATE users SET verified_at = now() WHERE id = $1 RETURNING *', [existing.rows[0].id]);
      return { user: updated.rows[0], created: false };
    }
    const id = crypto.randomUUID();
    const inserted = await tx.query('INSERT INTO users (id, email, verified_at) VALUES ($1, $2, now()) RETURNING *', [id, email]);
    await tx.query('INSERT INTO profiles (user_id) VALUES ($1)', [id]);
    return { user: inserted.rows[0], created: true };
  });
}

// Any email can sign up (decided 2026-10-22). Reviews are what need proof, not accounts.
function authRouter({ db, config, mailer, limiter }) {
  const router = express.Router();
  if (limiter) router.use(limiter);

  router.post('/otp/request', ah(async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    if (!email) throw badRequest('Enter a valid email address', 'invalid_email');

    const now = Date.now();
    const { rows: recent } = await db.query(
      'SELECT created_at FROM otp_codes WHERE email = $1 AND created_at > $2 ORDER BY created_at DESC',
      [email, new Date(now - 60 * 60 * 1000)],
    );
    if (recent.length >= config.otpMaxPerHour) {
      throw new HttpError(429, 'Too many codes requested. Try again later.', 'otp_rate_limited');
    }
    if (recent[0] && now - new Date(recent[0].created_at).getTime() < config.otpCooldownSeconds * 1000) {
      throw new HttpError(429, 'Please wait a minute before requesting another code.', 'otp_cooldown');
    }

    const code = generateCode();
    await db.query('UPDATE otp_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL', [email]);
    await db.query(
      'INSERT INTO otp_codes (id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), email, hashCode(config.otpSecret, email, code), new Date(now + config.otpTtlMinutes * 60 * 1000)],
    );
    const { rows: known } = await db.query(
      'SELECT p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.email = $1',
      [email],
    );
    try {
      await mailer.send({ to: email, ...otpEmail({ code, ttlMinutes: config.otpTtlMinutes, name: known[0] && known[0].display_name }) });
    } catch (err) {
      console.error(`Sign-in email to ${email.replace(/^(.).*@/, '$1***@')} failed: ${err.message}`);
      await db.query('UPDATE otp_codes SET consumed_at = now() WHERE email = $1 AND consumed_at IS NULL', [email]);
      throw new HttpError(502, "We couldn't send your code right now. Please try again in a minute.", 'email_failed');
    }
    const body = { sent: true, expiresInMinutes: config.otpTtlMinutes };
    if (config.exposeOtpInResponse) body.devCode = code;
    res.json(body);
  }));

  router.post('/otp/verify', ah(async (req, res) => {
    const email = normalizeEmail(req.body && req.body.email);
    const code = req.body && String(req.body.code || '').trim();
    if (!email || !/^\d{6}$/.test(code)) throw badRequest('Email and 6-digit code are required', 'invalid_input');

    const { rows } = await db.query(
      `SELECT * FROM otp_codes WHERE email = $1 AND consumed_at IS NULL AND expires_at > $2
       ORDER BY created_at DESC LIMIT 1`,
      [email, new Date()],
    );
    const otp = rows[0];
    if (!otp) throw badRequest('Code is invalid or has expired', 'otp_invalid');
    const { rows: guesses } = await db.query(
      'SELECT COALESCE(SUM(attempts), 0)::int AS n FROM otp_codes WHERE email = $1 AND created_at > $2',
      [email, new Date(Date.now() - 24 * 3600 * 1000)],
    );
    if (guesses[0].n >= config.otpMaxFailuresPerDay) {
      throw new HttpError(429, 'Too many wrong codes today. Try again tomorrow.', 'otp_locked_day');
    }
    if (otp.attempts >= config.otpMaxAttempts) {
      throw new HttpError(429, 'Too many attempts. Request a new code.', 'otp_locked');
    }
    if (!codesMatch(config.otpSecret, email, code, otp.code_hash)) {
      await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
      throw badRequest('Code is invalid or has expired', 'otp_invalid');
    }
    await db.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);

    const { user, created } = await findOrCreateUser(db, email);
    if (user.suspended) throw new HttpError(403, 'Account is suspended', 'suspended');
    const token = signToken(config, user);
    setSessionCookie(res, config, token);
    res.json({ token, user: { id: user.id, email: user.email }, created });
  }));

  router.post('/logout', ah(async (req, res) => {
    const creds = readCredentials(req);
    if (creds) await revokeSession(db, config, creds.token);
    clearSessionCookie(res, config);
    res.json({ signedOut: true });
  }));

  return router;
}

module.exports = { authRouter, normalizeEmail };
