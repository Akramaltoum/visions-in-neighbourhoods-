'use strict';

const path = require('node:path');
const express = require('express');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { errorHandler, ah } = require('./lib/http');
const { securityHeaders } = require('./lib/security-headers');
const { PostgresRateStore } = require('./lib/rate-store');
const { ROLES, CHECKLIST, SCORES } = require('./lib/catalog');
const { requireAuth, optionalAuth } = require('./middleware/auth');
const { authRouter } = require('./routes/auth');
const { meRouter } = require('./routes/me');
const { housesRouter } = require('./routes/houses');
const { photoUploadRouter, photoServeRouter } = require('./routes/photos');
const { adminRouter } = require('./routes/admin');

function createApp({ db, config, mailer, rescore = async () => false }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());
  const headers = securityHeaders({ https: config.publicBaseUrl.startsWith('https://') });
  app.use((req, res, next) => {
    for (const [name, value] of headers) res.set(name, value);
    next();
  });

  app.locals.emailStatus = mailer.configured ? 'unchecked' : 'not_configured';
  app.get('/healthz', ah(async (req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, email: app.locals.emailStatus });
  }));

  const store = (prefix) => (config.rateLimitStore === 'postgres' ? { store: new PostgresRateStore(db, prefix) } : {});
  const authLimiter = config.rateLimitEnabled
    ? rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, ...store('auth:') })
    : null;
  const apiLimiter = config.rateLimitEnabled
    ? rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false, ...store('api:') })
    : (req, res, next) => next();

  const api = express.Router();
  api.use(apiLimiter);
  // Routes that take files set their own, larger limit before this one runs.
  api.use((req, res, next) => (req.path.endsWith('/reviews') || req.path === '/houses' ? next() : express.json({ limit: '50kb' })(req, res, next)));
  api.use('/auth', authRouter({ db, config, mailer, limiter: authLimiter }));
  api.get('/catalog', (req, res) => res.json({ roles: ROLES, checklist: CHECKLIST, scores: SCORES }));
  const auth = requireAuth(config, db);
  api.use('/me', auth, meRouter({ db, config }));
  api.use('/photos', photoServeRouter({ db }));
  api.use('/photos', auth, photoUploadRouter({ db }));
  api.use('/admin', auth, adminRouter({ db, config, rescore }));
  api.use('/', optionalAuth(config, db), housesRouter({ db, requireAuth: auth, rescore }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', api);

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
