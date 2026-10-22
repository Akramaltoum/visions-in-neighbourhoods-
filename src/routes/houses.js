'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { ah, badRequest, notFound, HttpError } = require('../lib/http');
const { addressKey } = require('../lib/address');
const { LISTING_ROLES, OPINION_ROLES, CHECKLIST } = require('../lib/catalog');
const { rank, parseSliders, level, displayRange } = require('../lib/ranking');
const { parseProof } = require('../lib/proofs');

const DAY = 24 * 3600 * 1000;
const OWN_PHOTO_RE = /^\/api\/photos\/([0-9a-f-]{36})$/;
const REPORTS_TO_HIDE = 3;

// Same thresholds as rating_engine/prices.py price_status.
function dateOnly(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function priceStatus(lastChecked, now = new Date()) {
  const age = Math.floor((now - new Date(`${dateOnly(lastChecked)}T00:00:00Z`)) / DAY);
  if (age <= 7) return 'current';
  if (age > 30) return 'history_only';
  if (age > 14) return 'may_be_rented';
  return 'stale';
}

const SOURCES = [
  [/(^|\.)kijiji\.ca$/, 'Kijiji'],
  [/(^|\.)facebook\.com$/, 'Facebook Marketplace'],
  [/(^|\.)rentals\.ca$/, 'Rentals.ca'],
  [/(^|\.)places4students\.com$/, 'Places4Students'],
  [/(^|\.)zumper\.com$/, 'Zumper'],
  [/(^|\.)padmapper\.com$/, 'PadMapper'],
];

function sourceFromUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { throw badRequest('That link is not a valid web address', 'invalid_url'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Links must start with https://', 'invalid_url');
  const host = url.hostname.toLowerCase();
  const known = SOURCES.find(([re]) => re.test(host));
  return { url: url.toString(), name: known ? known[1] : host.replace(/^www\./, '') };
}

function int(v, min, max, msg) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest(msg, 'invalid_input');
  return n;
}

function text(v, max, msg, { required = false } = {}) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if ((required && !s) || s.length > max) throw badRequest(msg, 'invalid_input');
  return s || null;
}

async function rolesOf(db, userId) {
  const { rows } = await db.query('SELECT roles FROM profiles WHERE user_id = $1', [userId]);
  return new Set((rows[0] && rows[0].roles) || []);
}

function scoreOut(row) {
  return {
    value: row.value,
    confidence: row.confidence,
    level: level(row.confidence),
    range: displayRange(row.value, row.confidence),
    note: row.note || '',
    sources: row.sources || [],
  };
}

function priceOut(listing, house) {
  const info = house.price_info || {};
  return {
    rentPerRoom: listing.rent_per_room,
    utilitiesIncluded: listing.utilities_included,
    monthlyTotal: info.monthlyTotal ?? null,
    utilitiesLabel: listing.utilities_included ? 'utilities included' : (info.utilitiesLabel || 'no estimate yet'),
    status: priceStatus(listing.last_checked),
    lastChecked: dateOnly(listing.last_checked),
  };
}

async function loadScores(db, houseIds) {
  if (!houseIds.length) return {};
  const { rows } = await db.query('SELECT * FROM scores WHERE house_id = ANY($1)', [houseIds]);
  const out = {};
  for (const r of rows) (out[r.house_id] = out[r.house_id] || {})[r.name] = scoreOut(r);
  return out;
}

