-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0003: Schema enrichment v2 — full Schema.org entity columns
--
-- Background:
--   The aux writer emits high-level slug-based data (about_slugs[],
--   mention_slugs[]). The Replit renderer historically resolved those
--   slugs through a 23-entity Wikidata registry, dropping any unknown
--   slugs silently. This filtered 14 of 16 mentions on a real article.
--
--   Schema enrichment v2 moves resolution to the Vercel pipeline side
--   via lib/schema-enrichment-resolver.js, with an 84-entity registry
--   in lib/wikidata-registry.js. The pipeline now writes FULL Schema.org
--   entity payloads to dedicated jsonb columns. The renderer trusts
--   the persisted data verbatim — no filtering.
--
-- New columns:
--   about     — jsonb — Article.about[] payloads (Schema.org Thing entities
--                       for primary topic clusters, with Wikidata sameAs
--                       and site-internal @id)
--   mentions  — jsonb — Article.mentions[] payloads (Schema.org entities
--                       for every named entity referenced in the body)
--
-- The following columns already exist (per content table schema as of
-- 2026-04-28) and are populated by this same pipeline pass — no migration
-- needed for them, just population:
--   claims    — jsonb — ClaimReview[] from {{VERIFY:...}} tags
--   how_to    — jsonb — HowTo entity if section pattern matches
--   item_list — jsonb — ItemList entity if article is listicle-shaped
--   quotes    — jsonb — Quotation[] from blockquotes with attribution
--
-- Backward compatibility:
--   The existing slug-array columns (about_slugs, mention_slugs) remain
--   populated alongside the new full-entity columns. The renderer
--   prefers full entities; legacy callers can still read slugs.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE content
  ADD COLUMN IF NOT EXISTS about jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mentions jsonb DEFAULT '[]'::jsonb;

-- Optional: backfill defaults for existing rows so the renderer never
-- sees NULL where it expects an array. Not strictly required because
-- the column default handles future inserts and the renderer should
-- handle null defensively, but explicit is safer.
UPDATE content
   SET about = '[]'::jsonb
 WHERE about IS NULL;

UPDATE content
   SET mentions = '[]'::jsonb
 WHERE mentions IS NULL;

-- GIN indexes for jsonb querying — enables efficient lookups like
-- "find articles mentioning Coinbase":
--   SELECT slug FROM content WHERE mentions @> '[{"name":"Coinbase"}]'
-- and "find articles about pig butchering":
--   SELECT slug FROM content WHERE about @> '[{"@id":"https://cryptokiller.org/topics/pig-butchering-scam#topic"}]'
CREATE INDEX IF NOT EXISTS idx_content_about_gin    ON content USING gin (about);
CREATE INDEX IF NOT EXISTS idx_content_mentions_gin ON content USING gin (mentions);
