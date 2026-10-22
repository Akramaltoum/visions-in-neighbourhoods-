'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const seedData = require('./seed-data');
const { addressKey } = require('../lib/address');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
  }
}

// Safe to run on every deploy: only inserts what's missing.
async function seed(db, { samples = process.env.SEED_SAMPLES !== 'false' } = {}) {
  for (const name of seedData.neighbourhoods) {
    await db.query('INSERT INTO neighbourhoods (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  }
  if (!samples) return;
  for (const s of seedData.samples) {
    const address = `${s.street} (sample)`;
    const key = addressKey(address);
    const { rows } = await db.query('SELECT id FROM houses WHERE address_key = $1', [key]);
    if (rows[0]) continue;
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO houses (id, address, address_key, neighbourhood, house_type, walk_minutes, bus_minutes, bus_gap_minutes,
         grocery_walk_minutes, food_places_800m, social_places_1km, parking_spots, is_sample)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)`,
      [id, address, key, s.area, s.type, s.walk, s.bus ?? null, s.gap ?? null, s.grocery, s.food, s.social, s.parking],
    );
    await db.query(
      `INSERT INTO listings (id, house_id, source, source_name, rent_per_room, bedrooms, utilities_included, description)
       VALUES ($1, $2, 'partner', 'Sample', $3, $4, $5, $6)`,
      [crypto.randomUUID(), id, s.rent, s.beds, s.util, 'Sample listing to show how the site works. Not a real house.'],
    );
  }
}

module.exports = { migrate, seed };

if (require.main === module) {
  const { createPgDb } = require('./index');
  const db = createPgDb(process.env.DATABASE_URL);
  migrate(db)
    .then(() => seed(db))
    .then(() => {
      console.log('Migrations and seed complete');
      return db.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
