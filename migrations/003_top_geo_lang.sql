-- Migration: surface top GEO + language per brand on the admin Brands page so
-- the user can choose the right review language before clicking Generate.
--
-- Additive only. Backward compatible — existing API consumers keep working,
-- new fields are nullable / default '[]'.
--
-- Schema additions on scam_brands:
--   top_geo         text       -- single most-frequent ISO country code (e.g. "IT")
--   top_lang        text       -- single most-frequent land_language code (e.g. "it")
--   geo_breakdown   jsonb      -- top-5 ranked: [{geo, n, share}, ...]
--
-- rebuild_brands() is rewritten to compute these alongside the existing aggregates.
-- Uses mode() WITHIN GROUP for top_lang (most-frequent value), ranked CTE for top_geo
-- and the top-5 breakdown with normalized shares.

BEGIN;

ALTER TABLE scam_brands
  ADD COLUMN IF NOT EXISTS top_geo       text,
  ADD COLUMN IF NOT EXISTS top_lang      text,
  ADD COLUMN IF NOT EXISTS geo_breakdown jsonb DEFAULT '[]'::jsonb;

-- Index for filtering brands by language/geo in future admin views
CREATE INDEX IF NOT EXISTS scam_brands_top_geo_idx  ON scam_brands (top_geo);
CREATE INDEX IF NOT EXISTS scam_brands_top_lang_idx ON scam_brands (top_lang);

COMMIT;


CREATE OR REPLACE FUNCTION public.rebuild_brands()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET work_mem TO '64MB'
AS $function$
DECLARE
  brands_inserted    int := 0;
  brands_updated     int := 0;
  orphans_zeroed     int := 0;
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
      -- Scrape timeline (NOT SpyOwl's createdAt — see migration 002)
      min(first_seen_at) AS first_seen,
      max(last_seen_at)  AS last_seen,
      max(synced_at)     AS last_synced,
      GREATEST(1, EXTRACT(DAY FROM max(last_seen_at) - min(first_seen_at))::int) AS lifespan_days,
      count(*) FILTER (WHERE first_seen_at >= now() - interval '7 days') AS velocity_7d,
      count(*) FILTER (
        WHERE first_seen_at >= now() - interval '14 days'
          AND first_seen_at  <  now() - interval '7  days'
      ) AS velocity_prev_7d,
      -- ⬇ Top language: most-frequent non-empty land_language per brand
      mode() WITHIN GROUP (ORDER BY land_language)
        FILTER (WHERE land_language IS NOT NULL AND land_language <> '' AND land_language <> 'unknown')
        AS top_lang
    FROM creatives
    WHERE normalized_offer IS NOT NULL
      AND normalized_offer <> ''
      AND normalized_offer <> 'unknown'
    GROUP BY normalized_offer
    HAVING count(*) >= 2
  ),
  -- Per-brand geo counts → rank → keep top-5 with normalized share
  geo_counts AS (
    SELECT
      normalized_offer, geo, count(*) AS n,
      SUM(count(*)) OVER (PARTITION BY normalized_offer) AS brand_total
    FROM creatives
    WHERE normalized_offer IS NOT NULL
      AND normalized_offer <> ''
      AND normalized_offer <> 'unknown'
      AND geo IS NOT NULL AND geo <> ''
    GROUP BY normalized_offer, geo
  ),
  geo_ranked AS (
    SELECT
      normalized_offer, geo, n, brand_total,
      ROW_NUMBER() OVER (PARTITION BY normalized_offer ORDER BY n DESC, geo) AS rn
    FROM geo_counts
  ),
  geo_summary AS (
    SELECT
      normalized_offer,
      (array_agg(geo ORDER BY rn))[1] AS top_geo,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'geo', geo,
            'n', n,
            'share', ROUND((n::numeric / NULLIF(brand_total, 0)), 3)
          ) ORDER BY rn
        ) FILTER (WHERE rn <= 5),
        '[]'::jsonb
      ) AS geo_breakdown
    FROM geo_ranked
    GROUP BY normalized_offer
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
           COALESCE(g.top_geo, '') AS top_geo,
           COALESCE(g.geo_breakdown, '[]'::jsonb) AS geo_breakdown,
           COALESCE(l.landing_urls, '{}'::text[]) AS landing_urls,
           LEFT(REGEXP_REPLACE(
             REGEXP_REPLACE(LOWER(a.normalized_offer), '[^a-z0-9]+', '-', 'g'),
             '^-|-$', '', 'g'), 100) AS slug
    FROM agg a
    LEFT JOIN geo_summary g USING (normalized_offer)
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
      velocity_7d, velocity_trend, scam_score, status, landing_urls,
      top_geo, top_lang, geo_breakdown, updated_at
    )
    SELECT slug, normalized_offer, normalized_offer, total, total_geos, total_celebrities,
           total_videos, total_photos, COALESCE(geo_list, '{}'), COALESCE(celebrity_list, '{}'), '{}',
           first_seen, last_seen, last_synced, lifespan_days,
           velocity_7d, velocity_trend, scam_score, brand_status, COALESCE(landing_urls, '{}'),
           NULLIF(top_geo, ''), top_lang, geo_breakdown, now()
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
      top_geo           = EXCLUDED.top_geo,
      top_lang          = EXCLUDED.top_lang,
      geo_breakdown     = EXCLUDED.geo_breakdown,
      updated_at        = now()
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE was_inserted),
    COUNT(*) FILTER (WHERE NOT was_inserted)
  INTO brands_inserted, brands_updated
  FROM upserted;

  -- Orphan zero-out
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
        top_geo = NULL,
        top_lang = NULL,
        geo_breakdown = '[]'::jsonb,
        updated_at = now()
    WHERE NOT EXISTS (
      SELECT 1 FROM creatives c
      WHERE c.normalized_offer = scam_brands.normalized_name
    )
    AND (total_creatives > 0 OR total_geos > 0 OR total_celebrities > 0
         OR array_length(landing_urls, 1) > 0 OR top_geo IS NOT NULL)
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
