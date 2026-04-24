-- Migration: 005_creative_landing_urls.sql
-- Run in Supabase SQL Editor AFTER 004_fix_rebuild_brands_and_counts.sql
--
-- Path B — ClaimReview.appearance unlock, step 1 of 2 (the capture side).
--
-- Persists 5 URL / ad-copy fields SpyOwl's /creative/all returns that we
-- were previously discarding at ingest:
--   linkUrl  → creatives.link_url   (the scam's landing page — the URL
--                                     that will anchor ClaimReview.appearance
--                                     after Wayback capture in migration 006)
--   postUrl  → creatives.post_url   (the Facebook post where the ad ran;
--                                     durable citation even after the scam
--                                     domain goes offline — reserved for a
--                                     future secondary-appearance pass)
--   fpLink   → creatives.fp_link    (the Facebook page running the ad)
--   linkText → creatives.link_text  (ad headline copy — useful for future
--                                     claimReviewed text grounding)
--   mainText → creatives.main_text  (ad body copy)
--
-- Also aggregates DISTINCT link_url per brand into a new
-- scam_brands.landing_urls text[] column so sync-shape can pass the list
-- downstream into normalizeClaims via its existing adCreativeUrls fallback.
--
-- Safety:
--   * Columns use ADD COLUMN IF NOT EXISTS — idempotent re-run.
--   * RPCs use CREATE OR REPLACE — re-running overwrites cleanly.
--   * Old creative rows get NULL URL fields until the next scrape rewrites
--     them; no data loss, aggregations gracefully skip NULL via FILTER.
--   * scam_brands.landing_urls defaults to '{}' and is populated on the
--     NEXT rebuild_brands() call; no implicit backfill here.

-- ─── 1. creatives: add the 5 URL / ad-copy columns ──────────────────
ALTER TABLE creatives
  ADD COLUMN IF NOT EXISTS link_url  text,
  ADD COLUMN IF NOT EXISTS post_url  text,
  ADD COLUMN IF NOT EXISTS fp_link   text,
  ADD COLUMN IF NOT EXISTS link_text text,
  ADD COLUMN IF NOT EXISTS main_text text;

-- Index for the aggregation step in rebuild_brands. Partial index to
-- skip rows we'd filter out anyway (NULL or empty URL).
CREATE INDEX IF NOT EXISTS creatives_link_url_normalized_offer_idx
  ON creatives (normalized_offer, link_url)
  WHERE link_url IS NOT NULL AND link_url <> '';

-- ─── 2. scam_brands: add the aggregated landing_urls column ─────────
ALTER TABLE scam_brands
  ADD COLUMN IF NOT EXISTS landing_urls text[] NOT NULL DEFAULT '{}';

