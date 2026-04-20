-- Migration: 004_fix_rebuild_brands_and_counts.sql
-- Run in Supabase SQL Editor
--
-- Fixes two data-integrity bugs:
--
-- 1. rebuild_brands was leaving stale aggregates on brand rows whose
--    `normalized_name` no longer matches any creative (e.g. Prime Aura
--    stored total_creatives=317 while only 1 creative actually joined).
--    New rebuild resets those orphan rows to zero (but does not delete
--    them — reviews may still link to them via brand_id FK).
--
-- 2. upsert_creatives used `RETURNS void`, so the scraper couldn't
--    distinguish "how many rows were newly inserted" from "how many
--    already existed". new_creatives/updated_creatives in sync_runs
--    were effectively meaningless. The new signature returns jsonb
--    { inserted: n, updated: m }.
--
-- rebuild_brands now also returns richer counts:
--   { brands_inserted, brands_updated, brands_orphaned, total_brands, timestamp }

-- ─── 1. upsert_creatives: return insert/update counts ────────────────
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
      (r->>'synced_at')::timestamptz AS synced_at
    FROM jsonb_array_elements(payload) AS r
  ),
  upserted AS (
    INSERT INTO creatives (
      id, offer_name, normalized_offer, celebrity_name, geo, geo_region_id,
      is_video, land_language, is_favorite, created_at, first_seen_at,
      last_seen_at, scrape_count, synced_at
    )
    SELECT id, offer_name, normalized_offer, celebrity_name, geo, geo_region_id,
           is_video, land_language, is_favorite, created_at, first_seen_at,
           last_seen_at, 1, synced_at
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
      is_favorite = EXCLUDED.is_favorite
    -- xmax = 0 ⇒ row was INSERTed (no prior version); xmax <> 0 ⇒ UPDATE
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

-- ─── 2. rebuild_brands: also reset orphans + return richer counts ────
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
  -- ── 2a. Upsert brand rows from current creative aggregates ──
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
    HAVING count(*) >= 2  -- skip singleton noise (matches legacy behaviour)
  ),
  slugged AS (
    SELECT *,
      LEFT(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(normalized_offer), '[^a-z0-9]+', '-', 'g'), '^-|-$', '', 'g'), 100) AS slug
    FROM agg
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
      scam_score, status, updated_at
    )
    SELECT slug, normalized_offer, normalized_offer, total, total_geos, total_celebrities,
           total_videos, total_photos, COALESCE(geo_list, '{}'), COALESCE(celebrity_list, '{}'), '{}',
           first_seen, last_seen, lifespan_days, velocity_7d, velocity_trend,
           scam_score, brand_status, now()
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
      updated_at = now()
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE was_inserted),
    COUNT(*) FILTER (WHERE NOT was_inserted)
  INTO brands_inserted, brands_updated
  FROM upserted;

  -- ── 2b. Reset orphan brand rows (no matching creative anymore) ──
  -- Don't delete them — they may have reviews linked via brand_id.
  -- Just zero the aggregates so stats don't lie.
  WITH orphans AS (
    UPDATE scam_brands
    SET total_creatives = 0,
        total_geos = 0,
        total_celebrities = 0,
        total_videos = 0,
        total_photos = 0,
        geo_list = '{}',
        celebrity_list = '{}',
        velocity_7d = 0,
        velocity_trend = 'dead',
        status = 'inactive',
        updated_at = now()
    WHERE NOT EXISTS (
      SELECT 1 FROM creatives c
      WHERE c.normalized_offer = scam_brands.normalized_name
    )
    AND (total_creatives > 0 OR total_geos > 0 OR total_celebrities > 0)
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