async function findOrCreateHouse(db, { address, neighbourhood, houseType, landlordName, userId }) {
  const key = addressKey(address);
  if (!/\d/.test(key)) throw badRequest('Include the house number, like "12 Emerson St"', 'invalid_address');
  const { rows } = await db.query('SELECT * FROM houses WHERE address_key = $1', [key]);
  if (rows[0]) return rows[0];
  const { rows: hood } = await db.query('SELECT name FROM neighbourhoods WHERE name = $1', [neighbourhood]);
  if (!hood[0]) throw badRequest('Pick an area from the list', 'invalid_input');
  const id = crypto.randomUUID();
  const inserted = await db.query(
    `INSERT INTO houses (id, address, address_key, neighbourhood, house_type, landlord_name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, address, key, neighbourhood, houseType, landlordName, userId],
  );
  return inserted.rows[0];
}

function housesRouter({ db, requireAuth, rescore }) {
  const router = express.Router();

  router.get('/neighbourhoods', ah(async (req, res) => {
    const { rows } = await db.query('SELECT name FROM neighbourhoods ORDER BY name');
    res.json(rows.map((r) => r.name));
  }));

  // Every house with its scores, ranked for this visitor's sliders.
  router.get('/houses', ah(async (req, res) => {
    let sliders = parseSliders(req.query);
    if (req.user && !Object.keys(req.query).some((k) => k in sliders)) {
      const { rows } = await db.query('SELECT sliders FROM profiles WHERE user_id = $1', [req.user.id]);
      if (rows[0]) sliders = parseSliders(rows[0].sliders);
    }
    const { rows: houses } = await db.query('SELECT * FROM houses');
    const { rows: listings } = await db.query('SELECT * FROM listings WHERE active = true ORDER BY created_at DESC');
    const { rows: counts } = await db.query(
      `SELECT house_id, COUNT(*)::int AS n FROM opinions WHERE hidden = false GROUP BY house_id`,
    );
    const { rows: reviewCounts } = await db.query(
      `SELECT house_id, COUNT(*)::int AS n FROM reviews WHERE status = 'verified' GROUP BY house_id`,
    );
    const scores = await loadScores(db, houses.map((h) => h.id));
    const opinionsBy = Object.fromEntries(counts.map((c) => [c.house_id, c.n]));
    const reviewsBy = Object.fromEntries(reviewCounts.map((c) => [c.house_id, c.n]));
    const listingBy = {};
    for (const l of listings) if (!listingBy[l.house_id]) listingBy[l.house_id] = l;

    let out = houses.map((h) => {
      const l = listingBy[h.id];
      return {
        id: h.id,
        address: h.address,
        neighbourhood: h.neighbourhood,
        houseType: h.house_type,
        isSample: h.is_sample,
        walkMinutes: h.walk_minutes == null ? null : Math.round(h.walk_minutes),
        parkingSpots: h.parking_spots,
        scores: scores[h.id] || {},
        listing: l ? { bedrooms: l.bedrooms, source: l.source_name || l.source, photo: (l.photos || [])[0] || null, price: priceOut(l, h) } : null,
        opinions: opinionsBy[h.id] || 0,
        verifiedReviews: reviewsBy[h.id] || 0,
      };
    });
    // Listings that may be rented already are hidden by default (spec: Prices).
    if (req.query.all !== '1') out = out.filter((h) => !h.listing || !['may_be_rented', 'history_only'].includes(h.listing.price.status));
    if (req.query.area) out = out.filter((h) => h.neighbourhood === req.query.area);
    if (req.query.budget) {
      const budget = Number(req.query.budget);
      out = out.filter((h) => h.listing && (h.listing.price.monthlyTotal ?? h.listing.price.rentPerRoom) <= budget);
    }
    if (req.query.parking === '1') out = out.filter((h) => (h.parkingSpots || 0) > 0);
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      out = out.filter((h) => [h.address, h.neighbourhood, h.houseType || ''].some((f) => f.toLowerCase().includes(q)));
    }
    res.json({ sliders, houses: rank(out, sliders) });
  }));

  router.get('/houses/:id', ah(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound();
    const { rows } = await db.query('SELECT * FROM houses WHERE id = $1', [req.params.id]);
    const h = rows[0];
    if (!h) throw notFound('House not found');
    const scores = (await loadScores(db, [h.id]))[h.id] || {};
    const { rows: listings } = await db.query(
      'SELECT * FROM listings WHERE house_id = $1 ORDER BY active DESC, created_at DESC', [h.id],
    );
    const { rows: opinions } = await db.query(
      'SELECT * FROM opinions WHERE house_id = $1 AND hidden = false ORDER BY created_at DESC', [h.id],
    );
    const { rows: tenants } = await db.query(
      "SELECT DISTINCT user_id FROM reviews WHERE house_id = $1 AND status = 'verified'", [h.id],
    );
    const verifiedTenants = new Set(tenants.map((t) => t.user_id));
    const { rows: reviews } = await db.query(
      `SELECT ratings, lived_year, body FROM reviews WHERE house_id = $1 AND status = 'verified' ORDER BY lived_until DESC`, [h.id],
    );
    const items = CHECKLIST.map((c) => {
      const vals = reviews.map((r) => r.ratings[c.id]).filter((v) => Number.isInteger(v));
      return { ...c, average: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, count: vals.length };
    });
    const isPoster = req.user ? listings.some((l) => l.posted_by === req.user.id && l.source === 'landlord') : false;
    res.json({
      id: h.id,
      address: h.address,
      neighbourhood: h.neighbourhood,
      houseType: h.house_type,
      isSample: h.is_sample,
      parkingSpots: h.parking_spots,
      walkMinutes: h.walk_minutes == null ? null : Math.round(h.walk_minutes),
      scores,
      rescoredAt: h.rescored_at,
      listings: listings.map((l) => ({
        id: l.id,
        active: l.active,
        source: l.source,
        sourceName: l.source_name,
        url: l.url,
        bedrooms: l.bedrooms,
        description: l.description,
        photos: l.photos || [],
        ownerVerified: l.owner_verified,
        price: priceOut(l, h),
      })),
      opinions: opinions.map((o) => ({
        id: o.id, role: o.role, stars: o.stars, body: o.body, year: new Date(o.created_at).getUTCFullYear(),
        verified: verifiedTenants.has(o.user_id), reply: o.reply, mine: Boolean(req.user && o.user_id === req.user.id),
      })),
      reviews: { count: reviews.length, items, comments: reviews.filter((r) => r.body).map((r) => ({ year: r.lived_year, body: r.body })) },
      canReply: isPoster,
    });
  }));

  router.use(requireAuth);

  // A pasted link to a listing on another site, or a landlord's own listing.
  router.post('/houses', express.json({ limit: '5mb' }), ah(async (req, res) => {
    const b = req.body || {};
    const address = text(b.address, 120, 'Enter the street address', { required: true });
    const neighbourhood = text(b.neighbourhood, 60, 'Pick an area', { required: true });
    const houseType = text(b.houseType, 60, 'Type is too long');
    const landlordName = text(b.landlordName, 120, 'Landlord name is too long');
    const description = text(b.description, 2000, 'Description is too long');
    const rent = int(b.rentPerRoom, 100, 5000, 'Rent per room must be $100 to $5,000');
    const bedrooms = int(b.bedrooms, 1, 15, 'Bedrooms must be 1 to 15');
    const utilitiesIncluded = Boolean(b.utilitiesIncluded);

    let source = 'landlord';
    let link = null;
    if (b.url) {
      link = sourceFromUrl(b.url);
      source = 'link';
    } else if (![...(await rolesOf(db, req.user.id))].some((r) => LISTING_ROLES.has(r))) {
      throw new HttpError(403, 'Add Landlord or Property manager to your profile roles to post your own listing, or paste a link instead', 'not_landlord');
    }
    const photos = Array.isArray(b.photos) ? b.photos : [];
    if (photos.length > 8 || !photos.every((p) => OWN_PHOTO_RE.test(p))) throw badRequest('Up to 8 uploaded photos', 'invalid_input');
    if (source === 'link' && photos.length) throw badRequest("Photos stay on the original listing; add them only to your own listings", 'invalid_input');
    for (const p of photos) {
      const { rows } = await db.query('SELECT 1 FROM photos WHERE id = $1 AND user_id = $2', [p.match(OWN_PHOTO_RE)[1], req.user.id]);
      if (!rows[0]) throw badRequest('One of those photos is not yours', 'invalid_input');
    }
    const proof = source === 'landlord' && b.proof ? parseProof(b.proof) : null;

    const house = await findOrCreateHouse(db, { address, neighbourhood, houseType, landlordName, userId: req.user.id });
    if (house.is_sample) throw badRequest('That is a sample house', 'invalid_input');
    const listingId = crypto.randomUUID();
    await db.query(
      `INSERT INTO listings (id, house_id, source, source_name, url, rent_per_room, bedrooms, utilities_included, description, photos, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [listingId, house.id, source, link ? link.name : null, link ? link.url : null, rent, bedrooms, utilitiesIncluded, description,
        JSON.stringify(photos), req.user.id],
    );
    if (proof) {
      await db.query(
        `INSERT INTO proofs (id, kind, user_id, listing_id, mime, data) VALUES ($1, 'ownership', $2, $3, $4, $5)`,
        [crypto.randomUUID(), req.user.id, listingId, proof.mime, proof.data],
      );
    }
    await rescore(house.id);
    res.status(201).json({ houseId: house.id, listingId });
  }));

  router.post('/houses/:id/opinions', ah(async (req, res) => {
    const b = req.body || {};
    if (!OPINION_ROLES.has(b.role)) throw badRequest('Pick how you know this house', 'invalid_input');
    const stars = int(b.stars, 1, 5, 'Pick 1 to 5 stars');
    const body = text(b.body, 2000, 'Write up to 2,000 characters', { required: true });
    const { rows } = await db.query('SELECT id FROM houses WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound('House not found');
    const { rows: mine } = await db.query('SELECT 1 FROM opinions WHERE house_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (mine[0]) throw new HttpError(409, "You've already shared an opinion on this house", 'duplicate');
    const id = crypto.randomUUID();
    await db.query(
      'INSERT INTO opinions (id, house_id, user_id, role, stars, body) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, req.params.id, req.user.id, b.role, stars, body],
    );
    res.status(201).json({ id });
  }));

  // A checklist review from a tenant. It counts only after a person checks the lease.
  router.post('/houses/:id/reviews', express.json({ limit: '5mb' }), ah(async (req, res) => {
    const b = req.body || {};
    const ratings = {};
    for (const c of CHECKLIST) ratings[c.id] = int(b.ratings && b.ratings[c.id], 1, 5, `Rate "${c.label}" from 1 to 5`);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(b.livedUntil || ''))) throw badRequest('When did you move out (or when does your lease end)?', 'invalid_input');
    const livedUntil = `${b.livedUntil}-01`;
    const year = Number(b.livedUntil.slice(0, 4));
    if (year < 2000 || new Date(livedUntil) > new Date(Date.now() + 400 * DAY)) throw badRequest('That date looks wrong', 'invalid_input');
    const utilities = b.utilitiesPerMonth ? int(b.utilitiesPerMonth, 0, 1000, 'Utilities must be $0 to $1,000 a month') : null;
    const commute = b.commuteMinutes ? int(b.commuteMinutes, 1, 180, 'Commute must be 1 to 180 minutes') : null;
    const body = text(b.body, 2000, 'Write up to 2,000 characters');
    const proof = parseProof(b.proof);
    const { rows } = await db.query('SELECT id FROM houses WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound('House not found');
    const { rows: dup } = await db.query(
      'SELECT 1 FROM reviews WHERE house_id = $1 AND user_id = $2 AND lived_year = $3', [req.params.id, req.user.id, year],
    );
    if (dup[0]) throw new HttpError(409, "You've already reviewed this house for that year", 'duplicate');
    const id = crypto.randomUUID();
    await db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO reviews (id, house_id, user_id, ratings, lived_until, lived_year, utilities_per_month, commute_minutes, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, req.params.id, req.user.id, JSON.stringify(ratings), livedUntil, year, utilities, commute, body],
      );
      await tx.query(
        `INSERT INTO proofs (id, kind, user_id, review_id, mime, data) VALUES ($1, 'lease', $2, $3, $4, $5)`,
        [crypto.randomUUID(), req.user.id, id, proof.mime, proof.data],
      );
    });
    res.status(201).json({ id, status: 'pending' });
  }));

  // Landlords who posted a listing for the house can reply publicly, once per opinion.
  router.post('/opinions/:id/reply', ah(async (req, res) => {
    const body = text(req.body && req.body.body, 1000, 'Reply must be 1 to 1,000 characters', { required: true });
    const { rows } = await db.query('SELECT * FROM opinions WHERE id = $1', [req.params.id]);
    const o = rows[0];
    if (!o) throw notFound();
    const { rows: own } = await db.query(
      "SELECT 1 FROM listings WHERE house_id = $1 AND posted_by = $2 AND source = 'landlord'", [o.house_id, req.user.id],
    );
    if (!own[0]) throw new HttpError(403, 'Only the landlord who listed this house can reply', 'forbidden');
    if (o.reply) throw new HttpError(409, 'You already replied', 'duplicate');
    await db.query('UPDATE opinions SET reply = $2, reply_at = now() WHERE id = $1', [o.id, body]);
    res.json({ replied: true });
  }));

  router.post('/opinions/:id/report', ah(async (req, res) => {
    const reason = text(req.body && req.body.reason, 500, 'Say briefly what is wrong', { required: true });
    const { rows } = await db.query('SELECT id FROM opinions WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound();
    const { rows: dup } = await db.query('SELECT 1 FROM reports WHERE opinion_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!dup[0]) {
      await db.query('INSERT INTO reports (id, opinion_id, user_id, reason) VALUES ($1, $2, $3, $4)',
        [crypto.randomUUID(), req.params.id, req.user.id, reason]);
    }
    const { rows: n } = await db.query('SELECT COUNT(*)::int AS n FROM reports WHERE opinion_id = $1', [req.params.id]);
    if (n[0].n >= REPORTS_TO_HIDE) await db.query('UPDATE opinions SET hidden = true WHERE id = $1', [req.params.id]);
    res.json({ reported: true });
  }));

  return router;
}

module.exports = { housesRouter, priceStatus, sourceFromUrl };
