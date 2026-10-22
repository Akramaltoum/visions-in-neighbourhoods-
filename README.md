# Vision In Neighborhoods

Every rental near McMaster gets a page. Lease-verified tenants rate the inside; map data rates commute, food, social life and value.

- `public/` static site, `src/` Express API (one Vercel function via `api/index.js`)
- `api/rescore.py` + `rating_engine/` recompute scores (called after new listings and approved leases, and nightly by Vercel Cron)
- Postgres on Supabase (schema `vin`); migrations run at build with `npm run migrate`

## Run locally

    cp .env.example .env   # set DATABASE_URL, EXPOSE_OTP_IN_RESPONSE=true
    npm install
    npm run dev

## Tests

    npm test   # Node tests on an in-memory database, then the Python engine tests
