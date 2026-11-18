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

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'advisor',
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  reset_token TEXT,
  reset_expires_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users (reset_token);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  csrf_token TEXT NOT NULL DEFAULT '',
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions (email);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT,
  actor_role TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs (at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_logs (type);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs (actor_email);

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

INSERT INTO app_meta (key, value) VALUES ('schema_version', '3')
ON CONFLICT (key) DO UPDATE SET value = '3';
