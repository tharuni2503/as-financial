-- AS Financial: optional notifications table (multi-instance safe reminders)
--
-- IMPORTANT: This file lives in server/migrations-pending/ and is intentionally
-- NOT auto-applied by the server (only server/migrations/*.sql is auto-migrated).
-- Apply it explicitly, after review:
--   psql "$DATABASE_URL" -f server/migrations-pending/007_notifications.sql
-- Then move it into server/migrations/ if you want it tracked by schema_migrations.
--
-- The application detects this table at runtime. If it is absent, the reminder
-- system falls back to the legacy JSON app_admin collection.
--
-- Cutover checklist (do all of it, then verify):
--   1. Apply 006_follow_up_management.sql first (enquiries.follow_up_date /
--      follow_up_completed_at must exist; table mode stays disabled without them).
--   2. Apply this file. The backfill copies legacy notifications and rewrites
--      reminder dedupe keys so the runtime generator does not duplicate them.
--   3. Restart the app. It switches to the table automatically on next request.
--   4. Verify: GET /api/admin/notifications returns follow-up + SLA + enquiry
--      alerts; ack/dismiss one reminder and confirm state survives a refresh.
--   5. Verify pagination: page 1 and page 2 have no duplicate IDs and total is
--      stable while no writes occur.
--   6. Optionally remove the legacy notifications array from app_admin after
--      confirming the backfill (keep a backup first).
--
-- History note: acknowledged_at and dismissed_at are independent. A row can be
-- acknowledged first and dismissed later; both timestamps and actor metadata
-- (stored in meta.acknowledgedBy / meta.dismissedBy) remain intact.

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  dedupe_key      TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'notification',
  title           TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  target_type     TEXT NOT NULL DEFAULT '',
  target_id       TEXT NOT NULL DEFAULT '',
  state           TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'acknowledged', 'dismissed', 'completed', 'superseded')),
  read            BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pending reminders are the hot path: overdue/today/upcoming counts and lists.
CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON notifications (type, created_at DESC)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_notifications_state
  ON notifications (state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_target
  ON notifications (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications (created_at DESC);

-- Optional: one-time backfill from the legacy JSON store, if present.
-- Wrapped in a DO block so it is safe when app_admin has no notifications row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_admin' AND column_name = 'value'
  ) THEN
    INSERT INTO notifications
      (id, dedupe_key, type, title, message, target_type, target_id, state, read,
       acknowledged_at, dismissed_at, meta, created_at, updated_at)
    SELECT
      COALESCE(NULLIF(item->>'id', ''), 'NTF-LEGACY-' || md5(item::text)),
      CASE
        WHEN COALESCE(item->>'type', '') = 'followup.reminder'
          AND COALESCE(item->>'targetId', '') <> ''
          AND COALESCE(item->'meta'->>'followUpDate', '') <> ''
        THEN 'followup:' || (item->>'targetId') || ':' || (item->'meta'->>'followUpDate')
        WHEN COALESCE(item->>'type', '') = 'lead.sla'
          AND COALESCE(item->>'targetId', '') <> ''
          AND COALESCE(item->'meta'->>'rule', '') <> ''
        THEN 'sla:' || (item->'meta'->>'rule') || ':' || (item->>'targetId')
        WHEN COALESCE(item->>'type', '') = 'enquiry.new'
          AND COALESCE(item->>'targetId', '') <> ''
        THEN 'enquiry:' || (item->>'targetId')
        ELSE COALESCE(NULLIF(item->>'id', ''), 'NTF-LEGACY-' || md5(item::text))
      END,
      COALESCE(NULLIF(item->>'type', ''), 'notification'),
      COALESCE(item->>'title', ''),
      COALESCE(item->>'message', ''),
      COALESCE(item->>'targetType', ''),
      COALESCE(item->>'targetId', ''),
      CASE
        WHEN lower(COALESCE(item->>'dismissed', '')) IN ('true', '1', 'yes') THEN 'dismissed'
        WHEN lower(COALESCE(item->>'acknowledged', '')) IN ('true', '1', 'yes') THEN 'acknowledged'
        WHEN lower(COALESCE(item->>'state', '')) = 'completed'
          OR lower(COALESCE(item->>'status', '')) = 'completed'
          OR lower(COALESCE(item->>'done', '')) IN ('true', '1', 'yes') THEN 'completed'
        WHEN lower(COALESCE(item->>'state', '')) = 'superseded' THEN 'superseded'
        ELSE 'pending'
      END,
      lower(COALESCE(item->>'read', '')) IN ('true', '1', 'yes'),
      CASE WHEN lower(COALESCE(item->>'acknowledged', '')) IN ('true', '1', 'yes')
             AND COALESCE(item->>'createdAt', '') ~ '^\d{4}-\d{2}-\d{2}'
           THEN (item->>'createdAt')::timestamptz ELSE NULL END,
      CASE WHEN lower(COALESCE(item->>'dismissed', '')) IN ('true', '1', 'yes')
             AND COALESCE(item->>'createdAt', '') ~ '^\d{4}-\d{2}-\d{2}'
           THEN (item->>'createdAt')::timestamptz ELSE NULL END,
      COALESCE(item->'meta', '{}'::jsonb),
      CASE
        WHEN COALESCE(item->>'createdAt', '') ~ '^\d{4}-\d{2}-\d{2}'
        THEN (item->>'createdAt')::timestamptz
        ELSE NOW()
      END,
      NOW()
    FROM app_admin a
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(a.value) = 'array' THEN a.value ELSE '[]'::jsonb END
    ) AS item
    WHERE a.key = 'notifications'
    -- When two legacy rows collapse to the same dedupe_key, insert the row that
    -- carries history state first so ON CONFLICT DO NOTHING preserves it.
    ORDER BY
      CASE
        WHEN lower(COALESCE(item->>'dismissed', '')) IN ('true', '1', 'yes') THEN 0
        WHEN lower(COALESCE(item->>'acknowledged', '')) IN ('true', '1', 'yes') THEN 1
        ELSE 2
      END,
      COALESCE(item->>'createdAt', '') DESC
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END $$;
