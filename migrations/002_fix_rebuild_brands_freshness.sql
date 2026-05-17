-- Migration: fix rebuild_brands() to use OUR scrape timeline, not SpyOwl's createdAt
--
-- Problem (pre-fix):
--   The aggregate used creatives.created_at (SpyOwl's first-detected timestamp) for both
--   last_seen and velocity windows. That meant any funnel whose newest creative was
--   created more than 7 days ago on SpyOwl was tagged velocity_trend = 'dead', even
--   if all of its existing creatives were still actively running and still being
--   returned by the daily scrape.
--   Concrete impact (verified 2026-05-17): 11,379 of 11,741 brands (97%) were
--   marked 'dead'; 9,501 of those were re-synced from SpyOwl in the last 2 days.
--
-- Fix:
--   - last_seen  := max(last_seen_at)   -- when we last confirmed the funnel is on SpyOwl
--   - first_seen := min(first_seen_at)  -- when WE first ingested the funnel
--   - velocity_7d      := creatives first ingested by us in the last 7 days
--   - velocity_prev_7d := creatives first ingested by us 7..14 days ago
--   - lifespan_days    := based on our timeline (first_seen_at -> last_seen_at)
--
-- New trend ladder also adds a true freshness gate at the top:
--   - 'dead'      when max(last_seen_at) < now() - 3 days  (gone from SpyOwl)
--   - 'stable'    when no new ingestion in either window but funnel still live
--   - existing surging/rising/declining classifications otherwise
--
-- Schema additions (additive, safe):
--   - scam_brands.last_synced_at  -- max(creatives.synced_at) for the funnel
--   - trigram index on name        -- supports server-side ILIKE search from /api/admin/brands?q=
--
-- "is_active" (was seen in last 3 days) is intentionally derived in the API
-- layer from last_synced_at, since Postgres rejects non-IMMUTABLE functions
-- like now() inside generated columns.

BEGIN;

-- pg_trgm needed for trigram index; CREATE EXTENSION is a no-op if already on
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Schema additions ───
ALTER TABLE scam_brands
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- Speed up name search from /api/admin/brands?q=
CREATE INDEX IF NOT EXISTS scam_brands_name_trgm_idx
  ON scam_brands USING gin (name gin_trgm_ops);

COMMIT;


-- ─── Rebuild function ───
CREATE OR REPLACE FUNCTION public.rebuild_brands()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET work_mem TO '64MB'
AS $function$
DECLARE
  brands_inserted   int := 0;
  brands_updated    int := 0;
  orphans_zeroed    int := 0;
  total_brands_after int := 0;
BEGIN
  WITH agg AS (
    SELECT
      normalized_offer,
      count(*) AS total,
      count(DISTINCT geo) AS total_geos,
      count(DISTINCT celebrity_name) FILTER (WHERE celebrity_name <> '') AS total_celebrities,
      count(*) FILTER (WHERE is_video = true)  AS total_videos,
      count(*) FILTER (WHERE is_video = false) AS total_photos,
      array_agg(DISTINCT geo ORDER BY geo) FILTER (WHERE geo <> '') AS geo_list,
      (array_agg(DISTINCT celebrity_name) FILTER (WHERE celebrity_name <> ''))[1:50] AS celebrity_list,
      -- ⬇ KEY CHANGES: use our scrape timeline, not SpyOwl's createdAt
      min(first_seen_at) AS first_seen,
      max(last_seen_at)  AS last_seen,
      max(synced_at)     AS last_synced,
      GREATEST(1, EXTRACT(DAY FROM max(last_seen_at) - min(first_seen_at))::int) AS lifespan_days,
      count(*) FILTER (WHERE first_seen_at >= now() - interval '7 days') AS velocity_7d,
      count(*) FILTER (
        WHERE first_seen_at >= now() - interval '14 days'
          AND first_seen_at  <  now() - interval '7  days'
      ) AS velocity_prev_7d
    FROM creatives
    WHERE normalized_offer IS NOT NULL
      AND normalized_offer <> ''
      AND normalized_offer <> 'unknown'
    GROUP BY normalized_offer
    HAVING count(*) >= 2
  ),
  landing AS (
    SELECT
      normalized_offer,
      (array_agg(link_url ORDER BY last_seen DESC))[1:20] AS landing_urls
    FROM (
      SELECT c.normalized_offer, ct.link_url, max(c.last_seen_at) AS last_seen
      FROM creatives c
      JOIN creative_text ct ON ct.creative_id = c.id
      WHERE c.normalized_offer IS NOT NULL
        AND c.normalized_offer <> ''
        AND c.normalized_offer <> 'unknown'
        AND ct.link_url IS NOT NULL
        AND ct.link_url <> ''
      GROUP BY c.normalized_offer, ct.link_url
    ) d
    GROUP BY normalized_offer
  ),
  slugged AS (
    SELECT a.*,
           COALESCE(l.landing_urls, '{}'::text[]) AS landing_urls,
           LEFT(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(a.normalized_offer), '[^a-z0-9]+', '-', 'g'), '^-|-$', '', 'g'), 100) AS slug
    FROM agg a
    LEFT JOIN landing l USING (normalized_offer)
  ),
  deduped AS (
    SELECT DISTINCT ON (slug) *
    FROM slugged
    WHERE slug <> '' AND slug IS NOT NULL
    ORDER BY slug, total DESC
  ),
  scored AS (
    SELECT *,
      LEAST(100, ROUND(
        LEAST(total::numeric / 100, 25) +
        LEAST(total_geos::numeric / 2, 25) +
        LEAST(total_celebrities::numeric / 10, 25) +
        LEAST(lifespan_days::numeric / 30, 15) +
        CASE WHEN velocity_7d > 0 THEN 10 ELSE 0 END
      )::int) AS scam_score,
      -- ⬇ NEW trend ladder with true freshness gate first
      CASE
        WHEN last_seen < now() - interval '3 days'           THEN 'dead'
        WHEN velocity_7d = 0 AND velocity_prev_7d = 0        THEN 'stable'
        WHEN velocity_prev_7d = 0                            THEN 'surging'
        WHEN velocity_7d >= 1.5 * velocity_prev_7d           THEN 'surging'
        WHEN velocity_7d >= velocity_prev_7d                 THEN 'rising'
        WHEN velocity_7d >= 0.5 * velocity_prev_7d           THEN 'stable'
        ELSE 'declining'
      END AS velocity_trend,
      CASE
        WHEN last_seen >= now() - interval '3 days' THEN 'active'
        WHEN lifespan_days > 30                     THEN 'inactive'
        ELSE 'detected'
      END AS brand_status
    FROM deduped
  ),
  upserted AS (
    INSERT INTO scam_brands (
      slug, name, normalized_name, total_creatives, total_geos, total_celebrities,
      total_videos, total_photos, geo_list, celebrity_list, language_list,
      first_seen_at, last_seen_at, last_synced_at, lifespan_days,
      velocity_7d, velocity_trend, scam_score, status, landing_urls, updated_at
    )
    SELECT slug, normalized_offer, normalized_offer, total, total_geos, total_celebrities,
           total_videos, total_photos, COALESCE(geo_list, '{}'), COALESCE(celebrity_list, '{}'), '{}',
           first_seen, last_seen, last_synced, lifespan_days,
           velocity_7d, velocity_trend, scam_score, brand_status, COALESCE(landing_urls, '{}'), now()
    FROM scored
    ON CONFLICT (slug) DO UPDATE SET
      total_creatives   = EXCLUDED.total_creatives,
      total_geos        = EXCLUDED.total_geos,
      total_celebrities = EXCLUDED.total_celebrities,
      total_videos      = EXCLUDED.total_videos,
      total_photos      = EXCLUDED.total_photos,
      geo_list          = EXCLUDED.geo_list,
      celebrity_list    = EXCLUDED.celebrity_list,
      first_seen_at     = EXCLUDED.first_seen_at,
      last_seen_at      = EXCLUDED.last_seen_at,
      last_synced_at    = EXCLUDED.last_synced_at,
      lifespan_days     = EXCLUDED.lifespan_days,
      velocity_7d       = EXCLUDED.velocity_7d,
      velocity_trend    = EXCLUDED.velocity_trend,
      scam_score        = EXCLUDED.scam_score,
      status            = EXCLUDED.status,
      landing_urls      = EXCLUDED.landing_urls,
      updated_at        = now()
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE was_inserted),
    COUNT(*) FILTER (WHERE NOT was_inserted)
  INTO brands_inserted, brands_updated
  FROM upserted;

  -- Orphan zero-out: brands whose creatives have all disappeared from SpyOwl
  WITH orphans AS (
    UPDATE scam_brands
    SET total_creatives = 0,
        total_geos = 0,
        total_celebrities = 0,
        total_videos = 0,
        total_photos = 0,
        geo_list = '{}',
        celebrity_list = '{}',
        landing_urls = '{}',
        velocity_7d = 0,
        velocity_trend = 'dead',
        status = 'inactive',
        updated_at = now()
    WHERE NOT EXISTS (
      SELECT 1 FROM creatives c
      WHERE c.normalized_offer = scam_brands.normalized_name
    )
    AND (total_creatives > 0 OR total_geos > 0 OR total_celebrities > 0 OR array_length(landing_urls, 1) > 0)
    RETURNING 1
  )
  SELECT COUNT(*) INTO orphans_zeroed FROM orphans;

  SELECT COUNT(*) INTO total_brands_after FROM scam_brands;

  RETURN jsonb_build_object(
    'brands_inserted', brands_inserted,
    'brands_updated',  brands_updated,
    'brands_orphaned', orphans_zeroed,
    'total_brands',    total_brands_after,
    'timestamp',       now()
  );
END;
$function$;
