-- Migration: 006_brand_landing_pages.sql
-- Run in Supabase SQL Editor AFTER 005_creative_landing_urls.sql
--
-- Path B — ClaimReview.appearance unlock, step 2 of 2 (the archive side).
--
-- Holds Wayback Machine snapshot metadata for each distinct scam landing
-- URL discovered by migration 005's aggregation. The daily cron at
-- /api/cron/archive-landing-pages walks scam_brands.landing_urls[], for
-- each URL not yet captured (or captured > 30 days ago) calls the Wayback
-- Save API, and records the resulting archive_url here.
--
-- Downstream, sync-shape reads the most recent successful archive per
-- brand and threads it into claims[].appearance. The live URL is stored
-- here for audit but never shipped to the public schema — zero traffic
-- to the scam's domain, evidence persists through takedowns, matches the
-- policy decision captured in the Path B plan.
--
-- Idempotent re-run:
--   * Table + indexes use IF NOT EXISTS
--   * Column adds use IF NOT EXISTS
--   * Unique constraint on live_url dedupes across re-capture attempts;
--     the cron uses ON CONFLICT DO UPDATE to record retries.

CREATE TABLE IF NOT EXISTS brand_landing_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to scam_brands.id (uuid). ON DELETE CASCADE — if a brand row is
  -- ever purged, its archive metadata goes with it; we never want
  -- orphaned landing-page rows pointing nowhere.
  brand_id uuid NOT NULL REFERENCES scam_brands(id) ON DELETE CASCADE,
  -- The live scam URL as-seen from SpyOwl (creatives.link_url). Stored
  -- for audit but never shipped to public schema. Unique so the cron
  -- can ON CONFLICT DO UPDATE on retry.
  live_url text NOT NULL UNIQUE,
  -- Hostname extracted at insert time for fast per-host dedup queries
  -- (scam brands cycle URL paths but reuse hosts within a campaign).
  live_hostname text,
  -- Wayback snapshot URL, e.g. https://web.archive.org/web/20260424/<orig>.
  -- Null until a successful capture. Populated from the Content-Location
  -- header of the Wayback Save response.
  archive_url text,
  -- State machine: pending | success | failed | rate_limited
  archive_status text NOT NULL DEFAULT 'pending',
  -- Last capture attempt timestamp (success or failure). Used by the cron
  -- to skip URLs already captured < 30 days ago.
  captured_at timestamptz,
  -- HTTP status from Wayback Save API (200, 429, 523, etc.). Helpful for
  -- diagnosing why an archive failed without re-running.
  http_status int,
  -- Monotonic attempt counter. If this ever climbs past 5, the cron
  -- stops retrying (dead URL or takedown — admin can inspect last_error).
  attempts int NOT NULL DEFAULT 0,
  -- Most recent error string (truncated) when archive_status <> 'success'.
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by brand for the sync path — "give me the most recent
-- successful archive_url for brand X". Partial index skips the pending
-- / failed rows we don't want to consult when building sync payloads.
CREATE INDEX IF NOT EXISTS brand_landing_pages_brand_success_captured_idx
  ON brand_landing_pages (brand_id, captured_at DESC)
  WHERE archive_status = 'success';

-- Fast lookup by hostname for dedup during the archive cron — "has any
-- URL on this hostname already been captured recently?"
CREATE INDEX IF NOT EXISTS brand_landing_pages_hostname_captured_idx
  ON brand_landing_pages (live_hostname, captured_at DESC)
  WHERE archive_status = 'success' AND live_hostname IS NOT NULL;

-- Timestamp trigger. Matches the pattern on reviews.updated_at — the
-- PATCH path in supaFetch doesn't set updated_at explicitly, and we
-- want audit accuracy on archive status transitions.
CREATE OR REPLACE FUNCTION public.brand_landing_pages_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS brand_landing_pages_touch_updated_at ON brand_landing_pages;
CREATE TRIGGER brand_landing_pages_touch_updated_at
  BEFORE UPDATE ON brand_landing_pages
  FOR EACH ROW
  EXECUTE FUNCTION public.brand_landing_pages_touch_updated_at();
