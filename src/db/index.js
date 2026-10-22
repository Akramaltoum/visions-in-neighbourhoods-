'use strict';

const { Pool, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings instead of local-midnight Dates.
types.setTypeParser(1082, (v) => v);

// Thin wrapper so the rest of the app only depends on query() and tx().
function wrapPool(pool) {
  return {
    pool,
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

function createPgDb(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({
    connectionString,
    max: Number.parseInt(process.env.DB_POOL_MAX, 10) || 10,
    // Fail fast instead of hanging a request when the database is unreachable.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    // A runaway query can't tie up a connection for more than 15 seconds.
    statement_timeout: 15_000,
    // Hosted databases (e.g. Supabase) sign their TLS certificate with their own
    // root CA. With DATABASE_CA_CERT set, the certificate is fully verified.
    ...(process.env.DATABASE_CA_CERT
      ? { ssl: { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true } }
      : {}),
  });
  // Without this listener, a dropped idle connection (database restart, network
  // blip) emits an unhandled 'error' and crashes the whole app.
  pool.on('error', (err) => console.error('Database connection dropped:', err.message));
  return wrapPool(pool);
}

// In-memory Postgres used by the test suite so tests run without Docker.
function createMemoryDb() {
  // Required lazily: pg-mem is a dev dependency.
  const { newDb } = require('pg-mem');
  const mem = newDb();
  const { Pool: MemPool } = mem.adapters.createPg();
  return wrapPool(new MemPool());
}

module.exports = { createPgDb, createMemoryDb };
