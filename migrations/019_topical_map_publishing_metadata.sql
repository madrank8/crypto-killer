-- Migration: 019_topical_map_publishing_metadata.sql
-- v4.6 topical-map port: Tier 2 Publishing Metadata (skill Steps 15-19 + v4.1
-- Content Format). Deterministic slice only — Title Tag and Meta Description are
-- creative copy generated in the writing flow, not stored from the map stage.
-- Run in Supabase SQL Editor. Idempotent.
--
-- NOTE: `slug` (leaf) and `format_code` (terse code) already exist (migrations
-- 014-016) and are intentionally NOT touched here.

-- url_path: full hierarchical URL with no word repetition, e.g.
-- '/casino-reviews/stake-us/'. Built from the pillar->cluster->leaf slug chain.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS url_path text;

-- content_format: human-readable 10-format production template (e.g.
-- 'Comparison Table', 'FAQ Hub'). Distinct from the terse format_code; feeds the
-- writing-flow handoff to pick the document template.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS content_format text;

-- schema_type: schema.org type for the page (Article | FAQPage | HowTo |
-- ItemList | Review | NewsArticle | WebApplication).
ALTER TABLE topics ADD COLUMN IF NOT EXISTS schema_type text;
