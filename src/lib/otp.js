'use strict';

const crypto = require('node:crypto');

function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Codes are stored as an HMAC so a database leak does not reveal live codes.
function hashCode(secret, email, code) {
  return crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

function codesMatch(secret, email, code, storedHash) {
  const a = Buffer.from(hashCode(secret, email, String(code)), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { generateCode, hashCode, codesMatch };
