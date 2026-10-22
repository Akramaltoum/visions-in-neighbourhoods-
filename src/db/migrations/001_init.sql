-- Accounts -----------------------------------------------------------------

CREATE TABLE users (
  id              UUID PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  verified_at     TIMESTAMPTZ,
  suspended       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ
);

CREATE TABLE otp_codes (
  id           UUID PRIMARY KEY,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_email_idx ON otp_codes (email);

CREATE TABLE revoked_sessions (
  jti         TEXT PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE rate_limits (
  key       TEXT PRIMARY KEY,
  hits      INTEGER NOT NULL,
  reset_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);

-- One account can hold several roles (see the spec's role table).
CREATE TABLE profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name   TEXT,
  roles          JSONB NOT NULL DEFAULT '[]',
  school         TEXT,
  budget         INTEGER,
  move_in        TEXT,
  needs_parking  BOOLEAN NOT NULL DEFAULT false,
  sliders        JSONB NOT NULL DEFAULT '{"commute":3,"food":3,"social":3,"inside":3,"value":3}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Houses and listings --------------------------------------------------------

CREATE TABLE neighbourhoods (
  name            TEXT PRIMARY KEY,
  inside_average  REAL NOT NULL DEFAULT 6.5
);

-- A house is keyed by its cleaned-up address. Listings come and go; the house page,
-- its reviews and its scores stay.
CREATE TABLE houses (
  id                    UUID PRIMARY KEY,
  address               TEXT NOT NULL,
  address_key           TEXT NOT NULL UNIQUE,
  neighbourhood         TEXT NOT NULL REFERENCES neighbourhoods(name),
  house_type            TEXT,
  landlord_name         TEXT,
  lat                   DOUBLE PRECISION,
  lng                   DOUBLE PRECISION,
  walk_minutes          REAL,
  bus_minutes           REAL,
  bus_gap_minutes       REAL,
  grocery_walk_minutes  REAL,
  food_places_800m      INTEGER,
  social_places_1km     INTEGER,
  parking_spots         INTEGER,
  price_info            JSONB,
  is_sample             BOOLEAN NOT NULL DEFAULT false,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  rescored_at           TIMESTAMPTZ
);

CREATE TABLE listings (
  id                  UUID PRIMARY KEY,
  house_id            UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  source              TEXT NOT NULL CHECK (source IN ('landlord', 'link', 'partner')),
  source_name         TEXT,
  url                 TEXT,
  rent_per_room       INTEGER NOT NULL,
  bedrooms            INTEGER NOT NULL,
  utilities_included  BOOLEAN NOT NULL DEFAULT false,
  description         TEXT,
  photos              JSONB NOT NULL DEFAULT '[]',
  posted_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_verified      BOOLEAN NOT NULL DEFAULT false,
  last_checked        DATE NOT NULL DEFAULT CURRENT_DATE,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listings_house_idx ON listings (house_id);

CREATE TABLE photos (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  mime        TEXT NOT NULL,
  data        BYTEA NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What people say ------------------------------------------------------------

-- Anyone signed in can leave an opinion. Opinions never move the Inside score.
CREATE TABLE opinions (
  id          UUID PRIMARY KEY,
  house_id    UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body        TEXT NOT NULL,
  hidden      BOOLEAN NOT NULL DEFAULT false,
  reply       TEXT,
  reply_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX opinions_house_idx ON opinions (house_id);

-- Checklist reviews from tenants. Only status 'verified' counts in the Inside score.
-- One review per person per house per year lived there.
CREATE TABLE reviews (
  id                   UUID PRIMARY KEY,
  house_id             UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  user_id              UUID REFERENCES users(id) ON DELETE CASCADE,
  ratings              JSONB NOT NULL,
  lived_until          DATE NOT NULL,
  lived_year           INTEGER NOT NULL,
  utilities_per_month  INTEGER,
  commute_minutes      INTEGER,
  body                 TEXT,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (house_id, user_id, lived_year)
);
CREATE INDEX reviews_house_idx ON reviews (house_id);

-- Lease pages, rent receipts and ownership proofs. The file is deleted once checked.
CREATE TABLE proofs (
  id          UUID PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('lease', 'ownership')),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  review_id   UUID REFERENCES reviews(id) ON DELETE CASCADE,
  listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE,
  mime        TEXT,
  data        BYTEA,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_at  TIMESTAMPTZ,
  checked_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE reports (
  id          UUID PRIMARY KEY,
  opinion_id  UUID NOT NULL REFERENCES opinions(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the rating engine knows and computes ----------------------------------

CREATE TABLE evidence (
  id              UUID PRIMARY KEY,
  house_id        UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  score           TEXT NOT NULL,
  source          TEXT NOT NULL,
  value           REAL,
  seen_on         DATE NOT NULL,
  specificity     TEXT NOT NULL DEFAULT 'address',
  claim           TEXT,
  url             TEXT,
  signal          TEXT,
  signal_amount   REAL NOT NULL DEFAULT 1,
  about_address   TEXT,
  about_landlord  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_house_idx ON evidence (house_id);

CREATE TABLE scores (
  house_id     UUID NOT NULL REFERENCES houses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  value        REAL NOT NULL,
  confidence   REAL NOT NULL,
  note         TEXT,
  sources      JSONB NOT NULL DEFAULT '[]',
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (house_id, name)
);
