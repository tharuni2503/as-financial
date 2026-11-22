-- Additive analytics events table for first-party website analytics.
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  type TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '/',
  visitor_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events (type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor ON analytics_events (visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_page ON analytics_events (page);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_id ON analytics_events (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_event_id_unique ON analytics_events (event_id) WHERE event_id IS NOT NULL AND event_id <> '';
