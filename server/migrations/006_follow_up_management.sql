-- Follow-up management: additive fields for completion and activity tracking.
-- Safe to run multiple times.

ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS follow_up_completed_at TIMESTAMPTZ;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS follow_up_activity JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill activity from payload/internal notes where possible.
UPDATE enquiries
SET follow_up_activity = COALESCE(payload->'followUpActivity', payload->'internalNotes', follow_up_activity, '[]'::jsonb)
WHERE (follow_up_activity IS NULL OR follow_up_activity = '[]'::jsonb)
  AND payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enquiries_follow_up_completed_at ON enquiries (follow_up_completed_at);
