'use strict';

const express = require('express');
const { ah, badRequest } = require('../lib/http');
const { ROLE_IDS } = require('../lib/catalog');
const { parseSliders } = require('../lib/ranking');
const { clearSessionCookie } = require('../middleware/auth');

function profileOut(user, p, isAdmin) {
  return {
    id: user.id,
    email: user.email,
    isAdmin,
    profile: {
      displayName: p.display_name || '',
      roles: p.roles || [],
      school: p.school || '',
      budget: p.budget,
      moveIn: p.move_in || '',
      needsParking: p.needs_parking,
      sliders: parseSliders(p.sliders),
      complete: Boolean(p.display_name && (p.roles || []).length),
    },
  };
}

function validate(body) {
  const out = {};
  if (body.displayName !== undefined) {
    const v = String(body.displayName).trim();
    if (!v || v.length > 60) throw badRequest('Name must be 1 to 60 characters', 'invalid_profile');
    out.display_name = v;
  }
  if (body.roles !== undefined) {
    if (!Array.isArray(body.roles) || !body.roles.length || body.roles.some((r) => !ROLE_IDS.has(r))) {
      throw badRequest('Pick at least one role', 'invalid_profile');
    }
    out.roles = JSON.stringify([...new Set(body.roles)]);
  }
  if (body.school !== undefined) {
    const v = String(body.school).trim();
    if (v.length > 80) throw badRequest('School is too long', 'invalid_profile');
    out.school = v || null;
  }
  if (body.budget !== undefined) {
    const v = body.budget === null ? null : Number(body.budget);
    if (v !== null && (!Number.isInteger(v) || v < 100 || v > 5000)) throw badRequest('Budget must be $100 to $5,000', 'invalid_profile');
    out.budget = v;
  }
  if (body.moveIn !== undefined) {
    const v = String(body.moveIn || '');
    if (v && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw badRequest('Move-in must look like 2027-09', 'invalid_profile');
    out.move_in = v || null;
  }
  if (body.needsParking !== undefined) out.needs_parking = Boolean(body.needsParking);
  if (body.sliders !== undefined) out.sliders = JSON.stringify(parseSliders(body.sliders));
  return out;
}

function meRouter({ db, config }) {
  const router = express.Router();

  router.get('/', ah(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
    res.json(profileOut(req.user, rows[0] || {}, config.adminEmails.includes(req.user.email)));
  }));

  router.patch('/profile', ah(async (req, res) => {
    const patch = validate(req.body || {});
    const keys = Object.keys(patch);
    if (keys.length) {
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      await db.query(`UPDATE profiles SET ${sets}, updated_at = now() WHERE user_id = $1`, [req.user.id, ...keys.map((k) => patch[k])]);
    }
    const { rows } = await db.query('SELECT * FROM profiles WHERE user_id = $1', [req.user.id]);
    res.json(profileOut(req.user, rows[0], config.adminEmails.includes(req.user.email)));
  }));

  // Deletes the account. Opinions and reviews go with it; listings stay but lose their poster.
  router.delete('/', ah(async (req, res) => {
    await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    clearSessionCookie(res, config);
    res.json({ deleted: true });
  }));

  return router;
}

module.exports = { meRouter };
