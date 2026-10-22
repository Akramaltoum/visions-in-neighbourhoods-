'use strict';

const request = require('supertest');
const { loadConfig } = require('../src/config');
const { createMemoryDb, createPgDb } = require('../src/db');
const { migrate, seed } = require('../src/db/migrate');
const { createApp } = require('../src/app');

async function freshDb() {
  if (process.env.TEST_DATABASE_URL) {
    const db = createPgDb(process.env.TEST_DATABASE_URL);
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    return db;
  }
  return createMemoryDb();
}

async function createTestContext({ configOverrides = {}, samples = false } = {}) {
  const db = await freshDb();
  await migrate(db);
  await seed(db, { samples });
  const config = loadConfig({ rateLimitEnabled: false, otpCooldownSeconds: 0, otpMaxPerHour: 100, adminEmails: ['admin@example.com'], ...configOverrides });
  const outbox = [];
  const rescored = [];
  const mailer = { configured: true, send: async (msg) => { outbox.push(msg); } };
  const app = createApp({ db, config, mailer, rescore: async (id) => { rescored.push(id); return true; } });

  function lastCodeFor(email) {
    const msg = [...outbox].reverse().find((m) => m.to === email);
    return msg && msg.text.match(/code is (\d{6})/)[1];
  }

  async function login(email) {
    await request(app).post('/api/auth/otp/request').send({ email }).expect(200);
    const res = await request(app).post('/api/auth/otp/verify').send({ email, code: lastCodeFor(email) }).expect(200);
    return { token: res.body.token, id: res.body.user.id };
  }

  async function signup(email, profile = {}) {
    const user = await login(email);
    await as(user).patch('/api/me/profile').send({ displayName: 'Sam', roles: ['looking'], ...profile }).expect(200);
    return user;
  }

  const as = (user) => ({
    get: (url) => request(app).get(url).set('authorization', `Bearer ${user.token}`),
    post: (url) => request(app).post(url).set('authorization', `Bearer ${user.token}`),
    patch: (url) => request(app).patch(url).set('authorization', `Bearer ${user.token}`),
    delete: (url) => request(app).delete(url).set('authorization', `Bearer ${user.token}`),
  });

  return { app, db, config, outbox, rescored, lastCodeFor, login, signup, as, close: () => db.end() };
}

// A tiny valid JPEG header and a PDF header, enough for the file checks.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9]);
const PDF_PROOF = { mime: 'application/pdf', data: Buffer.from('%PDF-1.4 lease page').toString('base64') };

module.exports = { createTestContext, JPEG, PDF_PROOF };
