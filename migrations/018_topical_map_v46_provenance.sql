-- Migration: 018_topical_map_v46_provenance.sql
-- v4.6 topical-map port: node function taxonomy, RPP score, winning page type,
-- and structural provenance for the skill's HONESTY RULES.
-- Run in Supabase SQL Editor. Idempotent.
--
-- NOTE: node_type, aio_risk, fan_out_tag, page_role, macro_vector, format_code
-- already exist (migrations 014-016) and are intentionally NOT touched here.

-- node_function: orthogonal to node_type. One of:
-- authority | reinforcement | retrieval | entity | commercial
ALTER TABLE topics ADD COLUMN IF NOT EXISTS node_function text;

-- rpp_score: Rank-Probability-Potential prioritization score (numeric).
-- rpp_provenance: measured | estimated | unresolved (honesty rule for the score)
ALTER TABLE topics ADD COLUMN IF NOT EXISTS rpp_score numeric;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS rpp_provenance text;

-- winning_page_type: the page type the SERP actually rewards for this topic
-- (from the SERP-Overlap / Winning Page Type analysis).
ALTER TABLE topics ADD COLUMN IF NOT EXISTS winning_page_type text;

-- metric_provenance: per-field provenance map, e.g.
-- {"search_volume":"measured","keyword_difficulty":"estimated","rpp_score":"unresolved"}
-- A field absent from this map is treated as 'unresolved' by lib/topical-map/provenance.js.
-- Never fabricated: a value with no measured/estimated entry must not render as fact.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS metric_provenance jsonb;

-- methodology_version: which vendored methodology version produced this run
-- (attribution; e.g. '4.6'). site_type and mode live in topical_map_runs.config.
ALTER TABLE topical_map_runs ADD COLUMN IF NOT EXISTS methodology_version text;

CREATE INDEX IF NOT EXISTS idx_topics_node_function ON topics(node_function);
