-- Run this in the Supabase SQL editor
-- Creates an RPC function that properly increments scrape_count on conflict

CREATE OR REPLACE FUNCTION upsert_creatives(payload jsonb)
RETURNS void AS $$
INSERT INTO creatives (
  id, offer_name, normalized_offer, celebrity_name, geo, geo_region_id,
  is_video, land_language, is_favorite, created_at, first_seen_at,
  last_seen_at, scrape_count, synced_at
)
SELECT
  (r->>'id'),
  (r->>'offer_name'),
  (r->>'normalized_offer'),
  (r->>'celebrity_name'),
  (r->>'geo'),
  (r->>'geo_region_id'),
  (r->>'is_video')::boolean,
  (r->>'land_language'),
  (r->>'is_favorite')::boolean,
  (r->>'created_at')::timestamptz,
  (r->>'first_seen_at')::timestamptz,
  (r->>'last_seen_at')::timestamptz,
  1,
  (r->>'synced_at')::timestamptz
FROM jsonb_array_elements(payload) AS r
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
  is_favorite = EXCLUDED.is_favorite;
$$ LANGUAGE sql;
