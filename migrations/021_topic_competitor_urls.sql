-- Migration: 021_topic_competitor_urls.sql
-- The SERP stage already fetches the top-10 organic URLs per keyword
-- (lib/topical-map/dataforseo.js fetchSerp -> {urls, domains}) but discarded them,
-- so the content brief's Section 11 rendered [NO DATA] for competitor pages we had
-- actually measured. Persist them per topic.
-- Only populated for maps generated after this migration. Run in Supabase SQL
-- Editor. Idempotent.

-- competitor_urls: measured top organic results for the topic's target keyword,
-- excluding our own domains. Never inferred.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS competitor_urls jsonb;
