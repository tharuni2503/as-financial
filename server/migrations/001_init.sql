-- AS Financial: initial schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS app_content (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_admin (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  income TEXT NOT NULL DEFAULT '',
  employment TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enquiries_received_at ON enquiries (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_enquiries_handled ON enquiries (handled);
CREATE INDEX IF NOT EXISTS idx_enquiries_phone ON enquiries (phone);

-- Seed default rows for known keys
INSERT INTO app_content (key, value) VALUES
  ('testimonials', '[]'::jsonb),
  ('gallery', '[]'::jsonb),
  ('posts', '[]'::jsonb),
  ('images', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_admin (key, value) VALUES
  ('leads', '[]'::jsonb),
  ('applications', '[]'::jsonb),
  ('products', '[]'::jsonb),
  ('partners', '[]'::jsonb),
  ('tasks', '[]'::jsonb),
  ('settings', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')
ON CONFLICT (key) DO NOTHING;
