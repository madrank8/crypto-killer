-- Migration: 003_split_review_generation.sql
-- Run in Supabase SQL Editor
--
-- Splits the single long /api/admin/reviews/generate SSE pipeline into two phases
-- so each fits inside the Vercel Hobby 60s function limit.
--
-- Phase A (/generate):   content_generated   — article saved, visuals/audit/hero still pending
-- Phase B (/polish):     polishing           — in-flight
--                        polished            — final (visuals + audit + hero done)
--                        polish_failed       — last polish run errored; UI exposes a Retry button
--
-- A NULL value means the review predates this migration or was authored manually.

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS generation_status text
  CHECK (generation_status IN ('content_generated', 'polishing', 'polished', 'polish_failed'));

-- Track the last polish error so the UI can surface it on retry
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS polish_error text;

-- Index used by the editor page to poll status cheaply
CREATE INDEX IF NOT EXISTS idx_reviews_generation_status
  ON reviews (generation_status)
  WHERE generation_status IS NOT NULL;
