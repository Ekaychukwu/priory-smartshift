-- Phase 6: attendance logs + staff phone index (idempotent)

CREATE TABLE IF NOT EXISTS attendance_logs (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('checkin','checkout')),
  source TEXT NOT NULL DEFAULT 'whatsapp',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='staff' AND column_name='phone_number') THEN
    ALTER TABLE staff ADD COLUMN phone_number TEXT;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_staff_phone ON staff (phone_number);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_staff_time
  ON attendance_logs (staff_id, occurred_at DESC);
