-- Phase: Shift offers + AI metadata

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS shift_offers (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('offered','accepted','declined')) DEFAULT 'offered',
  source TEXT NOT NULL DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

-- Extra AI / tracking columns
ALTER TABLE shift_offers
  ADD COLUMN IF NOT EXISTS ai_score NUMERIC,
  ADD COLUMN IF NOT EXISTS broadcast_group TEXT,
  ADD COLUMN IF NOT EXISTS suggested_rate NUMERIC;

-- Helpful index for finding latest offers per staff
CREATE INDEX IF NOT EXISTS idx_shift_offers_staff_status
  ON shift_offers (staff_id, status, created_at DESC);
