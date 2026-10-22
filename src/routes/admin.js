'use strict';

const express = require('express');
const { ah, badRequest, notFound, HttpError } = require('../lib/http');

// Checking leases and ownership proofs. Admins are the emails in ADMIN_EMAILS.
// Once a proof is approved or rejected its file is deleted, as the site promises.
function adminRouter({ db, config, rescore }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!config.adminEmails.includes(req.user.email)) return next(new HttpError(403, 'Admins only', 'forbidden'));
    return next();
  });

  router.get('/proofs', ah(async (req, res) => {
    const { rows } = await db.query(
      `SELECT p.id, p.kind, p.mime, p.created_at, u.email,
              COALESCE(h1.address, h2.address) AS address,
              r.lived_year, r.ratings, r.body AS review_body, l.rent_per_room
       FROM proofs p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN reviews r ON r.id = p.review_id
       LEFT JOIN houses h1 ON h1.id = r.house_id
       LEFT JOIN listings l ON l.id = p.listing_id
       LEFT JOIN houses h2 ON h2.id = l.house_id
       WHERE p.status = 'pending' ORDER BY p.created_at`,
    );
    res.json(rows.map((r) => ({
      id: r.id, kind: r.kind, mime: r.mime, createdAt: r.created_at, email: r.email, address: r.address,
      livedYear: r.lived_year, ratings: r.ratings, reviewBody: r.review_body, rentPerRoom: r.rent_per_room,
    })));
  }));

  router.get('/proofs/:id/file', ah(async (req, res) => {
    const { rows } = await db.query("SELECT mime, data FROM proofs WHERE id = $1 AND status = 'pending'", [req.params.id]);
    if (!rows[0] || !rows[0].data) throw notFound();
    res.set('Content-Type', rows[0].mime);
    res.set('Content-Disposition', 'inline');
    res.set('Cache-Control', 'no-store');
    res.send(rows[0].data);
  }));

  router.post('/proofs/:id', ah(async (req, res) => {
    const decision = req.body && req.body.decision;
    if (!['approve', 'reject'].includes(decision)) throw badRequest('decision must be approve or reject', 'invalid_input');
    const { rows } = await db.query("SELECT * FROM proofs WHERE id = $1 AND status = 'pending'", [req.params.id]);
    const p = rows[0];
    if (!p) throw notFound();
    const status = decision === 'approve' ? 'approved' : 'rejected';
    let houseId = null;
    await db.tx(async (tx) => {
      await tx.query('UPDATE proofs SET status = $2, data = NULL, checked_at = now(), checked_by = $3 WHERE id = $1',
        [p.id, status, req.user.id]);
      if (p.review_id) {
        const r = await tx.query('UPDATE reviews SET status = $2 WHERE id = $1 RETURNING house_id',
          [p.review_id, decision === 'approve' ? 'verified' : 'rejected']);
        houseId = r.rows[0] && r.rows[0].house_id;
      }
      if (p.listing_id && decision === 'approve') {
        const l = await tx.query('UPDATE listings SET owner_verified = true WHERE id = $1 RETURNING house_id', [p.listing_id]);
        houseId = l.rows[0] && l.rows[0].house_id;
      }
    });
    if (houseId) await rescore(houseId);
    res.json({ status });
  }));

  router.get('/reported', ah(async (req, res) => {
    const { rows } = await db.query(
      `SELECT o.id, o.body, o.stars, o.hidden, h.address, COUNT(r.id)::int AS reports
       FROM opinions o JOIN reports r ON r.opinion_id = o.id JOIN houses h ON h.id = o.house_id
       GROUP BY o.id, o.body, o.stars, o.hidden, h.address ORDER BY reports DESC`,
    );
    res.json(rows);
  }));

  router.post('/opinions/:id', ah(async (req, res) => {
    await db.query('UPDATE opinions SET hidden = $2 WHERE id = $1', [req.params.id, Boolean(req.body && req.body.hidden)]);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { adminRouter };
