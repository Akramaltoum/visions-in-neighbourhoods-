'use strict';

// Local development server. On Vercel, api/index.js uses src/handler.js instead.
const { loadConfig } = require('./config');
const { createPgDb } = require('./db');
const { migrate, seed } = require('./db/migrate');
const { createMailer } = require('./lib/mailer');
const { createRescorer } = require('./lib/rescore');
const { createApp } = require('./app');

async function main() {
  const config = loadConfig();
  const db = createPgDb(config.databaseUrl);
  await migrate(db);
  await seed(db);
  const mailer = createMailer(config);
  const app = createApp({ db, config, mailer, rescore: createRescorer(config) });
  app.listen(config.port, () => console.log(`Vision In Neighborhoods on http://localhost:${config.port}`));
}

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