-- ─── 3. upsert_creatives: ingest the 5 new fields ───────────────────
-- Preserves the jsonb return contract from migration 004 so the scraper
-- keeps getting {inserted, updated, total} counts without change.
CREATE OR REPLACE FUNCTION public.upsert_creatives(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  inserted_count int := 0;
  updated_count int := 0;
BEGIN
  WITH incoming AS (
    SELECT
      (r->>'id') AS id,
      (r->>'offer_name') AS offer_name,
      (r->>'normalized_offer') AS normalized_offer,
      (r->>'celebrity_name') AS celebrity_name,
      (r->>'geo') AS geo,
      (r->>'geo_region_id') AS geo_region_id,
      (r->>'is_video')::boolean AS is_video,
      (r->>'land_language') AS land_language,
      (r->>'is_favorite')::boolean AS is_favorite,
      (r->>'created_at')::timestamptz AS created_at,
      (r->>'first_seen_at')::timestamptz AS first_seen_at,
      (r->>'last_seen_at')::timestamptz AS last_seen_at,
      (r->>'synced_at')::timestamptz AS synced_at,
      NULLIF(r->>'link_url',  '') AS link_url,
      NULLIF(r->>'post_url',  '') AS post_url,
      NULLIF(r->>'fp_link',   '') AS fp_link,
      NULLIF(r->>'link_text', '') AS link_text,
      NULLIF(r->>'main_text', '') AS main_text
    FROM jsonb_array_elements(payload) AS r
  ),
  upserted AS (
    INSERT INTO creatives (
      id, offer_name, normalized_offer, celebrity_name, geo, geo_region_id,
      is_video, land_language, is_favorite, created_at, first_seen_at,
      last_seen_at, scrape_count, synced_at,
      link_url, post_url, fp_link, link_text, main_text
    )
    SELECT id, offer_name, normalized_offer, celebrity_name, geo, geo_region_id,
           is_video, land_language, is_favorite, created_at, first_seen_at,
           last_seen_at, 1, synced_at,
           link_url, post_url, fp_link, link_text, main_text
    FROM incoming
    ON CONFLICT (id) DO UPDATE SET
      last_seen_at = EXCLUDED.last_seen_at,
      scrape_count = creatives.scrape_count + 1,
      synced_at = EXCLUDED.synced_at,
      offer_name = EXCLUDED.offer_name,
      normalized_offer = EXCLUDED.normalized_offer,
      celebrity_name = EXCLUDED.celebrity_name,
      geo = EXCLUDED.geo,
      geo_region_id = EXCLUDED.geo_region_id,
      is_video = EXCLUDED.is_video,
      land_language = EXCLUDED.land_language,
      is_favorite = EXCLUDED.is_favorite,
      -- Prefer the new URL on conflict but never clobber a stored URL
      -- with NULL (SpyOwl occasionally omits linkUrl on a re-scrape of a
      -- creative that had it before — treat that as transient, not a wipe).
      link_url  = COALESCE(EXCLUDED.link_url,  creatives.link_url),
      post_url  = COALESCE(EXCLUDED.post_url,  creatives.post_url),
      fp_link   = COALESCE(EXCLUDED.fp_link,   creatives.fp_link),
      link_text = COALESCE(EXCLUDED.link_text, creatives.link_text),
      main_text = COALESCE(EXCLUDED.main_text, creatives.main_text)
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE was_inserted) AS ins,
    COUNT(*) FILTER (WHERE NOT was_inserted) AS upd
  INTO inserted_count, updated_count
  FROM upserted;

  RETURN jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'total', inserted_count + updated_count
  );
END;
$$;

-- ─── 4. rebuild_brands: also aggregate DISTINCT link_url → landing_urls ─
-- Same shape as migration 004's rebuild_brands; only the aggregation CTE
-- and the upsert field-list / on-conflict block change. Cap the array at
-- 20 URLs per brand so we don't blow up row size on prolific scams (most
-- brands have 2-5 distinct landing hosts; outliers like Floventra may have
-- more — 20 is plenty for schema/sync purposes, and the writer prompt
-- only ever shows the top 3 to the LLM anyway).
CREATE OR REPLACE FUNCTION public.rebuild_brands()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  brands_inserted int := 0;
  brands_updated int := 0;
  orphans_zeroed int := 0;
  total_brands_after int := 0;
