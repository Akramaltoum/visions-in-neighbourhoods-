'use strict';

// Entry point for Vercel. Builds the app once per instance and reuses it, along with
// its database pool. Migrations run during the build (`npm run migrate`).
const { loadConfig } = require('./config');
const { createPgDb } = require('./db');
const { createMailer } = require('./lib/mailer');
const { createRescorer } = require('./lib/rescore');
const { createApp } = require('./app');

let app = null;
let mailer = null;

function getApp() {
  if (app) return app;
  const config = loadConfig();
  if (!process.env.DB_POOL_MAX) process.env.DB_POOL_MAX = '3';
  const db = createPgDb(config.databaseUrl);
  mailer = createMailer(config);
  app = createApp({ db, config, mailer, rescore: createRescorer(config) });
  return app;
}

async function checkEmail(instance) {
  if (!mailer.configured || instance.locals.emailStatus === 'ready') return;
  try {
    await mailer.verify();
    instance.locals.emailStatus = 'ready';
  } catch (err) {
    instance.locals.emailStatus = err.reason ? `error:${err.reason}` : 'error';
    console.error('Email: NOT working:', err.message);
  }
}

module.exports = async (req, res) => {
  const instance = getApp();
  if (req.url === '/healthz' || req.url.startsWith('/healthz?')) await checkEmail(instance);
  return instance(req, res);
};
