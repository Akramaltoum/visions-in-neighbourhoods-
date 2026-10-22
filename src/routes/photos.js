'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { ah, badRequest, notFound } = require('../lib/http');
const { stripJpegMetadata } = require('../lib/images');

const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const MAX_PHOTOS_PER_USER = 40;

// Listing photos. The browser re-encodes each one to JPEG; the server still strips
// metadata (GPS and so on) in case a modified client skipped that.
function photoUploadRouter({ db }) {
  const router = express.Router();
  router.post('/', express.raw({ type: () => true, limit: MAX_PHOTO_BYTES }), ah(async (req, res) => {
    let clean;
    try { clean = stripJpegMetadata(req.body); } catch { throw badRequest('Photos must be JPEG', 'invalid_photo'); }
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM photos WHERE user_id = $1', [req.user.id]);
    if (rows[0].n >= MAX_PHOTOS_PER_USER) throw badRequest('Photo limit reached', 'photo_limit');
    const id = crypto.randomUUID();
    await db.query('INSERT INTO photos (id, user_id, mime, data, bytes) VALUES ($1, $2, $3, $4, $5)',
      [id, req.user.id, 'image/jpeg', clean, clean.length]);
    res.status(201).json({ id, url: `/api/photos/${id}` });
  }));
  return router;
}

// Listing photos are public, like the listings themselves.
function photoServeRouter({ db }) {
  const router = express.Router();
  router.get('/:id', ah(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw notFound();
    const { rows } = await db.query('SELECT mime, data FROM photos WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound();
    res.set('Content-Type', rows[0].mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].data);
  }));
  return router;
}

module.exports = { photoUploadRouter, photoServeRouter };
