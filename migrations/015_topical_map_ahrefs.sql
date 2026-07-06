-- Migration: 015_topical_map_ahrefs.sql
-- Ahrefs provider columns for Topical Map v2 topics.
-- Run in Supabase SQL Editor. Idempotent.

-- traffic_potential: organic traffic of the #1 page for the keyword (Ahrefs)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS traffic_potential int;
-- parent_topic: Ahrefs Parent Topic (clustering/cannibalization signal)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS parent_topic text;
-- serp_authority: { dr_min, dr_median, dr_max, weakest_top5_dr, low_dr_count }
ALTER TABLE topics ADD COLUMN IF NOT EXISTS serp_authority jsonb;
