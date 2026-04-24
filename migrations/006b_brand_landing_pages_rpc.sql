-- Migration: 006b_brand_landing_pages_rpc.sql
-- Path B hotfix applied during backfill (2026-04-24).
--
-- SECURITY DEFINER upsert for brand_landing_pages.
-- The production archive cron at /api/cron/archive-landing-pages uses
-- supaFetch (service_role key on Vercel) which bypasses RLS natively,
-- but any anon-authed caller (local backfill scripts, admin probes,
-- emergency re-runs) needs the function-level elevation. Mirrors the
-- pattern used for upsert_creatives in migration 005b.
--
-- On conflict on live_url (the unique constraint) merges the new
-- archive state in; attempts counter increments monotonically so the
-- cron can stop retrying dead URLs at the app level (MAX_ATTEMPTS=5).

CREATE OR REPLACE FUNCTION public.upsert_brand_landing_page(
  p_brand_id uuid,
  p_live_url text,
  p_live_hostname text,
  p_archive_url text,
  p_archive_status text,
  p_http_status int,
  p_last_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  out_row brand_landing_pages%ROWTYPE;
BEGIN
  INSERT INTO brand_landing_pages (
    brand_id, live_url, live_hostname, archive_url, archive_status,
    captured_at, http_status, attempts, last_error
  )
  VALUES (
    p_brand_id, p_live_url, p_live_hostname, p_archive_url, p_archive_status,
    now(), p_http_status, 1, p_last_error
  )
  ON CONFLICT (live_url) DO UPDATE SET
    archive_url    = COALESCE(EXCLUDED.archive_url, brand_landing_pages.archive_url),
    archive_status = EXCLUDED.archive_status,
    captured_at    = now(),
    http_status    = EXCLUDED.http_status,
    attempts       = brand_landing_pages.attempts + 1,
    last_error     = EXCLUDED.last_error
  RETURNING * INTO out_row;

  RETURN to_jsonb(out_row);
END;
$$;
