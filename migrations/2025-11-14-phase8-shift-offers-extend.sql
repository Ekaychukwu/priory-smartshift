-- Phase 8: extend shift_offers with AI metadata

ALTER TABLE shift_offers
  ADD COLUMN IF NOT EXISTS ai_score NUMERIC,
  ADD COLUMN IF NOT EXISTS broadcast_group TEXT,
  ADD COLUMN IF NOT EXISTS suggested_rate NUMERIC;