BEGIN
  WITH agg AS (
    SELECT
      normalized_offer,
      count(*) AS total,
      count(DISTINCT geo) AS total_geos,
      count(DISTINCT celebrity_name) FILTER (WHERE celebrity_name <> '') AS total_celebrities,
      count(*) FILTER (WHERE is_video = true) AS total_videos,
      count(*) FILTER (WHERE is_video = false) AS total_photos,
      array_agg(DISTINCT geo ORDER BY geo) FILTER (WHERE geo <> '') AS geo_list,
      (array_agg(DISTINCT celebrity_name) FILTER (WHERE celebrity_name <> ''))[1:50] AS celebrity_list,
      -- NEW: top 20 distinct landing URLs per brand. Most-recent-first is
      -- approximated by ordering on max(last_seen_at) per URL in a
      -- subquery below because array_agg inside the CTE can't easily
      -- join a correlated order key.
      min(created_at) AS first_seen,
      max(created_at) AS last_seen,
      GREATEST(1, EXTRACT(DAY FROM max(created_at) - min(created_at))::int) AS lifespan_days,
      count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS velocity_7d,
      count(*) FILTER (WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days') AS velocity_prev_7d
    FROM creatives
    WHERE normalized_offer IS NOT NULL
      AND normalized_offer <> ''
      AND normalized_offer <> 'unknown'
    GROUP BY normalized_offer
    HAVING count(*) >= 2
  ),
  -- Separate CTE for landing URLs so we can order by recency at the URL
  -- level (most-recently-seen URLs first) without fighting aggregate
  -- ordering constraints in the main agg query.
  landing AS (
    SELECT
      normalized_offer,
      (array_agg(link_url ORDER BY last_seen DESC))[1:20] AS landing_urls
    FROM (
      SELECT normalized_offer, link_url, max(last_seen_at) AS last_seen
      FROM creatives
      WHERE normalized_offer IS NOT NULL
        AND normalized_offer <> ''
        AND normalized_offer <> 'unknown'
        AND link_url IS NOT NULL
        AND link_url <> ''
      GROUP BY normalized_offer, link_url
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
      CASE
        WHEN velocity_7d = 0 THEN 'dead'
        WHEN velocity_prev_7d = 0 THEN 'surging'
        WHEN velocity_7d >= 1.5 * velocity_prev_7d THEN 'surging'
        WHEN velocity_7d >= velocity_prev_7d THEN 'rising'
        WHEN velocity_7d >= 0.5 * velocity_prev_7d THEN 'stable'
        ELSE 'declining'
      END AS velocity_trend,
      CASE
        WHEN velocity_7d > 0 THEN 'active'
        WHEN lifespan_days > 30 THEN 'inactive'
        ELSE 'detected'
      END AS brand_status
    FROM deduped
  ),
  upserted AS (
    INSERT INTO scam_brands (
      slug, name, normalized_name, total_creatives, total_geos, total_celebrities,
      total_videos, total_photos, geo_list, celebrity_list, language_list,
      first_seen_at, last_seen_at, lifespan_days, velocity_7d, velocity_trend,
      scam_score, status, landing_urls, updated_at
    )
    SELECT slug, normalized_offer, normalized_offer, total, total_geos, total_celebrities,
           total_videos, total_photos, COALESCE(geo_list, '{}'), COALESCE(celebrity_list, '{}'), '{}',
           first_seen, last_seen, lifespan_days, velocity_7d, velocity_trend,
           scam_score, brand_status, COALESCE(landing_urls, '{}'), now()
    FROM scored
    ON CONFLICT (slug) DO UPDATE SET
      total_creatives = EXCLUDED.total_creatives,
      total_geos = EXCLUDED.total_geos,
      total_celebrities = EXCLUDED.total_celebrities,
      total_videos = EXCLUDED.total_videos,
      total_photos = EXCLUDED.total_photos,
      geo_list = EXCLUDED.geo_list,
      celebrity_list = EXCLUDED.celebrity_list,
      first_seen_at = EXCLUDED.first_seen_at,
      last_seen_at = EXCLUDED.last_seen_at,
      lifespan_days = EXCLUDED.lifespan_days,
      velocity_7d = EXCLUDED.velocity_7d,
      velocity_trend = EXCLUDED.velocity_trend,
      scam_score = EXCLUDED.scam_score,
      status = EXCLUDED.status,
      landing_urls = EXCLUDED.landing_urls,
      updated_at = now()
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE was_inserted),
    COUNT(*) FILTER (WHERE NOT was_inserted)
  INTO brands_inserted, brands_updated
  FROM upserted;

  -- Reset orphan brand rows — same behavior as migration 004, extended
  -- to also zero out landing_urls so orphan brands don't carry stale
  -- URL lists into sync (a previously-active brand going dormant
  -- shouldn't keep shipping old scam URLs on regenerated reviews).
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
    'brands_updated', brands_updated,
    'brands_orphaned', orphans_zeroed,
    'total_brands', total_brands_after,
    'timestamp', now()
  );
END;
$$;
