-- Migration: 026_topics_scheduled_for.sql
-- Persist Step-22 publication dates so the map-writer cron can pick due topics.
-- Run in Supabase SQL Editor. Idempotent.

ALTER TABLE topics ADD COLUMN IF NOT EXISTS scheduled_for date;

CREATE INDEX IF NOT EXISTS idx_topics_map_scheduled_for
  ON topics (map_id, scheduled_for);
