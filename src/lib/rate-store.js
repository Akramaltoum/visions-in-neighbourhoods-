'use strict';

// express-rate-limit store backed by Postgres, so every server instance shares
// one set of counters. Used when RATE_LIMIT_STORE=postgres (serverless hosting).
class PostgresRateStore {
  constructor(db, prefix) {
    this.db = db;
    this.prefix = prefix;
    this.localKeys = false; // counters are shared across instances
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const { rows } = await this.db.query(
      `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + $2 * interval '1 millisecond')
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, this.windowMs],
    );
    // Now and then, clear out windows that ended long ago.
    if (Math.random() < 0.01) {
      this.db.query("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'").catch(() => {});
    }
    return { totalHits: rows[0].hits, resetTime: new Date(rows[0].reset_at) };
  }

  async decrement(key) {
    await this.db.query('UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1', [this.prefix + key]);
  }

  async resetKey(key) {
    await this.db.query('DELETE FROM rate_limits WHERE key = $1', [this.prefix + key]);
  }
}

module.exports = { PostgresRateStore };
