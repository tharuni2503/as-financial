-- Enquiry management upgrade: additive columns for status, follow-up, consent, and internal notes.
-- Safe to run multiple times.

ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'New';
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS follow_up_date DATE;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS submission_id TEXT NOT NULL DEFAULT '';
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS internal_notes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill status from handled flag where status is still default/empty.
UPDATE enquiries
SET status = CASE WHEN handled THEN 'Contacted' ELSE 'New' END
WHERE status IS NULL OR BTRIM(status) = '' OR status = 'New';

-- Backfill consent/submission_id from payload when present.
UPDATE enquiries
SET consent = COALESCE((payload->>'consent')::boolean, consent, FALSE),
    consent_at = COALESCE(NULLIF(payload->>'consentAt', '')::timestamptz, consent_at),
    submission_id = COALESCE(NULLIF(payload->>'submissionId', ''), submission_id, ''),
    follow_up_date = COALESCE(NULLIF(payload->>'followUpDate', '')::date, follow_up_date)
WHERE payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries (status);
CREATE INDEX IF NOT EXISTS idx_enquiries_follow_up_date ON enquiries (follow_up_date);
CREATE INDEX IF NOT EXISTS idx_enquiries_submission_id ON enquiries (submission_id);
