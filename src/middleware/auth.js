'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { HttpError } = require('../lib/http');

// The browser app signs in with an httpOnly session cookie, so page scripts never
// see or store the token. Other clients (mobile apps, scripts, tests) can still
// send the same token as "Authorization: Bearer <token>".
const SESSION_COOKIE = 'vin_session';
// Sent by the web app on every request. A cross-site form or link cannot set a
// custom header, so requiring it on cookie-authenticated writes blocks CSRF.
const CSRF_HEADER = 'x-requested-with';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function signToken(config, user) {
  // jwtid lets a single session be revoked on sign-out (see revokeSession).
  return jwt.sign({ sub: user.id }, config.jwtSecret, {
    expiresIn: config.jwtTtl, jwtid: crypto.randomUUID(), algorithm: 'HS256',
  });
}

function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production' || config.publicBaseUrl.startsWith('https://'),
    path: '/',
  };
}

function setSessionCookie(res, config, token) {
  const { exp } = jwt.decode(token);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(config), expires: new Date(exp * 1000) });
}

function clearSessionCookie(res, config) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(config));
}

function readCookie(req, name) {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

// Returns { token, via } where via is 'bearer' or 'cookie', or null.
function readCredentials(req) {
  const [scheme, bearer] = (req.get('authorization') || '').split(' ');
  if (scheme === 'Bearer' && bearer) return { token: bearer, via: 'bearer' };
  const cookie = readCookie(req, SESSION_COOKIE);
  if (cookie) return { token: cookie, via: 'cookie' };
  return null;
}

// last_active_at only needs to be roughly right; skip the write on most requests.
const ACTIVE_WRITE_EVERY_MS = 5 * 60 * 1000;

function verifyToken(config, token) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

// Signs out one session for good: the token stops working even if someone kept a copy.
async function revokeSession(db, config, token) {
  let payload;
  try { payload = verifyToken(config, token); } catch { return; }
  if (!payload.jti) return;
  await db.query(
    'INSERT INTO revoked_sessions (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING',
    [payload.jti, new Date(payload.exp * 1000)],
  );
  await db.query('DELETE FROM revoked_sessions WHERE expires_at < $1', [new Date()]);
}

// Loads the user from the session. Only verified, non-suspended accounts pass.
function requireAuth(config, db) {
  return async (req, res, next) => {
    try {
      const creds = readCredentials(req);
      if (!creds) throw new HttpError(401, 'Please sign in', 'unauthenticated');
      if (creds.via === 'cookie' && !SAFE_METHODS.has(req.method) && !req.get(CSRF_HEADER)) {
        throw new HttpError(403, 'Missing X-Requested-With header', 'csrf');
      }
      let payload;
      try {
        payload = verifyToken(config, creds.token);
      } catch {
        payload = null;
      }
      if (payload && payload.jti) {
        const { rows: revoked } = await db.query('SELECT 1 FROM revoked_sessions WHERE jti = $1', [payload.jti]);
        if (revoked[0]) payload = null;
      }
      if (!payload) {
        if (creds.via === 'cookie') clearSessionCookie(res, config);
        throw new HttpError(401, 'Your session expired. Please sign in again.', 'unauthenticated');
      }
      const { rows } = await db.query(
        'SELECT id, email, verified_at, suspended, last_active_at FROM users WHERE id = $1',
        [payload.sub],
      );
      const user = rows[0];
      if (!user) throw new HttpError(401, 'Account no longer exists', 'unauthenticated');
      if (!user.verified_at) throw new HttpError(403, 'Account is not verified', 'unverified');
      if (user.suspended) throw new HttpError(403, 'Account is suspended', 'suspended');
      req.user = user;
      const lastActive = user.last_active_at ? new Date(user.last_active_at).getTime() : 0;
      if (Date.now() - lastActive > ACTIVE_WRITE_EVERY_MS) {
        await db.query('UPDATE users SET last_active_at = now() WHERE id = $1', [user.id]);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// For public pages: signs the person in if they have a valid session, otherwise
// carries on without req.user.
function optionalAuth(config, db) {
  const strict = requireAuth(config, db);
  return (req, res, next) => {
    if (!readCredentials(req)) return next();
    return strict(req, res, (err) => (err && err.status === 401 ? next() : next(err)));
  };
}

module.exports = { signToken, requireAuth, optionalAuth, revokeSession, readCredentials, setSessionCookie, clearSessionCookie, SESSION_COOKIE };
