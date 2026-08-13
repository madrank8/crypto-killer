-- Migration: 025_upsert_creatives_touch_only.sql
--
-- Daily scrape walks the full SpyOwl catalog (~100k rows) so last_seen_at
-- stays fresh (rebuild_brands marks a brand dead after 3 days without a
-- touch). The previous ON CONFLICT clause rewrote offer_name, main_text,
-- URLs, geo, etc. on every existing row — most of that WAL is wasted
-- because completed runs insert 0 new creatives.
--
-- Touch-only conflict: bump last_seen_at, scrape_count, synced_at.
-- New ids still get a full INSERT. Offer/geo/URL drift on existing ads
-- is left for a dedicated backfill, not the nightly hot path.

CREATE OR REPLACE FUNCTION public.upsert_creatives(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
      synced_at = EXCLUDED.synced_at
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
